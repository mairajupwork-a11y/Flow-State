import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadProject } from '../access.js';
import { ISSUE_SELECT, issue as serializeIssue, project as serializeProject, status as serializeStatus, sprint as serializeSprint,
  phase as serializePhase, entry as serializeEntry, measurement as serializeMeasurement } from '../serialize.js';
import { createIssue } from '../services/issues.js';
import { createPhases } from '../services/projects.js';
import { flowMetrics, phaseMetrics, controlChart } from '../services/metrics.js';
import { METHODOLOGY_IDS, REGISTERS, methodology, term, legacyTemplate } from '../../../shared/methodologies.js';
import { issueInput } from './issues.js';
import { isoDay, dayOffset, daysBetween, ISO_DATE } from '../dates.js';

const isoDate = z.string().regex(ISO_DATE, 'use a YYYY-MM-DD date');
const fieldValue = z.union([z.string().max(4000), z.number(), z.null()]);
const fieldData = z.record(z.string().max(40), fieldValue).refine((d) => Object.keys(d).length <= 40, 'too many fields');
const settingsOf = (p) => { try { return JSON.parse(p.settings || '{}'); } catch { return {}; } };

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
      methodology: z.enum(METHODOLOGY_IDS).optional(),
      resetColumns: z.boolean().optional(),
      charter: fieldData.optional(),
      swimlane: z.enum(['none', 'priority', 'assignee', 'epic']).optional(),
    }), req.body);
    if (body.leadId && !db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', p.workspace_id, body.leadId)) {
      throw new HttpError(400, 'The project lead must be a workspace member.');
    }
    const cols = { name: 'name', description: 'description', color: 'color', leadId: 'lead_id', archived: 'archived' };
    for (const [k, col] of Object.entries(cols)) {
      if (body[k] !== undefined) db.run(`UPDATE projects SET ${col} = ? WHERE id = ?`, typeof body[k] === 'boolean' ? Number(body[k]) : body[k], p.id);
    }
    if (body.charter !== undefined || body.swimlane !== undefined) {
      const settings = settingsOf(p);
      if (body.charter !== undefined) settings.charter = { ...(settings.charter ?? {}), ...body.charter };
      if (body.swimlane !== undefined) settings.swimlane = body.swimlane;
      db.run('UPDATE projects SET settings = ? WHERE id = ?', JSON.stringify(settings), p.id);
    }
    if (body.methodology && body.methodology !== p.methodology) switchMethodology(db, p, body.methodology, body.resetColumns, req.user, events);
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
    const { lastInsertRowid } = db.run('INSERT INTO sprints (project_id, name, goal) VALUES (?, ?, ?)', p.id, body.name || `${p.key} ${term(p.methodology, 'sprint')} ${n}`, body.goal);
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
    if (!methodology(p.methodology).features.sprints) throw new HttpError(400, `${methodology(p.methodology).name} projects flow continuously and don't use sprints. Switch the methodology in project settings to plan in sprints.`);
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
        target = Number(db.run('INSERT INTO sprints (project_id, name) VALUES (?, ?)', p.id, `${p.key} ${term(p.methodology, 'sprint')} ${n}`).lastInsertRowid);
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

  // ---- Phases / stages / DMAIC tollgates ----
  const loadPhase = (p, phaseId) => {
    const ph = db.get('SELECT * FROM phases WHERE id = ? AND project_id = ?', Number(phaseId), p.id);
    if (!ph) throw notFound(term(p.methodology, 'phase'));
    return ph;
  };
  const phasesOf = (p) => db.all('SELECT * FROM phases WHERE project_id = ? ORDER BY position', p.id).map(serializePhase);

  r.post('/:id/phases', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), gate: z.string().trim().max(240).default(''), startDate: isoDate.nullable().optional(), endDate: isoDate.nullable().optional() }), req.body);
    const position = db.get('SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM phases WHERE project_id = ?', p.id).pos;
    const state = db.get("SELECT 1 FROM phases WHERE project_id = ? AND state IN ('active','review')", p.id) || position > 0 ? 'pending' : 'active';
    db.run('INSERT INTO phases (project_id, name, position, state, gate, start_date, end_date, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      p.id, body.name, position, state, body.gate, body.startDate ?? null, body.endDate ?? null, state === 'active' ? new Date().toISOString() : null);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.status(201).json(phasesOf(p));
  });

  r.patch('/:id/phases/:phaseId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const ph = loadPhase(p, req.params.phaseId);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), gate: z.string().trim().max(240).optional(), startDate: isoDate.nullable().optional(), endDate: isoDate.nullable().optional() }), req.body);
    const start = body.startDate !== undefined ? body.startDate : ph.start_date;
    const end = body.endDate !== undefined ? body.endDate : ph.end_date;
    if (start && end && start > end) throw new HttpError(400, 'The start date needs to be before the end date.');
    const cols = { name: 'name', gate: 'gate', startDate: 'start_date', endDate: 'end_date' };
    for (const [k, col] of Object.entries(cols)) if (body[k] !== undefined) db.run(`UPDATE phases SET ${col} = ? WHERE id = ?`, body[k], ph.id);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.json(phasesOf(p));
  });

  r.delete('/:id/phases/:phaseId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'admin');
    const ph = loadPhase(p, req.params.phaseId);
    db.tx(() => {
      db.run('DELETE FROM phases WHERE id = ?', ph.id);
      db.all('SELECT id FROM phases WHERE project_id = ? ORDER BY position', p.id).forEach((x, i) => db.run('UPDATE phases SET position = ? WHERE id = ?', i, x.id));
    });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(phasesOf(p));
  });

  /**
   * Gate workflow: pending → active → review → complete. Phases run in order
   * (a predictive lifecycle), so a phase can only start once every earlier
   * one has passed its gate. Approving a gate opens the next phase.
   */
  r.post('/:id/phases/:phaseId/transition', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const ph = loadPhase(p, req.params.phaseId);
    const body = parse(z.object({ action: z.enum(['start', 'submit', 'approve', 'reject', 'reopen']), decision: z.string().trim().max(1000).default('') }), req.body);
    const label = term(p.methodology, 'phase');
    const gateWord = methodology(p.methodology).features.phases === 'dmaic' ? 'tollgate' : methodology(p.methodology).features.phases === 'stage' ? 'stage boundary' : 'gate';
    const now = new Date().toISOString();
    const open = db.get("SELECT COUNT(*) AS n FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.phase_id = ? AND s.category <> 'done' AND i.parent_id IS NULL", ph.id).n;
    db.tx(() => {
      if (body.action === 'start') {
        if (ph.state !== 'pending') throw new HttpError(400, `This ${label.toLowerCase()} has already started.`);
        const blocking = db.get("SELECT name FROM phases WHERE project_id = ? AND position < ? AND state <> 'complete' ORDER BY position LIMIT 1", p.id, ph.position);
        if (blocking) throw new HttpError(409, `“${blocking.name}” must pass its ${gateWord} before “${ph.name}” can start.`);
        db.run("UPDATE phases SET state = 'active', started_at = ?, start_date = COALESCE(start_date, ?) WHERE id = ?", now, isoDay(), ph.id);
      } else if (body.action === 'submit') {
        if (ph.state !== 'active') throw new HttpError(400, `Only an active ${label.toLowerCase()} can be submitted for ${gateWord} review.`);
        db.run("UPDATE phases SET state = 'review' WHERE id = ?", ph.id);
      } else if (body.action === 'approve') {
        if (ph.state !== 'review' && ph.state !== 'active') throw new HttpError(400, `Only an active ${label.toLowerCase()} or one in review can be approved.`);
        if (open > 0 && !body.decision) throw new HttpError(400, `${open} work item${open === 1 ? ' is' : 's are'} still open in “${ph.name}”. Record a decision (e.g. why it can pass with exceptions) to approve the ${gateWord}.`);
        db.run("UPDATE phases SET state = 'complete', completed_at = ?, approved_by = ?, decision = ?, end_date = COALESCE(end_date, ?) WHERE id = ?",
          now, req.user.id, body.decision || 'Approved — exit criteria met.', isoDay(), ph.id);
        const next = db.get("SELECT id FROM phases WHERE project_id = ? AND position > ? AND state = 'pending' ORDER BY position LIMIT 1", p.id, ph.position);
        if (next) db.run("UPDATE phases SET state = 'active', started_at = ?, start_date = COALESCE(start_date, ?) WHERE id = ?", now, isoDay(), next.id);
      } else if (body.action === 'reject') {
        if (ph.state !== 'review') throw new HttpError(400, `Only a ${label.toLowerCase()} awaiting review can be sent back.`);
        db.run("UPDATE phases SET state = 'active', decision = ? WHERE id = ?", body.decision || 'Sent back for rework.', ph.id);
      } else if (body.action === 'reopen') {
        if (ph.state !== 'complete') throw new HttpError(400, `Only a completed ${label.toLowerCase()} can be reopened.`);
        loadProject(db, req.user, req.params.id, 'admin');
        db.run("UPDATE phases SET state = 'active', completed_at = NULL, approved_by = NULL WHERE id = ?", ph.id);
        db.run("UPDATE phases SET state = 'pending', started_at = NULL WHERE project_id = ? AND position > ? AND state = 'active'", p.id, ph.position);
      }
    });
    const verbs = { start: 'phase_started', submit: 'phase_submitted', approve: 'phase_approved', reject: 'phase_rejected', reopen: 'phase_reopened' };
    events.record({ workspaceId: p.workspace_id, projectId: p.id, actorId: req.user.id, verb: verbs[body.action], data: { name: ph.name, decision: body.decision || undefined } });
    events.changed(p.workspace_id, [`project:${p.id}`, 'issues'], req.user.id);
    res.json(phasesOf(p));
  });

  // ---- Registers (risk, issue, change, lessons, quality, FMEA, waste, kaizen, impediments) ----
  r.get('/:id/entries', (req, res) => {
    const p = loadProject(db, req.user, req.params.id);
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
    const rows = kind
      ? db.all('SELECT * FROM entries WHERE project_id = ? AND kind = ? ORDER BY id DESC', p.id, kind)
      : db.all('SELECT * FROM entries WHERE project_id = ? ORDER BY id DESC', p.id);
    res.json(rows.map(serializeEntry));
  });

  const entryInput = z.object({
    kind: z.string().refine((k) => k in REGISTERS, 'unknown register'),
    title: z.string().trim().min(1, 'give the entry a title').max(200),
    status: z.string().trim().max(40).optional(),
    ownerId: z.number().int().positive().nullable().optional(),
    data: fieldData.default({}),
  });
  const checkOwner = (p, ownerId) => {
    if (ownerId != null && !db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', p.workspace_id, ownerId)) {
      throw new HttpError(400, 'The owner must be a member of this workspace.');
    }
  };
  const checkStatus = (kind, status) => {
    if (status != null && !REGISTERS[kind].statuses.includes(status)) throw new HttpError(400, `Status must be one of: ${REGISTERS[kind].statuses.join(', ')}.`);
  };

  r.post('/:id/entries', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(entryInput, req.body);
    checkOwner(p, body.ownerId);
    checkStatus(body.kind, body.status);
    const { lastInsertRowid } = db.run('INSERT INTO entries (project_id, kind, title, status, owner_id, data, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p.id, body.kind, body.title, body.status ?? REGISTERS[body.kind].statuses[0], body.ownerId ?? null, JSON.stringify(body.data), req.user.id);
    events.record({ workspaceId: p.workspace_id, projectId: p.id, actorId: req.user.id, verb: 'entry_created', data: { kind: body.kind, title: body.title } });
    events.changed(p.workspace_id, [`project:${p.id}`, `entries:${p.id}`], req.user.id);
    res.status(201).json(serializeEntry(db.get('SELECT * FROM entries WHERE id = ?', lastInsertRowid)));
  });

  const loadEntry = (p, entryId) => {
    const e = db.get('SELECT * FROM entries WHERE id = ? AND project_id = ?', Number(entryId), p.id);
    if (!e) throw notFound('Entry');
    return e;
  };

  r.patch('/:id/entries/:entryId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const e = loadEntry(p, req.params.entryId);
    const body = parse(entryInput.omit({ kind: true }).partial(), req.body);
    checkOwner(p, body.ownerId);
    checkStatus(e.kind, body.status);
    if (body.title !== undefined) db.run('UPDATE entries SET title = ? WHERE id = ?', body.title, e.id);
    if (body.status !== undefined) db.run('UPDATE entries SET status = ? WHERE id = ?', body.status, e.id);
    if (body.ownerId !== undefined) db.run('UPDATE entries SET owner_id = ? WHERE id = ?', body.ownerId, e.id);
    if (body.data !== undefined) db.run('UPDATE entries SET data = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(e.data || '{}'), ...body.data }), e.id);
    db.run("UPDATE entries SET updated_at = datetime('now') WHERE id = ?", e.id);
    events.changed(p.workspace_id, [`project:${p.id}`, `entries:${p.id}`], req.user.id);
    res.json(serializeEntry(db.get('SELECT * FROM entries WHERE id = ?', e.id)));
  });

  r.delete('/:id/entries/:entryId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const e = loadEntry(p, req.params.entryId);
    db.run('DELETE FROM entries WHERE id = ?', e.id);
    events.changed(p.workspace_id, [`project:${p.id}`, `entries:${p.id}`], req.user.id);
    res.json({ ok: true });
  });

  // ---- Measurements (Six Sigma CTQ data / any tracked metric) ----
  r.post('/:id/measurements', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const body = parse(z.object({ day: isoDate.default(isoDay()), value: z.number().finite(), note: z.string().trim().max(200).default('') }), req.body);
    const { lastInsertRowid } = db.run('INSERT INTO measurements (project_id, day, value, note) VALUES (?, ?, ?, ?)', p.id, body.day, body.value, body.note);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
    res.status(201).json(serializeMeasurement(db.get('SELECT * FROM measurements WHERE id = ?', lastInsertRowid)));
  });

  r.delete('/:id/measurements/:mId', (req, res) => {
    const p = loadProject(db, req.user, req.params.id, 'member');
    const m = db.get('SELECT id FROM measurements WHERE id = ? AND project_id = ?', Number(req.params.mId), p.id);
    if (!m) throw notFound('Measurement');
    db.run('DELETE FROM measurements WHERE id = ?', m.id);
    events.changed(p.workspace_id, [`project:${p.id}`], req.user.id);
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
  const phases = db.all('SELECT * FROM phases WHERE project_id = ? ORDER BY position', p.id).map(serializePhase);
  return { ...serializeProject(p), statuses, sprints, phases };
}

/**
 * Moves a project to another methodology. Data is never lost: phases are
 * added if the new practice needs them, registers stay, and with
 * resetColumns the board adopts the new workflow — each item lands in the
 * first new column of the same category (to do / in progress / done).
 */
function switchMethodology(db, p, nextId, resetColumns, actor, events) {
  const m = methodology(nextId);
  db.tx(() => {
    db.run('UPDATE projects SET methodology = ?, template = ? WHERE id = ?', m.id, legacyTemplate(m.id), p.id);
    if (m.phases && !db.get('SELECT 1 FROM phases WHERE project_id = ?', p.id)) createPhases(db, p.id, m);
    if (resetColumns) {
      const old = db.all('SELECT * FROM statuses WHERE project_id = ?', p.id);
      db.run('UPDATE statuses SET position = position + 1000 WHERE project_id = ?', p.id);
      const created = m.statuses.map(([name, category, color, wip], position) => ({
        category,
        id: Number(db.run('INSERT INTO statuses (project_id, name, category, color, position, wip_limit) VALUES (?, ?, ?, ?, ?, ?)', p.id, name, category, color, position, wip ?? null).lastInsertRowid),
      }));
      for (const s of old) {
        const target = created.find((c) => c.category === s.category) ?? created[0];
        db.run('UPDATE issues SET status_id = ? WHERE status_id = ?', target.id, s.id);
        db.run('DELETE FROM statuses WHERE id = ?', s.id);
      }
    }
    if (m.features.sprints === 'required' && !db.get("SELECT 1 FROM sprints WHERE project_id = ? AND state <> 'closed'", p.id)) {
      db.run('INSERT INTO sprints (project_id, name) VALUES (?, ?)', p.id, `${p.key} ${term(m.id, 'sprint')} 1`);
    }
  });
  events.record({ workspaceId: p.workspace_id, projectId: p.id, actorId: actor.id, verb: 'methodology_changed', data: { from: methodology(p.methodology).name, to: m.name } });
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
  const byType = ['feature', 'story', 'task', 'bug', 'subtask', 'milestone'].map((type) => ({ type, count: issues.filter((i) => i.type === type).length })).filter((t) => t.count);

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
    ...flowMetrics(db, p, issues, statuses),
    phases: phaseMetrics(db, p, issues),
    control: controlChart(db, p, settingsOf(p).charter),
    registers: registerSummary(db, p),
  };
}

function registerSummary(db, p) {
  const rows = db.all('SELECT * FROM entries WHERE project_id = ?', p.id).map(serializeEntry);
  return Object.keys(REGISTERS).map((kind) => {
    const list = rows.filter((e) => e.kind === kind);
    const def = REGISTERS[kind];
    const closed = def.statuses[def.statuses.length - 1];
    const open = list.filter((e) => e.status !== closed && e.status !== 'Dropped' && e.status !== 'Rejected');
    const score = (e) => (def.score === 'pxi' ? (Number(e.data.probability) || 0) * (Number(e.data.impact) || 0)
      : def.score === 'rpn' ? (Number(e.data.severity) || 0) * (Number(e.data.occurrence) || 0) * (Number(e.data.detection) || 0) : null);
    const high = def.score ? open.filter((e) => score(e) >= (def.score === 'pxi' ? 15 : 200)).length : 0;
    return { kind, label: def.label, total: list.length, open: open.length, high };
  }).filter((r) => r.total);
}
