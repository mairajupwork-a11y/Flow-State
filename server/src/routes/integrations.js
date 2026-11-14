import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import { HttpError, parse, notFound } from '../http.js';
import { loadWorkspace, loadIssue } from '../access.js';
import { CHAT_EVENTS, CHAT_KINDS, DEV_KINDS, checkChatUrl, handleDelivery, parseSettings, sendChat, verifyDelivery } from '../services/integrations.js';

const KINDS = [...DEV_KINDS, ...CHAT_KINDS];
const NAMES = { github: 'GitHub', gitlab: 'GitLab', slack: 'Slack', teams: 'Microsoft Teams', discord: 'Discord', googlechat: 'Google Chat' };

function serialize(row, base) {
  const dev = DEV_KINDS.includes(row.kind);
  return {
    id: row.id, kind: row.kind, name: row.name || NAMES[row.kind], settings: parseSettings(row), createdAt: row.created_at,
    lastEventAt: row.last_event_at, lastStatus: row.last_status,
    // Shown to managers so they can paste them into GitHub / GitLab.
    ...(dev ? { hookUrl: `${base}/api/hooks/${row.id}`, secret: row.secret } : { url: (() => { try { return `${new URL(row.url).hostname}/…`; } catch { return ''; } })() }),
  };
}

const settingsSchema = z.object({
  doneOnMerge: z.boolean().optional(),
  progressOnPr: z.boolean().optional(),
  events: z.array(z.enum(CHAT_EVENTS)).max(10).optional(),
  projectIds: z.array(z.number().int().positive()).max(200).optional(),
}).default({});

export function integrationRoutes({ db, events, appUrl, fetcher }) {
  const r = Router();
  const base = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

  r.get('/workspaces/:ws/integrations', requireUser, async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'manager');
    res.json((await db.all('SELECT * FROM integrations WHERE workspace_id = ? ORDER BY id', ws.id)).map((row) => serialize(row, base(req))));
  });

  r.post('/workspaces/:ws/integrations', requireUser, async (req, res) => {
    const { ws } = await loadWorkspace(db, req.user, req.params.ws, 'manager');
    const body = parse(z.object({ kind: z.enum(KINDS), name: z.string().trim().max(60).default(''), url: z.string().trim().max(600).default(''), settings: settingsSchema }), req.body);
    const dev = DEV_KINDS.includes(body.kind);
    const url = dev ? '' : checkChatUrl(body.kind, body.url);
    const secret = dev ? randomBytes(24).toString('hex') : '';
    const { lastInsertRowid } = await db.run('INSERT INTO integrations (workspace_id, kind, name, secret, url, settings, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ws.id, body.kind, body.name, secret, url, JSON.stringify(body.settings), req.user.id);
    await db.run('INSERT INTO audit_log (workspace_id, user_id, action, target, ip) VALUES (?, ?, ?, ?, ?)', ws.id, req.user.id, 'integration.added', NAMES[body.kind], req.ip ?? '');
    res.status(201).json(serialize(await db.get('SELECT * FROM integrations WHERE id = ?', Number(lastInsertRowid)), base(req)));
  });

  const loadOwn = async (req) => {
    const row = await db.get('SELECT * FROM integrations WHERE id = ?', Number(req.params.id));
    if (!row) throw notFound('Connection');
    const { ws } = await loadWorkspace(db, req.user, String(row.workspace_id), 'manager');
    if (ws.id !== row.workspace_id) throw notFound('Connection');
    return row;
  };

  r.patch('/integrations/:id', requireUser, async (req, res) => {
    const row = await loadOwn(req);
    const body = parse(z.object({ name: z.string().trim().max(60).optional(), settings: settingsSchema.optional() }), req.body);
    if (body.name !== undefined) await db.run('UPDATE integrations SET name = ? WHERE id = ?', body.name, row.id);
    if (body.settings) await db.run('UPDATE integrations SET settings = ? WHERE id = ?', JSON.stringify({ ...parseSettings(row), ...body.settings }), row.id);
    res.json(serialize(await db.get('SELECT * FROM integrations WHERE id = ?', row.id), base(req)));
  });

  r.delete('/integrations/:id', requireUser, async (req, res) => {
    const row = await loadOwn(req);
    await db.run('DELETE FROM integrations WHERE id = ?', row.id);
    await db.run('INSERT INTO audit_log (workspace_id, user_id, action, target, ip) VALUES (?, ?, ?, ?, ?)', row.workspace_id, req.user.id, 'integration.removed', NAMES[row.kind], req.ip ?? '');
    res.json({ ok: true });
  });

  /** Chat channels: post a hello message so people can check the connection right away. */
  r.post('/integrations/:id/test', requireUser, async (req, res) => {
    const row = await loadOwn(req);
    if (!CHAT_KINDS.includes(row.kind)) throw new HttpError(400, 'Send a test from GitHub or GitLab instead (“Recent deliveries” → Redeliver).');
    try {
      await sendChat(fetcher, row, '👋 WorkMars is connected. You’ll see new work, finished work and comments here.', appUrl || null);
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = 'ok' WHERE id = ?", row.id);
      res.json({ ok: true });
    } catch (err) {
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = ? WHERE id = ?", `Failed: ${err.message}`.slice(0, 200), row.id);
      throw new HttpError(502, `The message didn’t go through (${err.message}). Check the webhook address.`);
    }
  });

  /** Development panel on a work item: linked branches, commits and pull/merge requests. */
  r.get('/issues/:ref/dev', requireUser, async (req, res) => {
    const { issue } = await loadIssue(db, req.user, req.params.ref);
    const rows = await db.all('SELECT * FROM dev_links WHERE issue_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100', issue.id);
    res.json(rows.map((l) => ({ id: l.id, provider: l.provider, kind: l.kind, extId: l.ext_id, title: l.title, url: l.url, state: l.state, author: l.author, updatedAt: l.updated_at })));
  });

  return r;
}

/** Public webhook receiver for GitHub and GitLab. Mounted before the JSON parser so the signature covers the exact bytes. */
export function hookReceiver({ db, events, log = console }) {
  return async (req, res) => {
    const row = /^\d+$/.test(req.params.id) ? await db.get('SELECT * FROM integrations WHERE id = ?', Number(req.params.id)) : null;
    if (!row || !DEV_KINDS.includes(row.kind)) return res.status(404).json({ error: 'Unknown webhook.' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyDelivery(row, req.headers, raw)) {
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = ? WHERE id = ?", 'Rejected: the secret didn’t match', row.id);
      return res.status(401).json({ error: 'Signature or token did not match. Copy the secret from WorkMars again.' });
    }
    const event = String(req.get('X-GitHub-Event') ?? req.get('X-Gitlab-Event') ?? '').toLowerCase().replace(/ hook$/, '').replace(/ /g, '_');
    if (event === 'ping') {
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = 'ok' WHERE id = ?", row.id);
      return res.json({ ok: true, pong: true });
    }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Send the webhook as application/json.' }); }
    try {
      const touched = await db.tx(() => handleDelivery(db, { integration: row, event, payload, events }));
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = ? WHERE id = ?", touched ? `ok · linked ${touched} work item${touched === 1 ? '' : 's'}` : 'ok · no work item keys found', row.id);
      res.json({ ok: true, linked: touched });
    } catch (err) {
      log.warn?.(`Webhook ${row.id} failed: ${err.message}`);
      await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = ? WHERE id = ?", `Failed: ${err.message}`.slice(0, 200), row.id);
      res.status(500).json({ error: 'Could not process this delivery.' });
    }
  };
}
