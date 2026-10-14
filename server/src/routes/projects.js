import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadProject } from '../access.js';
import { ISSUE_SELECT, issue as serializeIssue, project as serializeProject, status as serializeStatus, sprint as serializeSprint } from '../serialize.js';
import { createIssue } from '../services/issues.js';
import { issueInput } from './issues.js';
import { isoDay, dayOffset, daysBetween, ISO_DATE } from '../dates.js';

const isoDate = z.string().regex(ISO_DATE, 'use a YYYY-MM-DD date');

export function projectRoutes({ db, events }) {
  const r = Router();
  r.use(requireUser);

  r.get('/:id', (req, res) => {
    const p = loadProject(db, req.user, req.params.id);
    res.json(projectPayload(db, p));
  });

  r.patch('/:id', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().trim().max(500).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      leadId: z.number().int().nullable().optional(),
      archived: z.boolean().optional(),
    }), req.body);
    if (body.leadId && !db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', p.workspace_id, body.leadId)) {
      throw new HttpError(400, 'The project lead must be a workspace member.');
    }
    const cols = { name: 'name', description: 'description', color: 'color', leadId: 'lead_id', archived: 'archived' };
    for (const [k, col] of Object.entries(cols)) {
      if (body[k] !== undefined) db.run(`UPDATE projects SET ${col} = ? WHERE id = ?`, typeof body[k] === 'boolean' ? Number(body[k]) : body[k], p.id);
    }
    events.changed(p.workspace_id, ['workspace', `project:${p.id}`], req.user.id);
    res.json(projectPayload(db, db.get('SELECT * FROM projects WHERE id = ?', p.id)));
  });

  r.delete('/:id', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'admin');
    db.run('DELETE FROM projects WHERE id = ?', p.id);
    events.changed(p.workspace_id, ['workspace', 'issues'], req.user.id);
    res.json({ ok: true });
  });

  // ---- Workflow (board columns) ----
  r.post('/:id/statuses', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(40),
      category: z.enum(['todo', 'progress', 'done']).default('progress'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8278f4'),
    }), req.body);
    // Insert before the first "done" column so finished work stays on the right.
    const doneAt = db.get("SELECT MIN(position) AS pos FROM statuses WHERE project_id = ? AND category = 'done'", p.id).pos;
    const position = body.category === 'done' || doneAt == null ? db.get('SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM statuses WHERE project_id = ?', p.id).pos : doneAt;
    db.tx(() => {
      db.run('UPDATE statuses SET position = position + 1 WHERE project_id = ? AND position >= ?', p.id, position);
      db.run('INSERT INTO statuses (project_id, name, category, color, position) VALUES (?, ?, ?, ?, ?)', p.id, body.name, body.category, body.color, position);
    });
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.status(201).json(projectPayload(db, p).statuses);
  });

  r.patch('/:id/statuses/:statusId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const status = db.get('SELECT * FROM statuses WHERE id = ? AND project_id = ?', Number(req.params.statusId), p.id);
    if (!status) throw notFound('Column');
    const body = parse(z.object({
      name: z.string().trim().min(1).max(40).optional(),
      category: z.enum(['todo', 'progress', 'done']).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      wipLimit: z.number().int().min(1).max(999).nullable().optional(),
      position: z.number().int().min(0).optional(),
    }), req.body);
    db.tx(() => {
      if (body.name !== undefined) db.run('UPDATE statuses SET name = ? WHERE id = ?', body.name, status.id);
      if (body.category !== undefined) db.run('UPDATE statuses SET category = ? WHERE id = ?', body.category, status.id);
      if (body.color !== undefined) db.run('UPDATE statuses SET color = ? WHERE id = ?', body.color, status.id);
      if (body.wipLimit !== undefined) db.run('UPDATE statuses SET wip_limit = ? WHERE id = ?', body.wipLimit, status.id);
      if (body.position !== undefined && body.position !== status.position) {
        const ids = db.all('SELECT id FROM statuses WHERE project_id = ? AND id <> ? ORDER BY position', p.id, status.id).map((s) => s.id);
        ids.splice(Math.min(body.position, ids.length), 0, status.id);
        ids.forEach((id, i) => db.run('UPDATE statuses SET position = ? WHERE id = ?', i, id));
      }
    });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(projectPayload(db, p).statuses);
  });

  r.delete('/:id/statuses/:statusId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const status = db.get('SELECT * FROM statuses WHERE id = ? AND project_id = ?', Number(req.params.statusId), p.id);
    if (!status) throw notFound('Column');
    const others = db.all('SELECT * FROM statuses WHERE project_id = ? AND id <> ? ORDER BY position', p.id, status.id);
    if (!others.length) throw new HttpError(400, 'A board needs at least one column.');
    const target = Number(req.body?.moveTo) || others.find((o) => o.category === status.category)?.id || others[0].id;
    if (!others.some((o) => o.id === target)) throw new HttpError(400, 'Choose a column in this project for the existing work.');
    db.tx(() => {
      db.run('UPDATE issues SET status_id = ? WHERE status_id = ?', target, status.id);
      db.run('DELETE FROM statuses WHERE id = ?', status.id);
      others.forEach((o, i) => db.run('UPDATE statuses SET position = ? WHERE id = ?', i, o.id));
    });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(projectPayload(db, p).statuses);
  });

  // ---- Work items ----
  r.get('/:id/issues', (req, res) => {
    const p = loadProject(db, req.user, req.params.id);
    const rows = db.all(`${ISSUE_SELECT} WHERE i.project_id = ? ORDER BY s.position, i.rank`, p.id);
    res.json(rows.map(serializeIssue));
  });

  r.post('/:id/issues', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const input = parse(issueInput.extend({ title: z.string().trim().min(1, 'give the work item a title').max(200) }), req.body);
    const row = createIssue(db, { projectId: p.id, actor: req.user, input, events });
    res.status(201).json(serializeIssue(row));
  });

  // ---- Sprints ----
  r.post('/:id/sprints', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({ name: z.string().trim().max(60).optional(), goal: z.string().trim().max(240).default('') }), req.body ?? {});
    const n = db.get('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?', p.id).n + 1;
    const { lastInsertRowid } = db.run('INSERT INTO sprints (project_id, name, goal) VALUES (?, ?, ?)', p.id, body.name || `${p.key} Sprint ${n}`, body.goal);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.status(201).json(serializeSprint(db.get('SELECT * FROM sprints WHERE id = ?', lastInsertRowid)));
  });

  const loadSprint = (p, sprintId) => {
    const s = db.get('SELECT * FROM sprints WHERE id = ? AND project_id = ?', Number(sprintId), p.id);
    if (!s) throw notFound('Sprint');
    return s;
  };

  r.patch('/:id/sprints/:sprintId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const s = loadSprint(p, req.params.sprintId);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), goal: z.string().trim().max(240).optional(), startDate: isoDate.optional(), endDate: isoDate.optional() }), req.body);
    if (body.name !== undefined) db.run('UPDATE sprints SET name = ? WHERE id = ?', body.name, s.id);
    if (body.goal !== undefined) db.run('UPDATE sprints SET goal = ? WHERE id = ?', body.goal, s.id);
    if (body.startDate !== undefined) db.run('UPDATE sprints SET start_date = ? WHERE id = ?', body.startDate, s.id);
    if (body.endDate !== undefined) db.run('UPDATE sprints SET end_date = ? WHERE id = ?', body.endDate, s.id);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.json(serializeSprint(db.get('SELECT * FROM sprints WHERE id = ?', s.id)));
  });

  r.post('/:id/sprints/:sprintId/start', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const s = loadSprint(p, req.params.sprintId);
    const body = parse(z.object({ goal: z.string().trim().max(240).optional(), weeks: z.number().int().min(1).max(8).default(2) }), req.body ?? {});
    if (s.state !== 'planned') throw new HttpError(400, 'Only planned sprints can be started.');
    if (db.get("SELECT 1 FROM sprints WHERE project_id = ? AND state = 'active'", p.id)) throw new HttpError(409, 'Complete the active sprint before starting another one.');
    if (!db.get('SELECT 1 FROM issues WHERE sprint_id = ?', s.id)) throw new HttpError(400, 'Add at least one work item to the sprint before starting it.');
    db.run("UPDATE sprints SET state = 'active', start_date = ?, end_date = ?, goal = COALESCE(?, goal) WHERE id = ?", isoDay(), dayOffset(body.weeks * 7), body.goal ?? null, s.id);
    events.record({ workspaceId: p.workspace_id, projectId: p.id, actorId: req.user.id, verb: 'sprint_started', data: { name: s.name } });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(serializeSprint(db.get('SELECT * FROM sprints WHERE id = ?', s.id)));
  });

  r.post('/:id/sprints/:sprintId/complete', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const s = loadSprint(p, req.params.sprintId);
    const body = parse(z.object({ moveTo: z.union([z.literal('backlog'), z.literal('new'), z.number().int()]).default('backlog') }), req.body ?? {});
    if (s.state !== 'active') throw new HttpError(400, 'Only the active sprint can be completed.');
    const result = db.tx(() => {
      const items = db.all('SELECT i.id, i.story_points, st.category FROM issues i JOIN statuses st ON st.id = i.status_id WHERE i.sprint_id = ? AND i.parent_id IS NULL', s.id);
      const committed = items.reduce((a, i) => a + (i.story_points ?? 0), 0);
      const completed = items.filter((i) => i.category === 'done').reduce((a, i) => a + (i.story_points ?? 0), 0);
      let target = null;
      if (body.moveTo === 'new') {
        const n = db.get('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?', p.id).n + 1;
        target = Number(db.run('INSERT INTO sprints (project_id, name) VALUES (?, ?)', p.id, `${p.key} Sprint ${n}`).lastInsertRowid);
      } else if (typeof body.moveTo === 'number') {
        target = loadSprint(p, body.moveTo).id;
        if (target === s.id) throw new HttpError(400, 'Choose a different sprint for unfinished work.');
      }
      const open = items.filter((i) => i.category !== 'done');
      for (const i of open) db.run('UPDATE issues SET sprint_id = ? WHERE id = ? OR parent_id = ?', target, i.id, i.id);
      db.run("UPDATE sprints SET state = 'closed', completed_at = datetime('now'), committed_points = ?, completed_points = ? WHERE id = ?", committed, completed, s.id);
      return { completedIssues: items.length - open.length, movedIssues: open.length, committed, completed };
    });
    events.record({ workspaceId: p.workspace_id, projectId: p.id, actorId: req.user.id, verb: 'sprint_completed', data: { name: s.name, ...result } });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(result);
  });

  r.delete('/:id/sprints/:sprintId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const s = loadSprint(p, req.params.sprintId);
    if (s.state === 'active') throw new HttpError(400, 'Complete the sprint instead of deleting it.');
    db.run('DELETE FROM sprints WHERE id = ?', s.id);
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json({ ok: true });
  });

  r.get('/:id/reports', (req, res) => {
    const p = loadProject(db, req.user, req.params.id);
    res.json(reports(db, p));
  });

  return r;
}

export function projectPayload(db, p) {
  const statuses = db.all('SELECT * FROM statuses WHERE project_id = ? ORDER BY position', p.id).map(serializeStatus);
  const sprints = db.all("SELECT * FROM sprints WHERE project_id = ? ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, id", p.id).map(serializeSprint);
  return { ...serializeProject(p), statuses, sprints };
}

function reports(db, p) {
  const issues = db.all(`${ISSUE_SELECT} WHERE i.project_id = ? AND i.type <> 'epic'`, p.id).map(serializeIssue);
  const statuses = db.all('SELECT * FROM statuses WHERE project_id = ? ORDER BY position', p.id);
  const today = isoDay();
  const byStatus = statuses.map((s) => {
    const list = issues.filter((i) => i.statusId === s.id);
    return { id: s.id, name: s.name, color: s.color, category: s.category, count: list.length, points: list.reduce((a, i) => a + (i.storyPoints ?? 0), 0) };
  });
  const byPriority = ['urgent', 'high', 'medium', 'low'].map((priority) => ({ priority, count: issues.filter((i) => i.priority === priority).length }));
  const byType = ['feature', 'story', 'task', 'bug', 'subtask'].map((type) => ({ type, count: issues.filter((i) => i.type === type).length })).filter((t) => t.count);

  const members = db.all('SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ?', p.workspace_id);
  const workload = [...members.map((m) => ({ userId: m.id, name: m.name })), { userId: null, name: 'Unassigned' }].map((m) => {
    const open = issues.filter((i) => i.assigneeId === m.userId && i.statusCategory !== 'done');
    return { ...m, open: open.length, points: open.reduce((a, i) => a + (i.storyPoints ?? 0), 0), overdue: open.filter((i) => i.dueDate && i.dueDate < today).length };
  }).filter((w) => w.open > 0 || w.userId);

  const flow = Array.from({ length: 14 }, (_, k) => {
    const day = dayOffset(k - 13);
    return { day, created: issues.filter((i) => i.createdAt.slice(0, 10) === day).length, resolved: issues.filter((i) => i.resolvedAt?.slice(0, 10) === day).length };
  });

  const resolved30 = issues.filter((i) => i.resolvedAt && i.resolvedAt.slice(0, 10) >= dayOffset(-30));
  const cycleTimeDays = resolved30.length
    ? Math.round((resolved30.reduce((a, i) => a + (Date.parse(i.resolvedAt) - Date.parse(i.createdAt.replace(' ', 'T') + 'Z')), 0) / resolved30.length / 864e5) * 10) / 10
    : null;

  const active = db.get("SELECT * FROM sprints WHERE project_id = ? AND state = 'active'", p.id);
  let burndown = null;
  if (active?.start_date && active?.end_date) {
    const scope = issues.filter((i) => i.sprintId === active.id && !i.parentId);
    const usePoints = scope.some((i) => i.storyPoints);
    const weight = (i) => (usePoints ? i.storyPoints ?? 0 : 1);
    const total = scope.reduce((a, i) => a + weight(i), 0);
    const length = Math.max(1, daysBetween(active.start_date, active.end_date));
    const points = Array.from({ length: length + 1 }, (_, k) => {
      const day = dayOffset(k, new Date(active.start_date + 'T00:00:00Z'));
      const remaining = day > today ? null : scope.filter((i) => !i.resolvedAt || i.resolvedAt.slice(0, 10) > day).reduce((a, i) => a + weight(i), 0);
      return { day, ideal: Math.round((total - (total * k) / length) * 10) / 10, remaining };
    });
    burndown = { sprint: serializeSprint(active), unit: usePoints ? 'points' : 'items', total, points };
  }

  const velocity = db.all("SELECT * FROM sprints WHERE project_id = ? AND state = 'closed' ORDER BY completed_at DESC LIMIT 6", p.id)
    .reverse().map((s) => ({ name: s.name, committed: s.committed_points ?? 0, completed: s.completed_points ?? 0 }));

  return {
    totals: {
      total: issues.length,
      done: issues.filter((i) => i.statusCategory === 'done').length,
      inProgress: issues.filter((i) => i.statusCategory === 'progress').length,
      overdue: issues.filter((i) => i.statusCategory !== 'done' && i.dueDate && i.dueDate < today).length,
      cycleTimeDays,
    },
    byStatus, byPriority, byType, workload, flow, burndown, velocity,
  };
}
