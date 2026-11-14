import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireUser, rateLimit } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadWorkspace, lockRow, VISIBLE_PROJECT } from '../access.js';
import { accessForDesignation } from '../../../shared/designations.js';
import { createProject } from '../services/projects.js';
import { METHODOLOGY_IDS } from '../../../shared/methodologies.js';
import { ISSUE_SELECT, issue as serializeIssue, user as serializeUser, workspace as serializeWorkspace, project as serializeProject, activity as serializeActivity } from '../serialize.js';
import { session } from './auth.js';
import { inviteEmail, mailHint } from '../emails.js';

const REGIONS = { uk: { locale: 'en-GB', weekStart: 1 }, us: { locale: 'en-US', weekStart: 0 }, asia: { locale: 'en-SG', weekStart: 1 }, other: { locale: 'en-GB', weekStart: 1 } };
const role = z.enum(['admin', 'manager', 'member', 'viewer']);
const projectIds = z.array(z.number().int().positive()).max(200).default([]);
/** en-US style dates and Sunday weeks for the US, Asia-Pacific formats, otherwise UK style. */
const regionFor = (locale) => (locale === 'en-US' ? 'us' : ['en-IN', 'en-SG', 'en-AU'].includes(locale) ? 'asia' : 'uk');
/** Job title someone is invited as — from the suggested list or typed in. */
const designation = z.string().trim().max(80, 'keep the designation under 80 characters').default('');
const projectInput = z.object({
  name: z.string().trim().min(1, 'give the project a name').max(80),
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,5}$/, 'use 2–6 letters or numbers, starting with a letter').optional(),
  description: z.string().trim().max(500).optional(),
  methodology: z.enum(METHODOLOGY_IDS).optional(),
  template: z.enum(['scrum', 'kanban', 'business']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  memberIds: z.array(z.number().int().positive()).max(500).optional(),
  autoKey: z.boolean().optional(),
});

async function slugify(db, name) {
  let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
  if (/^\d+$/.test(base)) base = `ws-${base}`; // all-digit refs are read as ids
  let slug = base;
  while (await db.get('SELECT 1 FROM workspaces WHERE slug = ?', slug)) slug = `${base}-${randomBytes(2).toString('hex')}`;
  return slug;
}

export function workspaceRoutes({ db, events, hub, mailer, appUrl, production }) {
  const r = Router();
  r.use(requireUser);
  // Invitation emails go out from the operator's mail account, so cap how fast one person can send them.
  const inviteLimiter = rateLimit({
    windowMs: 60 * 60_000, max: production ? 30 : 10_000, key: (req) => `u${req.user.id}`,
    message: 'You’ve sent a lot of invitations in the last hour. Please wait a while, or share invite links instead.',
  });

  // Links in emails must point at the address people actually open WorkMars on.
  const baseUrl = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  /** Emails each invite (when SMTP is configured); never fails the request. */
  const emailInvites = (req, workspaceName, invites) => Promise.all(invites.map(async (inv) => {
    if (!mailer || !inv.email) return { ...inv, emailed: false };
    try {
      await mailer.send(inviteEmail({ to: inv.email, inviter: req.user.name, workspace: workspaceName, role: inv.role, designation: inv.designation, url: `${baseUrl(req)}/invite/${inv.token}` }));
      return { ...inv, emailed: true };
    } catch (err) {
      console.error(`Invite email to ${inv.email} failed:`, err.message);
      return { ...inv, emailed: false, emailError: mailHint(err.message) };
    }
  }));

  /** Onboarding: creates the workspace, its first project and pending invites in one step. */
  r.post('/', async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(2, 'use at least 2 characters').max(60),
      region: z.enum(['uk', 'us', 'asia', 'other']).optional(),
      // Taken from the browser during setup; changeable later in Settings.
      locale: z.enum(['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU']).optional(),
      weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
      teamSize: z.string().max(20).default(''),
      useCase: z.string().max(60).default(''),
      jobTitle: z.string().trim().max(80).optional(),
      project: projectInput.optional(),
      invites: z.array(z.string().trim().toLowerCase().email()).max(200).default([]),
      inviteDesignation: designation,
    }), req.body);
    const createdInvites = [];
    const ws = await db.tx(async () => {
      const fromRegion = body.region ? REGIONS[body.region] : null;
      const locale = body.locale ?? fromRegion?.locale ?? 'en-GB';
      const preset = { locale, weekStart: body.weekStart ?? fromRegion?.weekStart ?? (locale === 'en-US' ? 0 : 1) };
      const { lastInsertRowid } = await db.run(
        'INSERT INTO workspaces (name, slug, region, locale, week_start, team_size, use_case, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        body.name, await slugify(db, body.name), body.region ?? regionFor(locale), preset.locale, preset.weekStart, body.teamSize, body.useCase, req.user.id,
      );
      const wsId = Number(lastInsertRowid);
      await db.run("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'admin')", wsId, req.user.id);
      await db.run('UPDATE users SET locale = ? WHERE id = ?', preset.locale, req.user.id);
      if (body.jobTitle) await db.run('UPDATE users SET job_title = ? WHERE id = ?', body.jobTitle, req.user.id);
      const first = body.project ? await createProject(db, { workspaceId: wsId, actor: req.user, ...body.project }) : null;
      // People invited during setup join the first project, at the access level their designation suggests.
      const inviteRole = accessForDesignation(body.inviteDesignation);
      for (const email of new Set(body.invites)) {
        const token = randomBytes(18).toString('base64url');
        await db.run('INSERT INTO invites (token, workspace_id, email, role, invited_by, designation, project_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
          token, wsId, email, inviteRole, req.user.id, body.inviteDesignation, JSON.stringify(first ? [first.id] : []));
        createdInvites.push({ token, email, role: inviteRole, designation: body.inviteDesignation });
      }
      await events.record({ workspaceId: wsId, actorId: req.user.id, verb: 'workspace_created', data: { name: body.name } });
      return await db.get('SELECT * FROM workspaces WHERE id = ?', wsId);
    });
    const invites = await emailInvites(req, ws.name, createdInvites);
    res.status(201).json({ workspace: serializeWorkspace(ws, 'admin'), invites, ...await session(db, req.user.id) });
  });

  r.get('/:ws', async (req, res) => {
    const { ws, membership } = await loadWorkspace(db, req.user, req.params.ws);
    const members = (await db.all(
      'SELECT u.*, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.joined_at, u.id',
      ws.id,
    )).map((u) => ({ ...serializeUser(u), role: u.role, joinedAt: u.joined_at }));
    const projects = (await db.all(
      `SELECT p.*,
         (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id) AS total,
         (SELECT COUNT(*) FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.project_id = p.id AND s.category = 'done') AS done
       FROM projects p WHERE p.workspace_id = ? AND p.archived = 0 AND ${VISIBLE_PROJECT('p')} ORDER BY p.created_at, p.id`,
      ws.id, req.user.id, req.user.id,
    )).map((p) => serializeProject(p, { issueCount: p.total, doneCount: p.done }));
    // Every key in use, archived and hidden projects included, so new projects can pick a free one.
    const takenKeys = (await db.all('SELECT key FROM projects WHERE workspace_id = ?', ws.id)).map((r) => r.key);
    res.json({ workspace: serializeWorkspace(ws, membership.role), members, projects, takenKeys });
  });

  r.patch('/:ws', async (req, res) => {
    const { ws, membership } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    const body = parse(z.object({
      name: z.string().trim().min(2).max(60).optional(),
      region: z.enum(['uk', 'us', 'asia', 'other']).optional(),
      locale: z.enum(['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU']).optional(),
      weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    }), req.body);
    if (body.name) await db.run('UPDATE workspaces SET name = ? WHERE id = ?', body.name, ws.id);
    if (body.region) await db.run('UPDATE workspaces SET region = ? WHERE id = ?', body.region, ws.id);
    if (body.locale) await db.run('UPDATE workspaces SET locale = ? WHERE id = ?', body.locale, ws.id);
    if (body.weekStart !== undefined) await db.run('UPDATE workspaces SET week_start = ? WHERE id = ?', body.weekStart, ws.id);
    events.changed(ws.id, ['workspace'], req.user.id);
    res.json(serializeWorkspace(await db.get('SELECT * FROM workspaces WHERE id = ?', ws.id), membership.role));
  });

  r.patch('/:ws/members/:userId', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    // Admins set each person's access level and designation (job title).
    const body = parse(z.object({ role: role.optional(), designation: z.string().trim().max(80, 'keep the designation under 80 characters').optional() }), req.body);
    const target = Number(req.params.userId);
    await db.tx(async () => {
      await lockRow(db, 'workspaces', ws.id);
      if (!await db.get('SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?', ws.id, target)) throw notFound('Member');
      if (body.role) {
        if (body.role !== 'admin') await ensureAnotherAdmin(db, ws.id, target);
        await db.run('UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?', body.role, ws.id, target);
      }
      if (body.designation !== undefined) await db.run('UPDATE users SET job_title = ? WHERE id = ?', body.designation, target);
    });
    events.changed(ws.id, ['workspace'], req.user.id);
    res.json({ ok: true });
  });

  r.delete('/:ws/members/:userId', async (req, res) => {
    const target = Number(req.params.userId);
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, target === req.user.id ? 'viewer' : 'admin');
    await db.tx(async () => {
      await lockRow(db, 'workspaces', ws.id);
      await ensureAnotherAdmin(db, ws.id, target);
      // Clear everything that would keep pointing at (or notifying) the ex-member.
      const inWs = 'IN (SELECT id FROM projects WHERE workspace_id = ?)';
      await db.run(`DELETE FROM issue_assignees WHERE user_id = ? AND issue_id IN (SELECT id FROM issues WHERE project_id ${inWs})`, target, ws.id);
      await db.run(`UPDATE issues SET assignee_id = (SELECT ia.user_id FROM issue_assignees ia WHERE ia.issue_id = issues.id ORDER BY ia.position, ia.user_id LIMIT 1)
        WHERE assignee_id = ? AND project_id ${inWs}`, target, ws.id);
      await db.run(`DELETE FROM project_members WHERE user_id = ? AND project_id ${inWs}`, target, ws.id);
      await db.run(`DELETE FROM watchers WHERE user_id = ? AND issue_id IN (SELECT id FROM issues WHERE project_id ${inWs})`, target, ws.id);
      await db.run('UPDATE projects SET lead_id = NULL WHERE lead_id = ? AND workspace_id = ?', target, ws.id);
      await db.run(`UPDATE entries SET owner_id = NULL WHERE owner_id = ? AND project_id ${inWs}`, target, ws.id);
      await db.run('DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?', ws.id, target);
    });
    hub.kick(ws.id, target);
    events.changed(ws.id, ['workspace', 'issues'], req.user.id);
    res.json({ ok: true });
  });

  // ---- Invitations (unlimited, free) ----
  r.get('/:ws/invites', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    res.json((await db.all('SELECT token, email, role, designation, created_at FROM invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC, email', ws.id))
      .map((i) => ({ token: i.token, email: i.email, role: i.role, designation: i.designation, createdAt: i.created_at })));
  });

  r.post('/:ws/invites', inviteLimiter, async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    const body = parse(z.object({ emails: z.array(z.string().trim().toLowerCase().email()).max(200).default([]), role: role.default('member'), designation, link: z.boolean().default(false), projectIds }), req.body);
    const ownProjects = new Set((await db.all('SELECT id FROM projects WHERE workspace_id = ?', ws.id)).map((p) => p.id));
    const projectJson = JSON.stringify(body.projectIds.filter((id) => ownProjects.has(id)));
    const created = await db.tx(async () => {
      const list = body.link ? [''] : [...new Set(body.emails)];
      if (!list.length) throw new HttpError(400, 'Add at least one email address.');
      const out = [];
      for (const email of list) {
        const existing = email && await db.get('SELECT token FROM invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL', ws.id, email);
        if (existing) {
          // Re-inviting updates the pending invite to the latest role and designation.
          await db.run('UPDATE invites SET role = ?, designation = ?, project_ids = ? WHERE token = ?', body.role, body.designation, projectJson, existing.token);
          out.push({ token: existing.token, email, role: body.role, designation: body.designation });
          continue;
        }
        const token = randomBytes(18).toString('base64url');
        await db.run('INSERT INTO invites (token, workspace_id, email, role, invited_by, designation, project_ids) VALUES (?, ?, ?, ?, ?, ?, ?)', token, ws.id, email, body.role, req.user.id, body.designation, projectJson);
        out.push({ token, email, role: body.role, designation: body.designation });
      }
      return out;
    });
    res.status(201).json(await emailInvites(req, ws.name, created));
  });

  r.post('/:ws/invites/:token/resend', inviteLimiter, async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    const inv = await db.get('SELECT token, email, role, designation FROM invites WHERE workspace_id = ? AND token = ? AND accepted_at IS NULL', ws.id, req.params.token);
    if (!inv) throw notFound('Invitation');
    if (!inv.email) throw new HttpError(400, 'Team links are shared by copying the link, not by email.');
    if (!mailer) throw new HttpError(400, 'Email isn’t set up on this WorkMars yet — copy the link instead (see EMAIL.md).');
    const [result] = await emailInvites(req, ws.name, [inv]);
    if (!result.emailed) throw new HttpError(502, `The email could not be sent. ${result.emailError}`);
    res.json(result);
  });

  r.delete('/:ws/invites/:token', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'admin');
    await db.run('DELETE FROM invites WHERE workspace_id = ? AND token = ?', ws.id, req.params.token);
    res.json({ ok: true });
  });

  // ---- Cross-project views ----
  r.get('/:ws/my-issues', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws);
    const rows = await db.all(`${ISSUE_SELECT} WHERE p.workspace_id = ? AND p.archived = 0
        AND EXISTS (SELECT 1 FROM issue_assignees ia WHERE ia.issue_id = i.id AND ia.user_id = ?) AND ${VISIBLE_PROJECT('p')}
      ORDER BY s.category = 'done', i.due_date IS NULL, i.due_date, i.rank`, ws.id, req.user.id, req.user.id, req.user.id);
    res.json(rows.map(serializeIssue));
  });

  r.get('/:ws/search', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws);
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ issues: [], projects: [], people: [] });
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const keyMatch = q.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    const issues = (await db.all(
      `${ISSUE_SELECT} WHERE p.workspace_id = ? AND p.archived = 0 AND ${VISIBLE_PROJECT('p')} AND (i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.labels LIKE ? ESCAPE '\\' OR (UPPER(p.key) = UPPER(?) AND i.number = ?))
       ORDER BY i.updated_at DESC LIMIT 20`,
      ws.id, req.user.id, req.user.id, like, like, like, keyMatch?.[1] ?? '', keyMatch ? Number(keyMatch[2]) : -1,
    )).map(serializeIssue);
    const projects = (await db.all(`SELECT * FROM projects p WHERE p.workspace_id = ? AND p.archived = 0 AND ${VISIBLE_PROJECT('p')} AND (p.name LIKE ? ESCAPE '\\' OR p.key LIKE ? ESCAPE '\\') LIMIT 5`, ws.id, req.user.id, req.user.id, like, like)).map((p) => serializeProject(p));
    const people = (await db.all("SELECT u.* FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.workspace_id = ? AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\') LIMIT 5", ws.id, like, like)).map(serializeUser);
    res.json({ issues, projects, people });
  });

  r.get('/:ws/activity', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws);
    const rows = await db.all(
      `SELECT a.*, p.key || '-' || i.number AS issue_key, i.title AS issue_title FROM activity a
        LEFT JOIN issues i ON i.id = a.issue_id LEFT JOIN projects p ON p.id = i.project_id
        LEFT JOIN projects ap ON ap.id = a.project_id
        WHERE a.workspace_id = ? AND (ap.id IS NULL OR ${VISIBLE_PROJECT('ap')}) ORDER BY a.id DESC LIMIT 30`,
      ws.id, req.user.id, req.user.id,
    );
    res.json(rows.map(serializeActivity));
  });

  r.get('/:ws/events', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws);
    hub.subscribe(ws.id, req.user.id, res);
  });

  r.post('/:ws/projects', async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'manager');
    const body = parse(projectInput, req.body);
    const project = await createProject(db, { workspaceId: ws.id, actor: req.user, ...body });
    await events.record({ workspaceId: ws.id, projectId: project.id, actorId: req.user.id, verb: 'project_created', data: { name: project.name } });
    events.changed(ws.id, ['workspace'], req.user.id);
    res.status(201).json(serializeProject(project));
  });

  return r;
}

async function ensureAnotherAdmin(db, workspaceId, leavingUserId) {
  const admins = (await db.all("SELECT user_id FROM memberships WHERE workspace_id = ? AND role = 'admin'", workspaceId)).map((a) => a.user_id);
  if (admins.length === 1 && admins[0] === leavingUserId) throw new HttpError(400, 'Every workspace needs at least one admin. Promote someone else first.');
}

/** Public invite lookup + acceptance (mounted separately so the preview works before sign-in). */
export function inviteRoutes({ db, events }) {
  const r = Router();
  const find = async (token) => {
    const invite = await db.get('SELECT i.*, w.name AS ws_name, w.slug, u.name AS inviter FROM invites i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.invited_by WHERE i.token = ?', token);
    if (!invite || (invite.email && invite.accepted_at)) throw notFound('Invitation');
    return invite;
  };
  r.get('/:token', async (req, res) => {
    const i = await find(req.params.token);
    const members = (await db.get('SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ?', i.workspace_id)).n;
    res.json({ workspaceName: i.ws_name, workspaceSlug: i.slug, inviter: i.inviter, email: i.email, role: i.role, designation: i.designation ?? '', members });
  });
  r.post('/:token/accept', requireUser, async (req, res) => {
    const i = await find(req.params.token);
    await db.tx(async () => {
      await db.run('INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)', i.workspace_id, req.user.id, i.role);
      for (const pid of JSON.parse(i.project_ids || '[]')) {
        if (await db.get('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?', pid, i.workspace_id)) {
          await db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', pid, req.user.id);
        }
      }
      // The designation they were invited as becomes their job title, unless
      // they already set one while belonging to another workspace.
      const others = (await db.get('SELECT COUNT(*) AS n FROM memberships WHERE user_id = ? AND workspace_id <> ?', req.user.id, i.workspace_id)).n;
      if (i.designation && (!req.user.job_title || !others)) await db.run('UPDATE users SET job_title = ? WHERE id = ?', i.designation, req.user.id);
      if (i.email) await db.run("UPDATE invites SET accepted_at = datetime('now') WHERE token = ?", i.token);
    });
    await events.record({ workspaceId: i.workspace_id, actorId: req.user.id, verb: 'member_joined', data: { name: req.user.name } });
    events.changed(i.workspace_id, ['workspace'], req.user.id);
    res.json({ workspaceSlug: i.slug, ...await session(db, req.user.id) });
  });
  return r;
}
