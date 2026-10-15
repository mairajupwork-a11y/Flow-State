import { HttpError, notFound } from '../http.js';
import { methodology, term } from '../../../shared/methodologies.js';
import { ISSUE_SELECT, issue as serializeIssue, user as serializeUser, activity as serializeActivity } from '../serialize.js';

export const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const TRACKED = ['title', 'description', 'type', 'statusId', 'priority', 'assigneeId', 'sprintId', 'epicId', 'parentId', 'phaseId', 'storyPoints', 'startDate', 'dueDate', 'labels'];
const COLUMN = {
  title: 'title', description: 'description', type: 'type', statusId: 'status_id', priority: 'priority', assigneeId: 'assignee_id',
  sprintId: 'sprint_id', epicId: 'epic_id', parentId: 'parent_id', phaseId: 'phase_id', storyPoints: 'story_points', startDate: 'start_date', dueDate: 'due_date', labels: 'labels',
};

export function getIssueRow(db, id) {
  return db.get(`${ISSUE_SELECT} WHERE i.id = ?`, id);
}

export function issueKey(db, id) {
  const r = db.get('SELECT p.key, i.number FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?', id);
  return r ? `${r.key}-${r.number}` : '';
}

/** Ensures every referenced row belongs to the same project / workspace. */
function validateRefs(db, project, input) {
  if (input.statusId != null && !db.get('SELECT 1 FROM statuses WHERE id = ? AND project_id = ?', input.statusId, project.id)) {
    throw new HttpError(400, 'That status does not belong to this project.');
  }
  if (input.assigneeId != null && !db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', project.workspace_id, input.assigneeId)) {
    throw new HttpError(400, 'The assignee must be a member of this workspace.');
  }
  if (input.sprintId != null) {
    const sprint = db.get('SELECT state FROM sprints WHERE id = ? AND project_id = ?', input.sprintId, project.id);
    if (!sprint) throw new HttpError(400, 'That sprint does not belong to this project.');
    if (sprint.state === 'closed') throw new HttpError(400, 'That sprint is already complete.');
  }
  if (input.epicId != null && !db.get("SELECT 1 FROM issues WHERE id = ? AND project_id = ? AND type = 'epic'", input.epicId, project.id)) {
    throw new HttpError(400, 'The parent epic must be an epic in this project.');
  }
  if (input.phaseId != null && !db.get('SELECT 1 FROM phases WHERE id = ? AND project_id = ?', input.phaseId, project.id)) {
    throw new HttpError(400, `That ${term(project.methodology, 'phase').toLowerCase()} does not belong to this project.`);
  }
  if (input.type != null && !methodology(project.methodology).types.includes(input.type)) {
    throw new HttpError(400, `${methodology(project.methodology).name} projects don't use the “${input.type}” type. Choose one of: ${methodology(project.methodology).types.map((t) => term(project.methodology, t)).join(', ')}.`);
  }
  if (input.parentId != null && !db.get("SELECT 1 FROM issues WHERE id = ? AND project_id = ? AND type <> 'subtask'", input.parentId, project.id)) {
    throw new HttpError(400, 'Sub-tasks need a parent work item in the same project.');
  }
}

function nextRank(db, statusId) {
  return (db.get('SELECT MAX(rank) AS r FROM issues WHERE status_id = ?', statusId).r ?? 0) + 1024;
}

export function createIssue(db, { projectId, actor, input, events, silent = false }) {
  return db.tx(() => {
    const project = db.get('SELECT * FROM projects WHERE id = ?', projectId);
    if (!project) throw notFound('Project');
    const statusId = input.statusId ?? db.get('SELECT id FROM statuses WHERE project_id = ? ORDER BY position LIMIT 1', projectId).id;
    const data = { ...input, statusId };
    if (!data.type) data.type = methodology(project.methodology).types.includes('task') ? 'task' : methodology(project.methodology).types[0];
    if (data.type === 'subtask' && !data.parentId) throw new HttpError(400, 'Choose the parent work item for this sub-task.');
    if (data.type === 'epic') data.epicId = null;
    validateRefs(db, project, data);

    db.run('UPDATE projects SET issue_seq = issue_seq + 1 WHERE id = ?', projectId);
    const number = db.get('SELECT issue_seq FROM projects WHERE id = ?', projectId).issue_seq;
    const category = db.get('SELECT category FROM statuses WHERE id = ?', statusId).category;
    const { lastInsertRowid } = db.run(
      `INSERT INTO issues (project_id, number, type, title, description, status_id, priority, assignee_id, reporter_id, sprint_id,
         epic_id, parent_id, phase_id, story_points, start_date, due_date, labels, rank, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, number, data.type, data.title, data.description ?? '', statusId, data.priority ?? 'medium',
      data.assigneeId ?? null, actor.id, data.sprintId ?? null, data.epicId ?? null, data.parentId ?? null, data.phaseId ?? null,
      data.storyPoints ?? null, data.startDate ?? null, data.dueDate ?? null, JSON.stringify(cleanLabels(data.labels)),
      nextRank(db, statusId), category === 'done' ? new Date().toISOString() : null,
    );
    const id = Number(lastInsertRowid);
    db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', id, actor.id);
    if (data.assigneeId) db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', id, data.assigneeId);

    if (!silent && events) {
      const key = `${project.key}-${number}`;
      events.record({ workspaceId: project.workspace_id, projectId, issueId: id, actorId: actor.id, verb: 'created', data: { title: data.title } });
      if (data.assigneeId) {
        events.notify({ workspaceId: project.workspace_id, issueId: id, actorId: actor.id, kind: 'assigned', recipients: [data.assigneeId],
          text: `${actor.name} assigned ${key} to you: “${data.title}”` });
      }
      events.changed(project.workspace_id, ['issues', `project:${projectId}`], actor.id);
    }
    return getIssueRow(db, id);
  });
}

const cleanLabels = (labels) => [...new Set((labels ?? []).map((l) => String(l).trim()).filter(Boolean))].slice(0, 12);

/** Applies a partial update, logging one activity entry per changed field. */
export function updateIssue(db, { issueRow, project, actor, input, events }) {
  return db.tx(() => {
    const current = serializeIssue(getIssueRow(db, issueRow.id));
    const patch = {};
    for (const field of TRACKED) {
      if (!(field in input)) continue;
      const next = field === 'labels' ? cleanLabels(input.labels) : input[field];
      const prev = current[field];
      if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) patch[field] = next;
    }
    if ('parentId' in patch && patch.parentId === current.id) throw new HttpError(400, 'A work item cannot be its own parent.');
    if ('epicId' in patch && patch.epicId === current.id) throw new HttpError(400, 'An epic cannot contain itself.');
    validateRefs(db, project, patch);
    if (!Object.keys(patch).length) return getIssueRow(db, issueRow.id);

    const sets = [];
    const params = [];
    for (const [field, value] of Object.entries(patch)) {
      sets.push(`${COLUMN[field]} = ?`);
      params.push(field === 'labels' ? JSON.stringify(value) : value ?? null);
    }
    if ('statusId' in patch) {
      const category = db.get('SELECT category FROM statuses WHERE id = ?', patch.statusId).category;
      sets.push('resolved_at = ?', 'rank = ?');
      params.push(category === 'done' ? current.resolvedAt ?? new Date().toISOString() : null, nextRank(db, patch.statusId));
    }
    sets.push("updated_at = datetime('now')");
    db.run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, ...params, issueRow.id);

    if (events) logChanges(db, { project, actor, current, patch, events });
    return getIssueRow(db, issueRow.id);
  });
}

function logChanges(db, { project, actor, current, patch, events }) {
  const key = `${project.key}-${current.number}`;
  const watchers = db.all('SELECT user_id FROM watchers WHERE issue_id = ?', current.id).map((r) => r.user_id);
  for (const [field, value] of Object.entries(patch)) {
    let from = current[field];
    let to = value;
    if (field === 'statusId') {
      from = current.statusName;
      to = db.get('SELECT name FROM statuses WHERE id = ?', value).name;
    } else if (field === 'assigneeId') {
      from = from ? db.get('SELECT name FROM users WHERE id = ?', from)?.name : null;
      to = value ? db.get('SELECT name FROM users WHERE id = ?', value)?.name : null;
    } else if (field === 'sprintId') {
      from = from ? db.get('SELECT name FROM sprints WHERE id = ?', from)?.name : null;
      to = value ? db.get('SELECT name FROM sprints WHERE id = ?', value)?.name : null;
    } else if (field === 'phaseId') {
      from = from ? db.get('SELECT name FROM phases WHERE id = ?', from)?.name : null;
      to = value ? db.get('SELECT name FROM phases WHERE id = ?', value)?.name : null;
    } else if (field === 'description') {
      from = undefined;
      to = undefined;
    }
    events.record({ workspaceId: project.workspace_id, projectId: project.id, issueId: current.id, actorId: actor.id, verb: 'updated', data: { field, from, to } });
  }
  if (patch.assigneeId) {
    db.run('INSERT OR IGNORE INTO watchers (issue_id, user_id) VALUES (?, ?)', current.id, patch.assigneeId);
    events.notify({ workspaceId: project.workspace_id, issueId: current.id, actorId: actor.id, kind: 'assigned', recipients: [patch.assigneeId],
      text: `${actor.name} assigned ${key} to you: “${current.title}”` });
  }
  if (patch.statusId) {
    const to = db.get('SELECT name FROM statuses WHERE id = ?', patch.statusId).name;
    events.notify({ workspaceId: project.workspace_id, issueId: current.id, actorId: actor.id, kind: 'status', recipients: watchers,
      text: `${actor.name} moved ${key} to ${to}` });
  }
  events.changed(project.workspace_id, ['issues', `project:${project.id}`, `issue:${current.id}`], actor.id);
}

/**
 * Moves an issue (board column and/or sprint) and positions it between two
 * neighbours. Ranks are project-wide, so any two issues can be neighbours.
 */
export function moveIssue(db, { issueRow, project, actor, statusId, sprintId, beforeId, afterId, events }) {
  return db.tx(() => {
    const patch = {};
    if (statusId != null && statusId !== issueRow.status_id) patch.statusId = statusId;
    if (sprintId !== undefined && sprintId !== issueRow.sprint_id) patch.sprintId = sprintId;
    if (Object.keys(patch).length) updateIssue(db, { issueRow, project, actor, input: patch, events });
    const rankOf = (id) => (id ? db.get('SELECT rank FROM issues WHERE id = ? AND project_id = ?', id, project.id)?.rank ?? null : null);
    const before = rankOf(beforeId);
    const after = rankOf(afterId);
    let rank;
    if (before != null && after != null) rank = (before + after) / 2;
    else if (before != null) rank = before + 1024;
    else if (after != null) rank = after - 1024;
    if (rank != null) {
      db.run('UPDATE issues SET rank = ? WHERE id = ?', rank, issueRow.id);
      if (events && !Object.keys(patch).length) events.changed(project.workspace_id, ['issues', `project:${project.id}`], actor.id);
    }
    return getIssueRow(db, issueRow.id);
  });
}

/** Full issue payload for the detail view. */
export function issueDetail(db, issueId) {
  const row = getIssueRow(db, issueId);
  const checklist = db.all('SELECT * FROM checklist_items WHERE issue_id = ? ORDER BY position, id', issueId)
    .map((c) => ({ id: c.id, text: c.text, done: !!c.done }));
  const comments = db.all(
    'SELECT c.*, u.name, u.email, u.color, u.job_title, u.id AS uid FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.issue_id = ? ORDER BY c.id',
    issueId,
  ).map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, editedAt: c.edited_at, authorId: c.author_id,
    author: c.uid ? serializeUser({ id: c.uid, name: c.name, email: c.email, color: c.color, job_title: c.job_title }) : null }));
  const subtasks = db.all(`${ISSUE_SELECT} WHERE i.parent_id = ? ORDER BY i.number`, issueId).map(serializeIssue);
  const children = row.type === 'epic' ? db.all(`${ISSUE_SELECT} WHERE i.epic_id = ? ORDER BY i.rank`, issueId).map(serializeIssue) : [];
  const links = [
    ...db.all(`SELECT l.id, l.kind, 'outward' AS dir, l.target_id AS other FROM issue_links l WHERE l.source_id = ?`, issueId),
    ...db.all(`SELECT l.id, l.kind, 'inward' AS dir, l.source_id AS other FROM issue_links l WHERE l.target_id = ?`, issueId),
  ].map((l) => ({ id: l.id, kind: l.kind, direction: l.dir, issue: serializeIssue(getIssueRow(db, l.other)) }));
  const activity = db.all('SELECT * FROM activity WHERE issue_id = ? ORDER BY id DESC LIMIT 60', issueId).map(serializeActivity);
  const watchers = db.all('SELECT user_id FROM watchers WHERE issue_id = ?', issueId).map((w) => w.user_id);
  return { ...serializeIssue(row), checklist, comments, subtasks, children, links, activity, watchers };
}
