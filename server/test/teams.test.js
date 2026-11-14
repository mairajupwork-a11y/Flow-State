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
