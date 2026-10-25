import { notificationEmail } from './emails.js';

/** Kinds worth interrupting someone for when they chose "important only". */
export const IMPORTANT = new Set(['assigned', 'mention', 'automation']);
export const wants = (pref, kind) => pref === 'all' || (pref === 'important' && IMPORTANT.has(kind));

/**
 * Sends a just-created notification beyond the in-app bell: email and push,
 * each according to the recipient's preference. Runs after the transaction
 * commits and never throws — a mail or push outage must not break the action.
 */
export function createDelivery({ db, mailer = null, push = null, appUrl = null, log = console }) {
  if (!mailer && !push) return null;
  return async function deliver({ userId, workspaceId, issueId, kind, text }) {
    try {
      const user = await db.get('SELECT id, email, name, notify_email, notify_push FROM users WHERE id = ?', userId);
      if (!user) return;
      const ws = await db.get('SELECT slug, name FROM workspaces WHERE id = ?', workspaceId);
      const key = issueId ? (await db.get('SELECT p.key || \'-\' || i.number AS k FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?', issueId))?.k : null;
      const path = `/w/${ws?.slug ?? ''}${key ? `?issue=${encodeURIComponent(key)}` : ''}`;
      const url = appUrl ? `${appUrl.replace(/\/$/, '')}${path}` : null;
      const jobs = [];
      if (mailer && wants(user.notify_email ?? 'important', kind)) {
        jobs.push(mailer.send(notificationEmail({ to: user.email, name: user.name, text, workspace: ws?.name ?? 'WorkMars', url, issueKey: key }))
          .catch((err) => log.warn?.(`Email notification to ${user.email} failed: ${err.message}`)));
      }
      if (push && wants(user.notify_push ?? 'important', kind)) {
        jobs.push(push.sendToUser(userId, { title: key ? `${key} · ${ws?.name ?? 'WorkMars'}` : ws?.name ?? 'WorkMars', body: text, url: path, tag: key ?? `n-${Date.now()}` }));
      }
      await Promise.all(jobs);
    } catch (err) {
      log.warn?.(`Notification delivery failed: ${err.message}`);
    }
  };
}
