import { HttpError, notFound } from '../http.js';
import { methodology, term } from '../../../shared/methodologies.js';
import { ISSUE_SELECT, issue as serializeIssue, user as serializeUser, activity as serializeActivity } from '../serialize.js';

export const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const TRACKED = ['title', 'description', 'type', 'statusId', 'priority', 'assigneeId', 'sprintId', 'epicId', 'parentId', 'phaseId', 'storyPoints', 'startDate', 'dueDate', 'labels'];
const COLUMN = {
  title: 'title', description: 'description', type: 'type', statusId: 'status_id', priority: 'priority', assigneeId: 'assignee_id',
  sprintId: 'sprint_id', epicId: 'epic_id', parentId: 'parent_id', phaseId: 'phase_id', storyPoints: 'story_points', startDate: 'start_date', dueDate: 'due_date', labels: 'labels',
};

export async function getIssueRow(db, id) {
  return await db.get(`${ISSUE_SELECT} WHERE i.id = ?`, id);
}

export async function issueKey(db, id) {
  const r = await db.get('SELECT p.key, i.number FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?', id);
  return r ? `${r.key}-${r.number}` : '';
}

/** Ensures every referenced row belongs to the same project / workspace. */
async function validateRefs(db, project, input) {
  if (input.statusId != null && !await db.get('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', input.statusId, project.id)) {
    throw new HttpError(400, 'That status does not belong to this project.');
  }
  if (input.assigneeId != null && !await db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', project.workspace_id, input.assigneeId)) {
    throw new HttpError(400, 'The assignee must be a member of this workspace.');
  }
  if (input.sprintId != null) {
    const sprint = await db.get('SELECT state FROM sprints WHERE id = ? AND project_id = ?', input.sprintId, project.id);
    if (!sprint) throw new HttpError(400, 'That sprint does not belong to this project.');
    if (sprint.state === 'closed') throw new HttpError(400, 'That sprint is already complete.');
  }
  if (input.epicId != null && !await db.get("SELECT 1 FROM issues WHERE id = ? AND project_id = ? AND type = 'epic'", input.epicId, project.id)) {
    throw new HttpError(400, 'The parent epic must be an epic in this project.');
  }
  if (input.phaseId != null && !await db.get('SELECT 1 FROM phases WHERE id = ? AND project_id = ?', input.phaseId, project.id)) {
    throw new HttpError(400, `That ${term(project.methodology, 'phase').toLowerCase()} does not belong to this project.`);
  }
  if (input.type != null && !methodology(project.methodology).types.includes(input.type)) {
    throw new HttpError(400, `${methodology(project.methodology).name} projects don't use the “${input.type}” type. Choose one of: ${methodology(project.methodology).types.map((t) => term(project.methodology, t)).join(', ')}.`);
  }
  if (input.parentId != null && !await db.get("SELECT 1 FROM issues WHERE id = ? AND project_id = ? AND type <> 'subtask'", input.parentId, project.id)) {
    throw new HttpError(400, 'Sub-tasks need a parent work item in the same project.');
  }
}

async function nextRank(db, statusId) {
  return ((await db.get('SELECT MAX(rank) AS r FROM issues WHERE status_id = ?', statusId)).r ?? 0) + 1024;
}

export async function createIssue(db, { projectId, actor, input, events, silent = false }) {
  return await db.tx(async () => {
    const project = await db.get('SELECT * FROM projects WHERE id = ?', projectId);
    if (!project) throw notFound('Project');
    const statusId = input.statusId ?? (await db.get('SELECT id FROM statuses WHERE project_id = ? ORDER BY position LIMIT 1', projectId)).id;
    const data = { ...input, statusId };
    if (!data.type) data.type = methodology(project.methodology).types.includes('task') ? 'task' : methodology(project.methodology).types[0];
    if (data.type === 'subtask' && !data.parentId) throw new HttpError(400, 'Choose the parent work item for this sub-task.');
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) throw new HttpError(400, 'The due date can’t be before the start date.');
    if (data.type === 'epic') data.epicId = null;
    await validateRefs(db, project, data);

    await db.run('UPDATE projects SET issue_seq = issue_seq + 1 WHERE id = ?', projectId);
    const number = (await db.get('SELECT issue_seq FROM projects WHERE id = ?', projectId)).issue_seq;
    const category = (await db.get('SELECT category FROM statuses WHERE id = ?', statusId)).category;
    const { lastInsertRowid } = await db.run(
      `INSERT INTO issues (project_id, number, type, title, description, status_id, priority, assignee_id, reporter_id, sprint_id,
         epic_id, parent_id, phase_id, story_points, start_date, due_date, labels, rank, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, number, data.type, data.title, data.description ?? '', statusId, data.priority ?? 'medium',
      data.assigneeId ?? null, actor.id, data.sprintId ?? null, data.epicId ?? null, data.parentId ?? null, data.phaseId ?? null,
      data.storyPoints ?? null, data.startDate ?? null, data.dueDate ?? null, JSON.stringify(cleanLabels(data.labels)),
      await nextRank(db, statusId), category === 'done' ? new Date().toISOString() : null,
    );
    const id = Number(lastInsertRowid);
    await db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', id, actor.id);
    if (data.assigneeId) await db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', id, data.assigneeId);

    if (!silent && events) {
      const key = `${project.key}-${number}`;
      await events.record({ workspaceId: project.workspace_id, projectId, issueId: id, actorId: actor.id, verb: 'created', data: { title: data.title } });
      if (data.assigneeId) {
        await events.notify({ workspaceId: project.workspace_id, issueId: id, actorId: actor.id, kind: 'assigned', recipients: [data.assigneeId],
          text: `${actor.name} assigned ${key} to you: “${data.title}”` });
      }
      events.changed(project.workspace_id, ['issues', `project:${projectId}`], actor.id);
    }
    return await getIssueRow(db, id);
  });
}

const cleanLabels = (labels) => [...new Set((labels ?? []).map((l) => String(l).trim()).filter(Boolean))].slice(0, 12);

/** Applies a partial update, logging one activity entry per changed field. */
export async function updateIssue(db, { issueRow, project, actor, input, events }) {
  return await db.tx(async () => {
    const current = serializeIssue(await getIssueRow(db, issueRow.id));
    const patch = {};
    for (const field of TRACKED) {
      if (!(field in input)) continue;
      const next = field === 'labels' ? cleanLabels(input.labels) : input[field];
      const prev = current[field];
      if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) patch[field] = next;
    }
    if ('parentId' in patch && patch.parentId === current.id) throw new HttpError(400, 'A work item cannot be its own parent.');
    if ('epicId' in patch && patch.epicId === current.id) throw new HttpError(400, 'An epic cannot contain itself.');
    const start = 'startDate' in patch ? patch.startDate : current.startDate;
    const due = 'dueDate' in patch ? patch.dueDate : current.dueDate;
    if (start && due && due < start) throw new HttpError(400, 'The due date can’t be before the start date.');
    const type = patch.type ?? current.type;
    const parentId = 'parentId' in patch ? patch.parentId : current.parentId;
    if (type === 'subtask' && !parentId) throw new HttpError(400, 'Choose the parent work item for this sub-task.');
    if (patch.parentId != null) {
      // Walk up from the new parent: reaching this item again would make a loop.
      for (let id = patch.parentId, hops = 0; id != null && hops < 50; hops++) {
        if (id === current.id) throw new HttpError(400, 'That would put this work item inside its own sub-task.');
        id = (await db.get('SELECT parent_id FROM issues WHERE id = ?', id))?.parent_id ?? null;
      }
    }
    await validateRefs(db, project, patch);
    if (!Object.keys(patch).length) return await getIssueRow(db, issueRow.id);

    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(patch)) {
      sets.push(`${COLUMN[field]} = ?`);
      params.push(field === 'labels' ? JSON.stringify(value) : value ?? null);
    }
    if ('statusId' in patch) {
      const category = (await db.get('SELECT category FROM statuses WHERE id = ?', patch.statusId)).category;
      sets.push('resolved_at = ?', 'rank = ?');
      params.push(category === 'done' ? current.resolvedAt ?? new Date().toISOString() : null, await nextRank(db, patch.statusId));
    }
    sets.push("updated_at = datetime('now')");
    await db.run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, ...params, issueRow.id);

    // An epic that becomes something else no longer groups its children.
    if (current.type === 'epic' && type !== 'epic') await db.run('UPDATE issues SET epic_id = NULL WHERE epic_id = ?', current.id);

    if (events) await logChanges(db, { project, actor, current, patch, events });
    return await getIssueRow(db, issueRow.id);
  });
}

async function logChanges(db, { project, actor, current, patch, events }) {
  const key = `${project.key}-${current.number}`;
  const watchers = (await db.all('SELECT user_id FROM watchers WHERE issue_id = ?', current.id)).map((r) => r.user_id);
  for (const [field, value] of Object.entries(patch)) {
    let from = current[field];
    let to = value;
    if (field === 'statusId') {
      from = current.statusName;
      to = (await db.get('SELECT name FROM statuses WHERE id = ?', value)).name;
    } else if (field === 'assigneeId') {
      from = from ? (await db.get('SELECT name FROM users WHERE id = ?', from))?.name : null;
      to = value ? (await db.get('SELECT name FROM users WHERE id = ?', value))?.name : null;
    } else if (field === 'sprintId') {
      from = from ? (await db.get('SELECT name FROM sprints WHERE id = ?', from))?.name : null;
      to = value ? (await db.get('SELECT name FROM sprints WHERE id = ?', value))?.name : null;
    } else if (field === 'phaseId') {
      from = from ? (await db.get('SELECT name FROM phases WHERE id = ?', from))?.name : null;
      to = value ? (await db.get('SELECT name FROM phases WHERE id = ?', value))?.name : null;
    } else if (field === 'description') {
      from = undefined;
      to = undefined;
    }
    await events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: current.id, actorId: actor.id, verb: 'updated', data: { field, from, to } });
  }
  if (patch.assigneeId) {
    await db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', current.id, patch.assigneeId);
    await events.notify({ workspaceId: project.workspace_id, issueId: current.id, actorId: actor.id, kind: 'assigned', recipients: [patch.assigneeId],
      text: `${actor.name} assigned ${key} to you: “${current.title}”` });
  }
  if (patch.statusId) {
    const to = (await db.get('SELECT name FROM statuses WHERE id = ?', patch.statusId)).name;
    await events.notify({ workspaceId: project.workspace_id, issueId: current.id, actorId: actor.id, kind: 'status', recipients: watchers,
      text: `${actor.name} moved ${key} to ${to}` });
  }
  events.changed(project.workspace_id, ['issues', `project:${project.id}`, `issue:${current.id}`], actor.id);
}

/**
 * Moves an issue (board column and/or sprint) and positions it between two
 * neighbours. Ranks are project-wide, so any two issues can be neighbours.
 */
export async function moveIssue(db, { issueRow, project, actor, statusId, sprintId, beforeId, afterId, events }) {
  return await db.tx(async () => {
    const patch = {};
    if (statusId != null && statusId !== issueRow.status_id) patch.statusId = statusId;
    if (sprintId !== undefined && sprintId !== issueRow.sprint_id) patch.sprintId = sprintId;
    if (Object.keys(patch).length) await updateIssue(db, { issueRow, project, actor, input: patch, events });
    const rankOf = async (id) => (id ? (await db.get('SELECT rank FROM issues WHERE id = ? AND project_id = ?', id, project.id))?.rank ?? null : null);
    const before = await rankOf(beforeId);
    const after = await rankOf(afterId);
    let rank;
    if (before != null && after != null) rank = (before + after) / 2;
    else if (before != null) rank = before + 1024;
    else if (after != null) rank = after - 1024;
    if (rank != null) {
      await db.run('UPDATE issues SET rank = ? WHERE id = ?', rank, issueRow.id);
      if (events && !Object.keys(patch).length) events.changed(project.workspace_id, ['issues', `project:${project.id}`], actor.id);
    }
    return await getIssueRow(db, issueRow.id);
  });
}

/** Full issue payload for the detail view. */
export async function issueDetail(db, issueId) {
  const row = await getIssueRow(db, issueId);
  const checklist = (await db.all('SELECT * FROM checklist_items WHERE issue_id = ? ORDER BY position, id', issueId))
    .map((c) => ({ id: c.id, text: c.text, done: !!c.done }));
  const comments = (await db.all(
    'SELECT c.*, u.name, u.email, u.color, u.job_title, u.id AS uid FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.issue_id = ? ORDER BY c.id',
    issueId,
  )).map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at, authorId: c.author_id,
    author: c.uid ? serializeUser({ id: c.uid, name: c.name, email: c.email, color: c.color, job_title: c.job_title }) : null }));
  const subtasks = (await db.all(`${ISSUE_SELECT} WHERE i.parent_id = ? ORDER BY i.number`, issueId)).map(serializeIssue);
  const children = row.type === 'epic' ? (await db.all(`${ISSUE_SELECT} WHERE i.epic_id = ? ORDER BY i.rank`, issueId)).map(serializeIssue) : [];
  const links = [];
  const linkRows = [
    ...await db.all(`SELECT l.id, l.kind, 'outward' AS dir, l.target_id AS other FROM issue_links l WHERE l.source_id = ?`, issueId),
    ...await db.all(`SELECT l.id, l.kind, 'inward' AS dir, l.source_id AS other FROM issue_links l WHERE l.target_id = ?`, issueId),
  ];
  const others = linkRows.length
    ? new Map((await db.all(`${ISSUE_SELECT} WHERE i.id IN (${linkRows.map(() => '?').join(',')})`, ...linkRows.map((l) => l.other))).map((r) => [r.id, r]))
    : new Map();
  for (const l of linkRows) if (others.has(l.other)) links.push({ id: l.id, kind: l.kind, direction: l.dir, issue: serializeIssue(others.get(l.other)) });
  const activity = (await db.all('SELECT * FROM activity WHERE issue_id = ? ORDER BY id DESC LIMIT 60', issueId)).map(serializeActivity);
  const watchers = (await db.all('SELECT user_id FROM watchers WHERE issue_id = ?', issueId)).map((w) => w.user_id);
  return { ...serializeIssue(row), checklist, comments, subtasks, children, links, activity, watchers };
}
