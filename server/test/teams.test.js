import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

/** Software-house tools: time tracking, GitHub/GitLab, chat channels, import, two-factor sign-in, audit, share links. */
let server;
let base;
let db;
const posted = [];
const fetcher = async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => 'ok' }; };

async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase(':memory:');
  const { openPostgres } = await import('../src/db-postgres.js');
  const pg = await openPostgres(url, { migrate: false });
  await pg.exec(`DROP TABLE IF EXISTS share_links, audit_log, dev_links, integrations, time_entries, project_members, issue_assignees, automation_runs, automations, issue_field_values, custom_fields, attachments, password_resets, push_subscriptions, app_kv,
    measurements, entries, todos, notifications, activity, watchers, issue_links, comments, checklist_items,
    issues, phases, sprints, statuses, projects, invites, memberships, workspaces, users, workmars_meta, flowstate_meta CASCADE`);
  await pg.close();
  return openPostgres(url);
}

before(async () => {
  db = await testDatabase();
  const app = createApp({ db, secret: 'test-secret', fetcher, appUrl: 'https://work.example.com', log: { error() {}, warn() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

export function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const raw = typeof body === 'string';
    const res = await fetch(base + (path.startsWith('/hooks') || path.startsWith('/share') ? '/api' : '/api') + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars', ...(cookie && { Cookie: cookie }), ...headers },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

let seq = 0;
async function org() {
  const tag = ++seq;
  const admin = client();
  await admin('POST', '/auth/signup', { name: 'Ada Admin', email: `ada${tag}@example.com`, password: 'correct-horse' });
  const ws = (await admin('POST', '/workspaces', { name: `Org ${tag}`, project: { name: 'Web', key: `W${tag}`, methodology: 'kanban' } })).data.workspace;
  const web = (await admin('GET', `/workspaces/${ws.slug}`)).data.projects[0];
  const [inv] = (await admin('POST', `/workspaces/${ws.slug}/invites`, { emails: [`dev${tag}@example.com`], role: 'member', projectIds: [web.id] })).data;
  const dev = client();
  const devUser = (await dev('POST', '/auth/signup', { name: 'Dev Dan', email: `dev${tag}@example.com`, password: 'correct-horse' })).data.user;
  await dev('POST', `/invites/${inv.token}/accept`);
  const card = (await admin('POST', `/projects/${web.id}/issues`, { title: 'Build login', assigneeIds: [devUser.id] })).data;
  return { admin, dev, devUser, ws, web, card, tag };
}

test('time: start and stop a timer, log time by hand, and see it on the card and the timesheet', async () => {
  const { admin, dev, ws, card } = await org();
  const started = await dev('POST', `/issues/${card.key}/time/start`, {});
  assert.equal(started.status, 201);
  assert.equal(started.data.running, true);
  assert.equal((await dev('GET', '/time/running')).data.issueKey, card.key);
  // backdate the running timer by 25 minutes, then stop it
  await db.run('UPDATE time_entries SET started_at = ? WHERE id = ?', new Date(Date.now() - 25 * 60000).toISOString(), started.data.id);
  const stopped = (await dev('POST', '/time/stop', {})).data;
  assert.equal(stopped.running, false);
  assert.equal(stopped.minutes, 25);
  assert.equal((await dev('GET', '/time/running')).data, null);
  const manual = await dev('POST', `/issues/${card.key}/time`, { minutes: 90, note: 'Pairing on the form', billable: false });
  assert.equal(manual.status, 201);
  const onCard = (await dev('GET', `/issues/${card.key}/time`)).data;
  assert.equal(onCard.totalMinutes, 115);
  assert.equal((await admin('GET', `/issues/${card.key}`)).data.timeMinutes, 115);
  // edit and delete: own entries yes, others' no (unless manager)
  assert.equal((await dev('PATCH', `/time/${manual.data.id}`, { minutes: 60 })).data.minutes, 60);
  const from = new Date(Date.now() - 864e5).toISOString();
  const to = new Date(Date.now() + 864e5).toISOString();
  const sheet = (await admin('GET', `/workspaces/${ws.slug}/timesheet?from=${from}&to=${to}`)).data;
  assert.equal(sheet.totalMinutes, 85);
  assert.equal(sheet.billableMinutes, 25);
  assert.equal(sheet.canSeeTeam, true);
  const csv = await admin('GET', `/workspaces/${ws.slug}/timesheet?from=${from}&to=${to}&format=csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.data, /Dev Dan/);
  assert.match(csv.data, /Total,.*1\.42/);
  // a team member's timesheet only shows their own time
  await admin('POST', `/issues/${card.key}/time`, { minutes: 30 });
  assert.equal((await dev('GET', `/workspaces/${ws.slug}/timesheet?from=${from}&to=${to}`)).data.totalMinutes, 85);
  assert.equal((await admin('DELETE', `/time/${manual.data.id}`)).status, 200, 'managers can fix anyone’s time');
  // starting a new timer stops the old one
  await dev('POST', `/issues/${card.key}/time/start`, {});
  await dev('POST', `/issues/${card.key}/time/start`, {});
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL')).n >= 1, true);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM time_entries WHERE ended_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ?)', `dev${seq}@example.com`)).n, 1);
});

import { createHmac } from 'node:crypto';
const settle = () => new Promise((r) => setTimeout(r, 60));

test('github: signed deliveries link branches, commits and PRs, and move cards; bad signatures are refused', async () => {
  const { admin, dev, ws, web, card } = await org();
  assert.equal((await dev('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'github' })).status, 403, 'only managers connect tools');
  const gh = (await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'github' })).data;
  assert.match(gh.hookUrl, /\/api\/hooks\/\d+$/);
  assert.equal(gh.secret.length, 48);
  const send = (event, payload, secret = gh.secret) => {
    const raw = JSON.stringify(payload);
    return fetch(`${base}/api/hooks/${gh.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
  };
  assert.equal((await send('ping', { zen: 'hi' })).status, 200);
  assert.equal((await send('push', {}, 'wrong-secret')).status, 401);
  const lower = card.key.toLowerCase();
  const push = await send('push', { ref: `refs/heads/feature/${lower}-login`, repository: { html_url: 'https://github.com/acme/web' }, pusher: { name: 'dan' },
    commits: [{ id: 'abc123', message: `${card.key} add login form\n\nmore`, url: 'https://github.com/acme/web/commit/abc123', author: { name: 'Dan' } }] });
  assert.equal((await push.json()).linked, 2);
  const project = (await admin('GET', `/projects/${web.id}`)).data;
  const open = await send('pull_request', { action: 'opened', pull_request: { number: 7, title: `Login form (${card.key})`, html_url: 'https://github.com/acme/web/pull/7', state: 'open', merged: false, user: { login: 'dan' }, head: { ref: 'feature/x' } } });
  assert.equal(open.status, 200);
  let issue = (await admin('GET', `/issues/${card.key}`)).data;
  assert.equal(project.statuses.find((s) => s.id === issue.statusId).category, 'progress', 'PR opened → in progress');
  await send('pull_request', { action: 'closed', pull_request: { number: 7, title: `Login form (${card.key})`, html_url: 'https://github.com/acme/web/pull/7', state: 'closed', merged: true, user: { login: 'dan' }, head: { ref: 'feature/x' } } });
  issue = (await admin('GET', `/issues/${card.key}`)).data;
  assert.equal(issue.statusCategory, 'done', 'PR merged → done');
  const devLinks = (await dev('GET', `/issues/${card.key}/dev`)).data;
  assert.deepEqual(devLinks.map((l) => l.kind).sort(), ['branch', 'commit', 'pr']);
  assert.equal(devLinks.find((l) => l.kind === 'pr').state, 'merged');
  const list = (await admin('GET', `/workspaces/${ws.slug}/integrations`)).data;
  assert.match(list[0].lastStatus, /^ok/);
});

test('gitlab: token-checked merge requests link and close work', async () => {
  const { admin, ws, card } = await org();
  const gl = (await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'gitlab', settings: { progressOnPr: false } })).data;
  const send = (body, token = gl.secret) => fetch(`${base}/api/hooks/${gl.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gitlab-Event': 'Merge Request Hook', 'X-Gitlab-Token': token }, body: JSON.stringify(body) });
  assert.equal((await send({}, 'nope')).status, 401);
  const res = await send({ object_kind: 'merge_request', user: { username: 'dan' }, object_attributes: { iid: 3, title: `Fix ${card.key}`, url: 'https://gitlab.com/acme/web/-/merge_requests/3', state: 'merged', action: 'merge', source_branch: 'fix' } });
  assert.equal((await res.json()).linked, 1);
  assert.equal((await admin('GET', `/issues/${card.key}`)).data.statusCategory, 'done');
});

test('chat channels: only real webhook hosts, a test message, and messages on new, finished and commented work', async () => {
  const { admin, ws, web } = await org();
  assert.equal((await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'slack', url: 'https://evil.example.com/x' })).status, 400);
  assert.equal((await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'slack', url: 'http://hooks.slack.com/services/A/B/C' })).status, 400);
  const slack = (await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'slack', url: 'https://hooks.slack.com/services/T0/B0/xyz', settings: { events: ['created', 'done', 'comment'] } })).data;
  const teams = (await admin('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'teams', url: 'https://acme.webhook.office.com/webhookb2/abc', settings: { events: ['done'] } })).data;
  assert.ok(!JSON.stringify(slack).includes('xyz'), 'the webhook secret is never shown again');
  posted.length = 0;
  assert.equal((await admin('POST', `/integrations/${slack.id}/test`, {})).status, 200);
  assert.equal(posted.length, 1);
  assert.match(posted[0].body.text, /WorkMars is connected/);
  posted.length = 0;
  const item = (await admin('POST', `/projects/${web.id}/issues`, { title: 'Ship the invoice page' })).data;
  await settle();
  assert.equal(posted.length, 1, 'Slack hears about new work; Teams only wants finished work');
  assert.match(posted[0].body.text, /created .*Ship the invoice page/);
  assert.match(posted[0].body.text, /<https:\/\/work\.example\.com\/w\/.*\|Open>/);
  posted.length = 0;
  const done = (await admin('GET', `/projects/${web.id}`)).data.statuses.find((s) => s.category === 'done');
  await admin('PATCH', `/issues/${item.key}`, { statusId: done.id });
  await settle();
  assert.equal(posted.length, 2);
  assert.ok(posted.every((p) => /finished/.test(p.body.text)));
  posted.length = 0;
  await admin('POST', `/issues/${item.key}/comments`, { body: 'Looks great' });
  await settle();
  assert.equal(posted.length, 1);
  assert.match(posted[0].body.text, /commented .*Looks great/);
  assert.equal((await admin('DELETE', `/integrations/${teams.id}`)).status, 200);
});

test('import: Jira-style rows become work items with matched columns, people, priorities and dates', async () => {
  const { admin, dev, devUser, web } = await org();
  const rows = [
    { key: 'OLD-1', title: 'Checkout fails on Safari', type: 'Bug', status: 'In Progress', priority: 'Highest', assignee: devUser.email, dueDate: '12/Mar/26 10:00 AM', labels: 'payments, safari', storyPoints: '3' },
    { key: 'OLD-2', title: 'Pricing page copy', type: 'Story', status: 'Done', priority: 'Low', assignee: 'Dev Dan', dueDate: '2026-04-01' },
    { title: 'Plan Q3', status: 'Backlog', assignee: 'Nobody Here', dueDate: '03/15/2026' },
    { title: '', status: 'To Do' },
  ];
  assert.equal((await dev('POST', `/projects/${web.id}/import`, { rows })).status, 403, 'only managers import');
  const res = (await admin('POST', `/projects/${web.id}/import`, { rows })).data;
  assert.equal(res.created, 3);
  assert.deepEqual(res.skipped, [{ row: 4, reason: 'No title' }]);
  assert.deepEqual(res.unmatchedPeople, ['Nobody Here']);
  const items = (await admin('GET', `/projects/${web.id}/issues`)).data;
  const bug = items.find((i) => i.title === 'Checkout fails on Safari');
  assert.equal(bug.priority, 'urgent');
  assert.equal(bug.type, 'bug');
  assert.equal(bug.statusCategory, 'progress');
  assert.equal(bug.dueDate, '2026-03-12');
  assert.deepEqual(bug.assigneeIds, [devUser.id]);
  assert.deepEqual(bug.labels, ['payments', 'safari']);
  assert.equal(bug.storyPoints, 3);
  assert.match(bug.description, /Imported from OLD-1/);
  const copy = items.find((i) => i.title === 'Pricing page copy');
  assert.equal(copy.statusCategory, 'done');
  assert.deepEqual(copy.assigneeIds, [devUser.id], 'matched by name');
  assert.equal(items.find((i) => i.title === 'Plan Q3').dueDate, '2026-03-15');
});
