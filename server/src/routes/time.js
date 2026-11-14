import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadIssue, loadWorkspace, membershipFor, isManager, VISIBLE_PROJECT } from '../access.js';

/** Hard ceiling on one entry: a timer left running overnight is capped, not counted as days. */
const MAX_MINUTES = 16 * 60;
const minutesBetween = (a, b) => Math.min(MAX_MINUTES, Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)));

const ENTRY_SELECT = `SELECT te.*, u.name AS user_name, u.color AS user_color, p.key AS project_key, p.name AS project_name, p.client AS project_client,
    i.number AS issue_number, i.title AS issue_title
  FROM time_entries te JOIN users u ON u.id = te.user_id JOIN projects p ON p.id = te.project_id JOIN issues i ON i.id = te.issue_id`;

export function serializeEntry(e, now = new Date().toISOString()) {
  const running = !e.ended_at;
  return {
    id: e.id, issueId: e.issue_id, projectId: e.project_id, userId: e.user_id, userName: e.user_name ?? '', userColor: e.user_color ?? '#535450',
    issueKey: e.project_key ? `${e.project_key}-${e.issue_number}` : '', issueTitle: e.issue_title ?? '', projectName: e.project_name ?? '', client: e.project_client ?? '',
    startedAt: e.started_at, endedAt: e.ended_at, running, minutes: running ? minutesBetween(e.started_at, now) : e.minutes, note: e.note, billable: !!e.billable,
  };
}

/** Stops the user's running timer, if any. Returns the stopped entry id. */
async function stopRunning(db, userId) {
  const run = await db.get('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL', userId);
  if (!run) return null;
  const now = new Date().toISOString();
  await db.run('UPDATE time_entries SET ended_at = ?, minutes = ? WHERE id = ?', now, minutesBetween(run.started_at, now), run.id);
  return run.id;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function timeRoutes({ db, events }) {
  const r = Router();
  // Signed-in only, and only on these paths (other /api routers, like public share links, pass through).
  r.use(['/time', '/issues/:ref/time', '/workspaces/:ws/timesheet'], requireUser);
  const changed = (wsId, actorId) => events.changed(wsId, ['time', 'issues'], actorId);

  // ---- The running timer ----
  r.get('/time/running', async (req, res) => {
    const row = await db.get(`${ENTRY_SELECT} WHERE te.user_id = ? AND te.ended_at IS NULL`, req.user.id);
    res.json(row ? serializeEntry(row) : null);
  });

  r.post('/issues/:ref/time/start', async (req, res) => {
    const { issue, project } = await loadIssue(db, req.user, req.params.ref, 'member');
    await db.tx(async () => {
      await stopRunning(db, req.user.id);
      await db.run('INSERT INTO time_entries (workspace_id, project_id, issue_id, user_id, started_at, note, billable) VALUES (?, ?, ?, ?, ?, ?, 1)',
        project.workspace_id, project.id, issue.id, req.user.id, new Date().toISOString(), String(req.body?.note ?? '').slice(0, 300));
    });
    changed(project.workspace_id, req.user.id);
    res.status(201).json(serializeEntry(await db.get(`${ENTRY_SELECT} WHERE te.user_id = ? AND te.ended_at IS NULL`, req.user.id)));
  });

  r.post('/time/stop', async (req, res) => {
    const id = await db.tx(() => stopRunning(db, req.user.id));
    if (!id) return res.json(null);
    const row = await db.get(`${ENTRY_SELECT} WHERE te.id = ?`, id);
    changed(row.workspace_id, req.user.id);
    res.json(serializeEntry(row));
  });

  // ---- Entries on one work item ----
  r.get('/issues/:ref/time', async (req, res) => {
    const { issue } = await loadIssue(db, req.user, req.params.ref);
    const rows = (await db.all(`${ENTRY_SELECT} WHERE te.issue_id = ? ORDER BY te.started_at DESC, te.id DESC LIMIT 200`, issue.id)).map((e) => serializeEntry(e));
    const total = rows.reduce((s, e) => s + e.minutes, 0);
    res.json({ entries: rows, totalMinutes: total, myMinutes: rows.filter((e) => e.userId === req.user.id).reduce((s, e) => s + e.minutes, 0) });
  });

  const manual = z.object({
    minutes: z.number().int().min(1, 'log at least a minute').max(MAX_MINUTES, 'one entry can be at most 16 hours'),
    startedAt: z.string().datetime({ message: 'choose a valid date' }).optional(),
    note: z.string().trim().max(300).default(''),
    billable: z.boolean().default(true),
  });
  r.post('/issues/:ref/time', async (req, res) => {
    const { issue, project } = await loadIssue(db, req.user, req.params.ref, 'member');
    const body = parse(manual, req.body);
    const start = body.startedAt ? new Date(body.startedAt) : new Date(Date.now() - body.minutes * 60000);
    if (start.getTime() > Date.now() + 864e5) throw new HttpError(400, 'Time can’t be logged in the future.');
    const end = new Date(start.getTime() + body.minutes * 60000);
    const { lastInsertRowid } = await db.run(
      'INSERT INTO time_entries (workspace_id, project_id, issue_id, user_id, started_at, ended_at, minutes, note, billable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      project.workspace_id, project.id, issue.id, req.user.id, start.toISOString(), end.toISOString(), body.minutes, body.note, Number(body.billable),
    );
    changed(project.workspace_id, req.user.id);
    res.status(201).json(serializeEntry(await db.get(`${ENTRY_SELECT} WHERE te.id = ?`, Number(lastInsertRowid))));
  });

  /** Your own entries are yours to fix; managers can fix anyone's. */
  async function loadEntry(req) {
    const e = await db.get('SELECT * FROM time_entries WHERE id = ?', Number(req.params.id));
    if (!e) throw notFound('Time entry');
    const m = await membershipFor(db, e.workspace_id, req.user.id);
    if (!m) throw notFound('Time entry');
    if (e.user_id !== req.user.id && !isManager(m.role)) throw new HttpError(403, 'You can only change your own time entries.');
    return e;
  }
  r.patch('/time/:id', async (req, res) => {
    const e = await loadEntry(req);
    const body = parse(manual.partial(), req.body);
    if (body.minutes !== undefined && !e.ended_at) throw new HttpError(400, 'Stop the timer before changing its length.');
    const start = body.startedAt ?? e.started_at;
    const minutes = body.minutes ?? e.minutes;
    const end = e.ended_at ? new Date(new Date(start).getTime() + minutes * 60000).toISOString() : null;
    await db.run('UPDATE time_entries SET started_at = ?, ended_at = ?, minutes = ?, note = ?, billable = ? WHERE id = ?',
      start, end, e.ended_at ? minutes : null, body.note ?? e.note, body.billable === undefined ? e.billable : Number(body.billable), e.id);
    changed(e.workspace_id, req.user.id);
    res.json(serializeEntry(await db.get(`${ENTRY_SELECT} WHERE te.id = ?`, e.id)));
  });
  r.delete('/time/:id', async (req, res) => {
    const e = await loadEntry(req);
    await db.run('DELETE FROM time_entries WHERE id = ?', e.id);
    changed(e.workspace_id, req.user.id);
    res.json({ ok: true });
  });

  // ---- Timesheets: everyone sees their own; managers see the whole team ----
  r.get('/workspaces/:ws/timesheet', async (req, res) => {
    const { ws, membership } = await loadWorkspace(db, req.user, req.params.ws);
    const q = parse(z.object({
      from: z.string().datetime(), to: z.string().datetime(),
      userId: z.coerce.number().int().positive().optional(), projectId: z.coerce.number().int().positive().optional(),
      format: z.enum(['json', 'csv']).default('json'),
    }), req.query);
    const lead = isManager(membership.role);
    const userId = lead ? q.userId : req.user.id;
    const where = ['te.workspace_id = ?', 'te.started_at >= ?', 'te.started_at < ?', VISIBLE_PROJECT('p')];
    const params = [ws.id, q.from, q.to, req.user.id, req.user.id];
    if (userId) { where.push('te.user_id = ?'); params.push(userId); }
    if (q.projectId) { where.push('te.project_id = ?'); params.push(q.projectId); }
    const now = new Date().toISOString();
    const entries = (await db.all(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY te.started_at, te.id LIMIT 5000`, ...params)).map((e) => serializeEntry(e, now));
    if (q.format === 'csv') {
      const head = ['Date', 'Person', 'Project', 'Client', 'Work item', 'Title', 'Note', 'Hours', 'Billable'];
      const lines = entries.map((e) => [e.startedAt.slice(0, 10), e.userName, e.projectName, e.client, e.issueKey, e.issueTitle, e.note, (e.minutes / 60).toFixed(2), e.billable ? 'Yes' : 'No'].map(csvCell).join(','));
      const total = entries.reduce((s, e) => s + e.minutes, 0);
      lines.push(['Total', '', '', '', '', '', '', (total / 60).toFixed(2), ''].map(csvCell).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="timesheet-${ws.slug}-${q.from.slice(0, 10)}.csv"`);
      return res.send('﻿' + [head.join(','), ...lines].join('\r\n'));
    }
    res.json({
      entries, canSeeTeam: lead,
      totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
      billableMinutes: entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0),
    });
  });

  return r;
}
