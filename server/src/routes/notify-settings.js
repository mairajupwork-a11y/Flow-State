import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { requireUser } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { ISSUE_SELECT } from '../serialize.js';

const FEED_SELECT = ISSUE_SELECT.replace('SELECT i.*,', 'SELECT i.*, (SELECT w.slug FROM workspaces w WHERE w.id = p.workspace_id) AS slug,');

/**
 * Where notifications go (email / push), browser push subscriptions, and the
 * private calendar feed (subscribe from Google Calendar, Outlook or Apple).
 */
export function notifySettingsRoutes({ db, mailer, push, appUrl }) {
  const r = Router();
  const base = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const isPublic = (url) => !/^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);

  // ---- Calendar feed: authenticated by its secret link, so calendar apps can fetch it ----
  r.get('/calendar/:token', async (req, res) => {
    const token = String(req.params.token).replace(/\.ics$/, '');
    const user = token.length >= 20 ? await db.get('SELECT id, name FROM users WHERE calendar_token = ?', token) : null;
    if (!user) throw new HttpError(404, 'This calendar link is no longer valid. Copy a fresh one from WorkMars → Settings.');
    const items = await db.all(`${FEED_SELECT} WHERE i.assignee_id = ? AND i.due_date IS NOT NULL AND p.archived = 0
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = p.workspace_id AND m.user_id = ?)
        AND (s.category <> 'done' OR i.resolved_at >= ?) ORDER BY i.due_date LIMIT 1000`,
      user.id, user.id, new Date(Date.now() - 30 * 864e5).toISOString());
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="workmars.ics"');
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.send(ics(items, base(req), user.name));
  });

  r.use(['/settings', '/push', '/calendar/token'], requireUser);

  r.get('/settings/notifications', async (req, res) => {
    const u = await db.get('SELECT notify_email, notify_push, calendar_token FROM users WHERE id = ?', req.user.id);
    const devices = (await db.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', req.user.id)).n;
    const feed = u.calendar_token ? `${base(req)}/api/calendar/${u.calendar_token}.ics` : null;
    res.json({
      email: u.notify_email, push: u.notify_push, devices,
      emailAvailable: !!mailer, pushAvailable: !!push, pushKey: push?.publicKey ?? null,
      calendarUrl: feed, calendarReachable: feed ? isPublic(feed) : isPublic(base(req)),
    });
  });

  r.patch('/settings/notifications', async (req, res) => {
    const pref = z.enum(['all', 'important', 'off']);
    const body = parse(z.object({ email: pref.optional(), push: pref.optional() }), req.body);
    if (body.email) await db.run('UPDATE users SET notify_email = ? WHERE id = ?', body.email, req.user.id);
    if (body.push) await db.run('UPDATE users SET notify_push = ? WHERE id = ?', body.push, req.user.id);
    res.json({ ok: true });
  });

  r.post('/push/subscribe', async (req, res) => {
    if (!push) throw new HttpError(503, 'Push notifications are not available on this server.');
    const body = parse(z.object({
      endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'push endpoints are https'),
      keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
    }), req.body);
    // An endpoint belongs to one browser; if someone else signs in there, it moves to them.
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', body.endpoint);
    await db.run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)',
      req.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, String(req.get('user-agent') ?? '').slice(0, 200));
    res.status(201).json({ ok: true });
  });

  r.post('/push/unsubscribe', async (req, res) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, req.user.id);
    res.json({ ok: true });
  });

  r.post('/push/test', async (req, res) => {
    if (!push) throw new HttpError(503, 'Push notifications are not available on this server.');
    const result = await push.sendToUser(req.user.id, { title: 'WorkMars', body: 'Push notifications are working on this device. 🚀', url: '/', tag: 'test' });
    if (!result.devices) throw new HttpError(400, 'Turn on notifications on this device first.');
    res.json(result);
  });

  r.post('/calendar/token', async (req, res) => {
    const token = randomBytes(24).toString('base64url');
    await db.run('UPDATE users SET calendar_token = ? WHERE id = ?', token, req.user.id);
    const url = `${base(req)}/api/calendar/${token}.ics`;
    res.json({ calendarUrl: url, calendarReachable: isPublic(url) });
  });

  r.delete('/calendar/token', async (req, res) => {
    await db.run('UPDATE users SET calendar_token = NULL WHERE id = ?', req.user.id);
    res.json({ ok: true });
  });

  return r;
}

/** iCalendar (RFC 5545) text: one all-day event per due item. */
export function ics(items, base, ownerName = '') {
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Lines longer than 75 octets are folded with CRLF + space.
  const fold = (line) => {
    const out = [];
    let cur = '';
    for (const ch of line) {
      if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = ' ' + ch; } else cur += ch;
    }
    out.push(cur);
    return out.join('\r\n');
  };
  const day = (iso) => iso.replace(/-/g, '');
  const next = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const host = (() => { try { return new URL(base).hostname; } catch { return 'workmars'; } })();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkMars//Work items//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`WorkMars${ownerName ? ` · ${ownerName}` : ''}`)}`, 'X-WR-CALDESC:Your WorkMars work items by due date', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const i of items) {
    const key = `${i.project_key}-${i.number}`;
    const url = `${base}/w/${i.slug}?issue=${encodeURIComponent(key)}`;
    const done = i.status_category === 'done';
    lines.push('BEGIN:VEVENT', `UID:workmars-item-${i.id}@${host}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(i.due_date)}`, `DTEND;VALUE=DATE:${next(i.due_date)}`,
      `SUMMARY:${esc(`${done ? '✓ ' : ''}${key} · ${i.title}`)}`,
      `DESCRIPTION:${esc(`${i.status_name} · ${i.priority} priority\n${url}`)}`, `URL:${url}`,
      'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT', `CATEGORIES:${esc(i.project_key)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
