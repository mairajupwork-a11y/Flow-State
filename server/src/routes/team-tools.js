import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { parse, notFound } from '../http.js';
import { loadWorkspace, loadProject, VISIBLE_PROJECT } from '../access.js';
import { audit } from '../services/audit.js';
import { isoDay, dayOffset } from '../dates.js';

export function teamToolRoutes({ db, appUrl }) {
  const r = Router();
  const base = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  // ---- Workload: how much each person has on their plate ----
  r.get('/workspaces/:ws/workload', requireUser, async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'manager');
    const q = parse(z.object({ projectId: z.coerce.number().int().positive().optional() }), req.query);
    const today = isoDay();
    const week = dayOffset(7);
    const people = await db.all(`SELECT u.id, u.name, u.color, u.job_title, m.role FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? AND m.role <> 'viewer' ORDER BY u.name`, ws.id);
    const open = await db.all(`SELECT ia.user_id, i.id, i.number, i.title, i.priority, i.due_date, i.story_points, p.key AS project_key, p.name AS project_name, s.name AS status_name, s.category
      FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id JOIN projects p ON p.id = i.project_id JOIN statuses s ON s.id = i.status_id
      WHERE p.workspace_id = ? AND p.archived = 0 AND s.category <> 'done' AND i.type <> 'epic' ${q.projectId ? 'AND p.id = ?' : ''}`, ...(q.projectId ? [ws.id, q.projectId] : [ws.id]));
    const mondayish = dayOffset(-((new Date().getUTCDay() + 6) % 7));
    const hours = await db.all(`SELECT user_id, SUM(minutes) AS m FROM time_entries WHERE workspace_id = ? AND started_at >= ? ${q.projectId ? 'AND project_id = ?' : ''} GROUP BY user_id`,
      ...(q.projectId ? [ws.id, mondayish, q.projectId] : [ws.id, mondayish]));
    const doneWeek = await db.all(`SELECT ia.user_id, COUNT(*) AS n FROM issue_assignees ia JOIN issues i ON i.id = ia.issue_id JOIN projects p ON p.id = i.project_id
      WHERE p.workspace_id = ? AND i.resolved_at >= ? ${q.projectId ? 'AND p.id = ?' : ''} GROUP BY ia.user_id`, ...(q.projectId ? [ws.id, dayOffset(-7), q.projectId] : [ws.id, dayOffset(-7)]));
    const rows = people.map((u) => {
      const mine = open.filter((o) => o.user_id === u.id);
      return {
        userId: u.id, name: u.name, color: u.color, jobTitle: u.job_title, role: u.role,
        open: mine.length,
        inProgress: mine.filter((o) => o.category === 'progress').length,
        points: mine.reduce((s, o) => s + (o.story_points ?? 0), 0),
        overdue: mine.filter((o) => o.due_date && o.due_date < today).length,
        dueThisWeek: mine.filter((o) => o.due_date && o.due_date >= today && o.due_date <= week).length,
        urgent: mine.filter((o) => o.priority === 'urgent' || o.priority === 'high').length,
        minutesThisWeek: hours.find((h) => h.user_id === u.id)?.m ?? 0,
        doneThisWeek: doneWeek.find((d) => d.user_id === u.id)?.n ?? 0,
        items: mine.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 12)
          .map((o) => ({ key: `${o.project_key}-${o.number}`, title: o.title, priority: o.priority, dueDate: o.due_date, status: o.status_name, project: o.project_name })),
      };
    });
    const avg = rows.length ? rows.reduce((s, r) => s + r.open, 0) / rows.length : 0;
    res.json({ people: rows.map((r) => ({ ...r, load: r.overdue > 0 || (avg >= 2 && r.open > avg * 1.5) ? 'high' : r.open === 0 ? 'free' : r.open < avg * 0.5 ? 'light' : 'ok' })), average: Math.round(avg * 10) / 10 });
  });

  // ---- Client share links: a read-only page anyone with the link can open ----
  const serializeLink = (req) => (l) => ({ id: l.id, label: l.label, url: `${base(req)}/share/${l.token}`, createdAt: l.created_at });
  r.get('/projects/:id/share', requireUser, async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'manager');
    res.json((await db.all('SELECT * FROM share_links WHERE project_id = ? AND revoked_at IS NULL ORDER BY id DESC', p.id)).map(serializeLink(req)));
  });
  r.post('/projects/:id/share', requireUser, async (req, res) => {
    const p = await loadProject(db, req.user, req.params.id, 'manager');
    const { label } = parse(z.object({ label: z.string().trim().max(60).default('') }), req.body);
    const token = randomBytes(24).toString('base64url');
    await db.run('INSERT INTO share_links (project_id, token, label, created_by) VALUES (?, ?, ?, ?)', p.id, token, label, req.user.id);
    await audit(db, { workspaceId: p.workspace_id, userId: req.user.id, action: 'share.created', target: p.name, detail: label, ip: req.ip });
    res.status(201).json(serializeLink(req)(await db.get('SELECT * FROM share_links WHERE token = ?', token)));
  });
  r.delete('/share-links/:id', requireUser, async (req, res) => {
    const link = await db.get('SELECT * FROM share_links WHERE id = ?', Number(req.params.id));
    if (!link) throw notFound('Link');
    const p = await loadProject(db, req.user, link.project_id, 'manager');
    await db.run("UPDATE share_links SET revoked_at = datetime('now') WHERE id = ?", link.id);
    await audit(db, { workspaceId: p.workspace_id, userId: req.user.id, action: 'share.revoked', target: p.name, detail: link.label, ip: req.ip });
    res.json({ ok: true });
  });

  /** Public: what a client sees. Titles, columns, priorities and dates only — no comments, files, people or descriptions. */
  r.get('/share/:token', async (req, res) => {
    const link = /^[\w-]{20,64}$/.test(req.params.token) ? await db.get('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL', req.params.token) : null;
    if (!link) throw notFound('Shared project');
    const p = await db.get('SELECT p.*, w.name AS ws_name, w.logo AS ws_logo FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ?', link.project_id);
    if (!p || p.archived) throw notFound('Shared project');
    const statuses = await db.all('SELECT id, name, category, color FROM statuses WHERE project_id = ? ORDER BY position', p.id);
    const issues = await db.all("SELECT i.number, i.title, i.type, i.priority, i.status_id, i.due_date, i.resolved_at FROM issues i WHERE i.project_id = ? AND i.type NOT IN ('epic', 'subtask') ORDER BY i.rank", p.id);
    const sprint = await db.get("SELECT name, goal, end_date FROM sprints WHERE project_id = ? AND state = 'active'", p.id);
    const done = issues.filter((i) => statuses.find((s) => s.id === i.status_id)?.category === 'done').length;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.json({
      project: { name: p.name, key: p.key, color: p.color, description: p.description, client: p.client ?? '', workspace: p.ws_name, logo: p.ws_logo ?? '' },
      sprint: sprint ? { name: sprint.name, goal: sprint.goal, endDate: sprint.end_date } : null,
      progress: { total: issues.length, done, pct: issues.length ? Math.round((done / issues.length) * 100) : 0 },
      columns: statuses.map((s) => ({ name: s.name, category: s.category, color: s.color, items: issues.filter((i) => i.status_id === s.id).slice(0, 200).map((i) => ({ key: `${p.key}-${i.number}`, title: i.title, type: i.type, priority: i.priority, dueDate: i.due_date, doneAt: i.resolved_at?.slice(0, 10) ?? null })) })),
      updatedAt: new Date().toISOString(),
    });
  });
  return r;
}
