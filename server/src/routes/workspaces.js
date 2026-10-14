import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadWorkspace } from '../access.js';
import { createProject } from '../services/projects.js';
import { ISSUE_SELECT, issue as serializeIssue, user as serializeUser, workspace as serializeWorkspace, project as serializeProject, activity as serializeActivity } from '../serialize.js';
import { session } from './auth.js';

const REGIONS = { uk: { locale: 'en-GB', weekStart: 1 }, us: { locale: 'en-US', weekStart: 0 }, asia: { locale: 'en-SG', weekStart: 1 }, other: { locale: 'en-GB', weekStart: 1 } };
const role = z.enum(['admin', 'member', 'viewer']);
const projectInput = z.object({
  name: z.string().trim().min(1, 'give the project a name').max(80),
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'use 2–6 letters or numbers, starting with a letter').optional(),
  description: z.string().trim().max(500).optional(),
  template: z.enum(['scrum', 'kanban', 'business']).default('scrum'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  withSamples: z.boolean().default(false),
});

function slugify(db, name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
  let slug = base;
  while (db.get('SELECT 1 FROM workspaces WHERE slug = ?', slug)) slug = `${base}-${randomBytes(2).toString('hex')}`;
  return slug;
}

export function workspaceRoutes({ db, events, hub }) {
  const r = Router();
  r.use(requireUser);

  /** Onboarding: creates the workspace, its first project and pending invites in one step. */
  r.post('/', (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2, 'use at least 2 characters').max(60),
      region: z.enum(['uk', 'us', 'asia', 'other']).default('uk'),
      teamSize: z.string().max(20).default(''),
      useCase: z.string().max(40).default(''),
      jobTitle: z.string().trim().max(80).optional(),
      project: projectInput.optional(),
      invites: z.array(z.string().trim().toLowerCase().email()).max(200).default([]),
    }), req.body);
    const ws = db.tx(() => {
      const preset = REGIONS[body.region];
      const { lastInsertRowid } = db.run(
        'INSERT INTO workspaces (name, slug, region, locale, week_start, team_size, use_case, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        body.name, slugify(db, body.name), body.region, preset.locale, preset.weekStart, body.teamSize, body.useCase, req.user.id,
      );
      const wsId = Number(lastInsertRowid);
      db.run("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'admin')", wsId, req.user.id);
      db.run('UPDATE users SET locale = ? WHERE id = ?', preset.locale, req.user.id);
      if (body.jobTitle) db.run('UPDATE users SET job_title = ? WHERE id = ?', body.jobTitle, req.user.id);
      if (body.project) createProject(db, { workspaceId: wsId, actor: req.user, ...body.project });
      for (const email of new Set(body.invites)) {
        db.run("INSERT INTO invites (token, workspace_id, email, role, invited_by) VALUES (?, ?, ?, 'member', ?)", randomBytes(18).toString('base64url'), wsId, email, req.user.id);
      }
      events.record({ workspaceId: wsId, actorId: req.user.id, verb: 'workspace_created', data: { name: body.name } });
      return db.get('SELECT * FROM workspaces WHERE id = ?', wsId);
    });
    res.status(201).json({ workspace: serializeWorkspace(ws, 'admin'), ...session(db, req.user.id) });
  });

  r.get('/:ws', (req, res) => {
    const { ws, membership } = loadWorkspace(db, req.user, req.params.ws);
    const members = db.all(
      'SELECT u.*, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.joined_at',
      ws.id,
    ).map((u) => ({ ...serializeUser(u), role: u.role, joinedAt: u.joined_at }));
    const projects = db.all(
      `SELECT p.*,
         (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id) AS total,
         (SELECT COUNT(*) FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.project_id = p.id AND s.category = 'done') AS done
       FROM projects p WHERE p.workspace_id = ? AND p.archived = 0 ORDER BY p.created_at`,
      ws.id,
    ).map((p) => serializeProject(p, { issueCount: p.total, doneCount: p.done }));
    res.json({ workspace: serializeWorkspace(ws, membership.role), members, projects });
  });

  r.patch('/:ws', (req, res) => {
    const { ws, membership } = loadWorkspace(db, req.user, req.params.ws, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(2).max(60).optional(),
      region: z.enum(['uk', 'us', 'asia', 'other']).optional(),
      locale: z.enum(['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU']).optional(),
      weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body);
    if (body.name) db.run('UPDATE workspaces SET name = ? WHERE id = ?', body.name, ws.id);
    if (body.region) db.run('UPDATE workspaces SET region = ? WHERE id = ?', body.region, ws.id);
    if (body.locale) db.run('UPDATE workspaces SET locale = ? WHERE id = ?', body.locale, ws.id);
    if (body.weekStart !== undefined) db.run('UPDATE workspaces SET week_start = ? WHERE id = ?', body.weekStart, ws.id);
    events.changed(ws.id, ['workspace'], req.user.id);
    res.json(serializeWorkspace(db.get('SELECT * FROM workspaces WHERE id = ?', ws.id), membership.role));
  });

  r.patch('/:ws/members/:userId', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws, 'admin');
    const body = parse(z.object({ role }), req.body);
    const target = Number(req.params.userId);
    if (!db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', ws.id, target)) throw notFound('Member');
    if (body.role !== 'admin') ensureAnotherAdmin(db, ws.id, target);
    db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', body.role, ws.id, target);
    events.changed(ws.id, ['workspace'], req.user.id);
    res.json({ ok: true });
  });

  r.delete('/:ws/members/:userId', (req, res) => {
    const target = Number(req.params.userId);
    const { ws } = loadWorkspace(db, req.user, req.params.ws, target === req.user.id ? 'viewer' : 'admin');
    ensureAnotherAdmin(db, ws.id, target);
    db.tx(() => {
      db.run('UPDATE issues SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM projects WHERE workspace_id = ?)', target, ws.id);
      db.run('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?', ws.id, target);
    });
    events.changed(ws.id, ['workspace', 'issues'], req.user.id);
    res.json({ ok: true });
  });

  // ---- Invitations (unlimited, free) ----
  r.get('/:ws/invites', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws, 'admin');
    res.json(db.all('SELECT token, email, role, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC', ws.id)
      .map((i) => ({ token: i.token, email: i.email, role: i.role, createdAt: i.created_at })));
  });

  r.post('/:ws/invites', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws, 'admin');
    const body = parse(z.object({ emails: z.array(z.string().trim().toLowerCase().email()).max(200).default([]), role: role.default('member'), link: z.boolean().default(false) }), req.body);
    const created = db.tx(() => {
      const list = body.link ? [''] : [...new Set(body.emails)];
      if (!list.length) throw new HttpError(400, 'Add at least one email address.');
      return list.map((email) => {
        const existing = email && db.get('SELECT token FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL', ws.id, email);
        if (existing) return { token: existing.token, email, role: body.role };
        const token = randomBytes(18).toString('base64url');
        db.run('INSERT INTO invites (token, workspace_id, email, role, invited_by) VALUES (?, ?, ?, ?, ?)', token, ws.id, email, body.role, req.user.id);
        return { token, email, role: body.role };
      });
    });
    res.status(201).json(created);
  });

  r.delete('/:ws/invites/:token', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws, 'admin');
    db.run('DELETE FROM invites WHERE workspace_id = ? AND token = ?', ws.id, req.params.token);
    res.json({ ok: true });
  });

  // ---- Cross-project views ----
  r.get('/:ws/my-issues', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const rows = db.all(`${ISSUE_SELECT} WHERE p.workspace_id = ? AND p.archived = 0 AND i.assignee_id = ? ORDER BY s.category = 'done', i.due_date IS NULL, i.due_date, i.rank`, ws.id, req.user.id);
    res.json(rows.map(serializeIssue));
  });

  r.get('/:ws/search', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ issues: [], projects: [], people: [] });
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const keyMatch = q.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    const issues = db.all(
      `${ISSUE_SELECT} WHERE p.workspace_id = ? AND p.archived = 0 AND (i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.labels LIKE ? ESCAPE '\\' OR (p.key = ? COLLATE NOCASE AND i.number = ?))
       ORDER BY i.updated_at DESC LIMIT 20`,
      ws.id, like, like, like, keyMatch?.[1] ?? '', keyMatch ? Number(keyMatch[2]) : -1,
    ).map(serializeIssue);
    const projects = db.all("SELECT * FROM projects WHERE workspace_id = ? AND archived = 0 AND (name LIKE ? ESCAPE '\\' OR key LIKE ? ESCAPE '\\') LIMIT 5", ws.id, like, like).map((p) => serializeProject(p));
    const people = db.all("SELECT u.* FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ? AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\') LIMIT 5", ws.id, like, like).map(serializeUser);
    res.json({ issues, projects, people });
  });

  r.get('/:ws/activity', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    const rows = db.all(
      `SELECT a.*, p.key || '-' || i.number AS issue_key, i.title AS issue_title FROM activity a
        LEFT JOIN issues i ON i.id = a.issue_id LEFT JOIN projects p ON p.id = i.project_id
        WHERE a.workspace_id = ? ORDER BY a.id DESC LIMIT 30`,
      ws.id,
    );
    res.json(rows.map(serializeActivity));
  });

  r.get('/:ws/events', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws);
    hub.subscribe(ws.id, req.user.id, res);
  });

  r.post('/:ws/projects', (req, res) => {
    const { ws } = loadWorkspace(db, req.user, req.params.ws, 'member');
    const body = parse(projectInput, req.body);
    const memberIds = body.withSamples ? db.all('SELECT user_id FROM memberships WHERE workspace_id = ? ORDER BY joined_at', ws.id).map((m) => m.user_id) : [];
    const project = createProject(db, { workspaceId: ws.id, actor: req.user, ...body, memberIds });
    events.record({ workspaceId: ws.id, projectId: project.id, actorId: req.user.id, verb: 'project_created', data: { name: project.name } });
    events.changed(ws.id, ['workspace'], req.user.id);
    res.status(201).json(serializeProject(project));
  });

  return r;
}

function ensureAnotherAdmin(db, workspaceId, leavingUserId) {
  const admins = db.all("SELECT user_id FROM memberships WHERE workspace_id = ? AND role = 'admin'", workspaceId).map((a) => a.user_id);
  if (admins.length === 1 && admins[0] === leavingUserId) throw new HttpError(400, 'Every workspace needs at least one admin. Promote someone else first.');
}

/** Public invite lookup + acceptance (mounted separately so the preview works before sign-in). */
export function inviteRoutes({ db, events }) {
  const r = Router();
  const find = (token) => {
    const invite = db.get('SELECT i.*, w.name AS ws_name, w.slug, u.name AS inviter FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.invited_by WHERE i.token = ?', token);
    if (!invite || (invite.email && invite.accepted_at)) throw notFound('Invitation');
    return invite;
  };
  r.get('/:token', (req, res) => {
    const i = find(req.params.token);
    const members = db.get('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?', i.workspace_id).n;
    res.json({ workspaceName: i.ws_name, workspaceSlug: i.slug, inviter: i.inviter, email: i.email, role: i.role, members });
  });
  r.post('/:token/accept', requireUser, (req, res) => {
    const i = find(req.params.token);
    db.tx(() => {
      db.run('INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)', i.workspace_id, req.user.id, i.role);
      if (i.email) db.run("UPDATE invites SET accepted_at = datetime('now') WHERE token = ?", i.token);
    });
    events.record({ workspaceId: i.workspace_id, actorId: req.user.id, verb: 'member_joined', data: { name: req.user.name } });
    events.changed(i.workspace_id, ['workspace'], req.user.id);
    res.json({ workspaceSlug: i.slug, ...session(db, req.user.id) });
  });
  return r;
}
