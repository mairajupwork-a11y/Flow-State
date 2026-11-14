/**
 * Connections to the tools software houses already use:
 *  - GitHub / GitLab webhooks link branches, commits and pull/merge requests to
 *    work items (by key, e.g. WEB-101) and can move them along the board.
 *  - Chat channels (Slack, Microsoft Teams, Discord, Google Chat) get a short
 *    message when work is created, finished, assigned or commented on.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';

export const DEV_KINDS = ['github', 'gitlab'];
export const CHAT_KINDS = ['slack', 'teams', 'discord', 'googlechat'];
export const CHAT_EVENTS = ['created', 'done', 'assigned', 'comment'];

/** Only the real webhook hosts of each chat app are accepted (no requests to arbitrary or internal addresses). */
const CHAT_HOSTS = {
  slack: (h) => h === 'hooks.slack.com',
  discord: (h) => h === 'discord.com' || h === 'discordapp.com' || h === 'ptb.discord.com' || h === 'canary.discord.com',
  googlechat: (h) => h === 'chat.googleapis.com',
  teams: (h) => h.endsWith('.webhook.office.com') || h.endsWith('.logic.azure.com') || h.endsWith('.environment.api.powerplatform.com'),
};
const CHAT_HELP = {
  slack: 'a Slack incoming-webhook address (https://hooks.slack.com/services/…)',
  discord: 'a Discord webhook address (https://discord.com/api/webhooks/…)',
  googlechat: 'a Google Chat webhook address (https://chat.googleapis.com/v1/spaces/…)',
  teams: 'a Microsoft Teams webhook address (…webhook.office.com/… or a Workflows …logic.azure.com/… link)',
};
export function checkChatUrl(kind, url) {
  let u;
  try { u = new URL(url); } catch { throw new HttpError(400, `Paste ${CHAT_HELP[kind]}.`); }
  if (u.protocol !== 'https:' || !CHAT_HOSTS[kind](u.hostname.toLowerCase())) throw new HttpError(400, `That doesn’t look like ${CHAT_HELP[kind]}.`);
  return u.toString();
}

export const parseSettings = (row) => { try { return JSON.parse(row.settings || '{}'); } catch { return {}; } };

// ---------------- GitHub / GitLab ----------------

/** GitHub signs the raw body with the shared secret (X-Hub-Signature-256); GitLab sends the token as-is. */
export function verifyDelivery(integration, headers, raw) {
  if (integration.kind === 'github') {
    const sig = String(headers['x-hub-signature-256'] ?? '');
    const want = 'sha256=' + createHmac('sha256', integration.secret).update(raw).digest('hex');
    return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  }
  if (integration.kind === 'gitlab') {
    const token = String(headers['x-gitlab-token'] ?? '');
    return token.length === integration.secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(integration.secret));
  }
  return false;
}

/** Turns a GitHub or GitLab delivery into links: { kind, extId, title, url, state, author, text, merged?, opened? }. */
export function readDelivery(kind, event, p) {
  const out = [];
  if (kind === 'github') {
    if (event === 'push') {
      const branch = String(p.ref ?? '').replace(/^refs\/heads\//, '');
      if (branch) out.push({ kind: 'branch', extId: branch, title: branch, url: p.repository?.html_url ? `${p.repository.html_url}/tree/${branch}` : '', state: p.deleted ? 'deleted' : 'active', author: p.pusher?.name ?? '', text: branch });
      for (const c of p.commits ?? []) out.push({ kind: 'commit', extId: c.id, title: String(c.message ?? '').split('\n')[0].slice(0, 200), url: c.url ?? '', state: 'pushed', author: c.author?.name ?? '', text: c.message ?? '' });
    } else if (event === 'pull_request' && p.pull_request) {
      const pr = p.pull_request;
      const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
      out.push({ kind: 'pr', extId: String(pr.number), title: `#${pr.number} ${pr.title}`.slice(0, 200), url: pr.html_url ?? '', state, author: pr.user?.login ?? '',
        text: `${pr.title} ${pr.head?.ref ?? ''} ${pr.body ?? ''}`, merged: !!pr.merged && p.action === 'closed', opened: ['opened', 'reopened', 'ready_for_review'].includes(p.action) });
    }
  } else if (kind === 'gitlab') {
    const k = p.object_kind ?? event;
    if (k === 'push') {
      const branch = String(p.ref ?? '').replace(/^refs\/heads\//, '');
      if (branch) out.push({ kind: 'branch', extId: branch, title: branch, url: p.project?.web_url ? `${p.project.web_url}/-/tree/${branch}` : '', state: 'active', author: p.user_name ?? '', text: branch });
      for (const c of p.commits ?? []) out.push({ kind: 'commit', extId: c.id, title: String(c.message ?? c.title ?? '').split('\n')[0].slice(0, 200), url: c.url ?? '', state: 'pushed', author: c.author?.name ?? '', text: c.message ?? '' });
    } else if (k === 'merge_request' && p.object_attributes) {
      const mr = p.object_attributes;
      const state = mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : mr.draft || mr.work_in_progress ? 'draft' : 'open';
      out.push({ kind: 'pr', extId: String(mr.iid), title: `!${mr.iid} ${mr.title}`.slice(0, 200), url: mr.url ?? '', state, author: p.user?.username ?? p.user?.name ?? '',
        text: `${mr.title} ${mr.source_branch ?? ''} ${mr.description ?? ''}`, merged: mr.action === 'merge', opened: ['open', 'reopen'].includes(mr.action) });
    }
  }
  return out;
}

/** Work items in this workspace whose keys appear in the text (WEB-101, web-101, feature/WEB-101-login…). */
export async function findIssues(db, workspaceId, text) {
  const found = new Map();
  const re = /(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,7})(?![0-9])/g;
  let m;
  while ((m = re.exec(String(text))) && found.size < 20) {
    const key = `${m[1].toUpperCase()}-${m[2]}`;
    if (found.has(key)) continue;
    const row = await db.get(
      'SELECT i.*, p.key AS project_key FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.workspace_id = ? AND UPPER(p.key) = ? AND i.number = ?',
      workspaceId, m[1].toUpperCase(), Number(m[2]),
    );
    if (row) found.set(key, row);
  }
  return [...found.values()];
}

/** Processes one verified delivery. Returns how many work items were touched. */
export async function handleDelivery(db, { integration, event, payload, events }) {
  const { updateIssue } = await import('./issues.js');
  const settings = parseSettings(integration);
  const links = readDelivery(integration.kind, event, payload);
  const provider = integration.kind === 'github' ? 'GitHub' : 'GitLab';
  const bot = { id: null, name: provider };
  let touched = 0;
  for (const link of links) {
    for (const issue of await findIssues(db, integration.workspace_id, link.text)) {
      const existing = await db.get('SELECT id, state FROM dev_links WHERE issue_id = ? AND provider = ? AND kind = ? AND ext_id = ?', issue.id, integration.kind, link.kind, link.extId);
      if (existing) {
        await db.run("UPDATE dev_links SET title = ?, url = ?, state = ?, author = ?, updated_at = datetime('now') WHERE id = ?", link.title, link.url, link.state, link.author, existing.id);
      } else {
        await db.run('INSERT INTO dev_links (issue_id, provider, kind, ext_id, title, url, state, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          issue.id, integration.kind, link.kind, link.extId, link.title, link.url, link.state, link.author);
        if (events) await events.record({ workspaceId: integration.workspace_id, projectId: issue.project_id, issueId: issue.id, actorId: null, verb: 'dev_linked', data: { provider, kind: link.kind, title: link.title, url: link.url } });
      }
      // Move the card along, if this connection is set to.
      const project = await db.get('SELECT * FROM projects WHERE id = ?', issue.project_id);
      const status = await db.get('SELECT category FROM statuses WHERE id = ?', issue.status_id);
      let target = null;
      if (link.kind === 'pr' && link.merged && settings.doneOnMerge !== false && status?.category !== 'done') {
        target = await db.get("SELECT id FROM statuses WHERE project_id = ? AND category = 'done' ORDER BY position LIMIT 1", project.id);
      } else if (link.kind === 'pr' && link.opened && settings.progressOnPr !== false && status?.category === 'todo') {
        target = await db.get("SELECT id FROM statuses WHERE project_id = ? AND category = 'progress' ORDER BY position LIMIT 1", project.id);
      }
      if (target) await updateIssue(db, { issueRow: issue, project, actor: bot, input: { statusId: target.id }, events });
      if (events) events.changed(integration.workspace_id, ['issues', `issue:${issue.id}`, `project:${project.id}`], null);
      touched++;
    }
  }
  return touched;
}

// ---------------- Chat channels ----------------

function chatBody(kind, text, url) {
  const line = url ? (kind === 'slack' ? `${text} <${url}|Open>` : `${text}\n${url}`) : text;
  if (kind === 'discord') return { content: line.slice(0, 1900), allowed_mentions: { parse: [] } };
  if (kind === 'teams') return { text: line };
  return { text: line };
}

export async function sendChat(fetcher, integration, text, url) {
  const res = await fetcher(integration.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatBody(integration.kind, text, url)), signal: AbortSignal.timeout?.(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Called after each activity record commits. Turns it into a chat line for every
 * channel in the workspace that wants that kind of event. Never throws.
 */
export function createChatRelay({ db, fetcher, appUrl, log = console }) {
  if (!fetcher) return null;
  return async function relay({ workspaceId, projectId, issueId, actorId, verb, data }) {
    try {
      let event = null;
      if (verb === 'created') event = 'created';
      else if (verb === 'commented') event = 'comment';
      else if (verb === 'updated' && data?.field === 'assigneeIds' && data?.to) event = 'assigned';
      else if (verb === 'updated' && data?.field === 'statusId') {
        const done = issueId && await db.get("SELECT 1 FROM issues i JOIN statuses s ON s.id = i.status_id WHERE i.id = ? AND s.category = 'done'", issueId);
        if (done) event = 'done';
      }
      if (!event) return;
      const channels = (await db.all(`SELECT * FROM integrations WHERE workspace_id = ? AND kind IN (${CHAT_KINDS.map(() => '?').join(',')})`, workspaceId, ...CHAT_KINDS))
        .filter((c) => {
          const s = parseSettings(c);
          return (s.events ?? ['created', 'done', 'comment']).includes(event) && (!s.projectIds?.length || s.projectIds.includes(projectId));
        });
      if (!channels.length) return;
      const issue = issueId ? await db.get('SELECT i.number, i.title, p.key, w.slug FROM issues i JOIN projects p ON p.id = i.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE i.id = ?', issueId) : null;
      if (!issue) return;
      const who = actorId ? (await db.get('SELECT name FROM users WHERE id = ?', actorId))?.name ?? 'Someone' : 'WorkMars';
      const key = `${issue.key}-${issue.number}`;
      const text = {
        created: `🆕 ${who} created ${key} “${issue.title}”`,
        done: `✅ ${who} finished ${key} “${issue.title}”`,
        assigned: `👤 ${who} assigned ${key} “${issue.title}” to ${data.to}`,
        comment: `💬 ${who} commented on ${key} “${issue.title}”${data?.excerpt ? `: ${String(data.excerpt).slice(0, 140)}` : ''}`,
      }[event];
      const url = appUrl ? `${appUrl.replace(/\/$/, '')}/w/${issue.slug}?issue=${encodeURIComponent(key)}` : null;
      for (const c of channels) {
        try {
          await sendChat(fetcher, c, text, url);
          await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = 'ok' WHERE id = ?", c.id);
        } catch (err) {
          await db.run("UPDATE integrations SET last_event_at = datetime('now'), last_status = ? WHERE id = ?", `Failed: ${err.message}`.slice(0, 200), c.id);
          log.warn?.(`Chat message to ${c.kind} failed: ${err.message}`);
        }
      }
    } catch (err) {
      log.warn?.(`Chat relay failed: ${err.message}`);
    }
  };
}
