import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createEvents } from '../src/events.js';
import { runReminders } from '../src/services/reminders.js';
import { dayOffset } from '../src/dates.js';

/** Team hierarchy: admin → managers → team members → viewers, project resources, several assignees, reminders. */
let server;
let base;
let db;

async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase(':memory:');
  const { openPostgres } = await import('../src/db-postgres.js');
  const pg = await openPostgres(url, { migrate: false });
  await pg.exec(`DROP TABLE IF EXISTS project_members, issue_assignees, automation_runs, automations, issue_field_values, custom_fields, attachments, password_resets, push_subscriptions, app_kv,
    measurements, entries, todos, notifications, activity, watchers, issue_links, comments, checklist_items,
    issues, phases, sprints, statuses, projects, invites, memberships, workspaces, users, workmars_meta, flowstate_meta CASCADE`);
  await pg.close();
  return openPostgres(url);
}

before(async () => {
  db = await testDatabase();
  const app = createApp({ db, secret: 'test-secret', log: { error() {}, warn() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await db.close(); });

function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), 'X-Requested-With': 'workmars', ...(cookie && { Cookie: cookie }), ...headers },
      body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, data: type.includes('json') ? await res.json() : null };
  };
}

let seq = 0;
/** An admin with two projects, a manager (invited as Project Manager) and a developer on the first project only. */
async function org() {
  const tag = ++seq;
  const admin = client();
  await admin('POST', '/auth/signup', { name: 'Ada Admin', email: `ada${tag}@example.com`, password: 'correct-horse' });
  const ws = (await admin('POST', '/workspaces', { name: `Org ${tag}`, locale: 'en-US', useCase: 'SaaS & product', project: { name: 'Web', key: `W${tag}`, methodology: 'scrum' } })).data.workspace;
  assert.equal(ws.role, 'admin', 'the first account is the admin');
  assert.equal(ws.locale, 'en-US', 'locale comes from the browser, no location question');
  const web = (await admin('GET', `/workspaces/${ws.slug}`)).data.projects[0];
  const ops = (await admin('POST', `/workspaces/${ws.slug}/projects`, { name: 'Ops', key: `O${tag}` })).data;
  const join = async (name, email, body) => {
    const [inv] = (await admin('POST', `/workspaces/${ws.slug}/invites`, { emails: [email], ...body })).data;
    const c = client();
    const user = (await c('POST', '/auth/signup', { name, email, password: 'correct-horse' })).data.user;
    assert.equal((await c('POST', `/invites/${inv.token}/accept`)).status, 200);
    return { c, user };
  };
  const pm = await join('Priya PM', `pm${tag}@example.com`, { role: 'manager', designation: 'Project Manager' });
  const dev = await join('Dev Dan', `dev${tag}@example.com`, { role: 'member', designation: 'React Developer', projectIds: [web.id] });
  const des = await join('Desi Designer', `des${tag}@example.com`, { role: 'member', designation: 'UI/UX Designer', projectIds: [web.id] });
  return { admin, ws, web, ops, pm, dev, des };
}

test('visibility: managers see every project, team members only the ones they are on', async () => {
  const { ws, web, ops, pm, dev } = await org();
  const names = async (c) => (await c('GET', `/workspaces/${ws.slug}`)).data.projects.map((p) => p.id).sort();
  assert.deepEqual(await names(pm.c), [web.id, ops.id].sort());
  assert.deepEqual(await names(dev.c), [web.id]);
  assert.equal((await dev.c('GET', `/projects/${ops.id}`)).status, 404, 'other projects stay hidden');
  const detail = (await pm.c('GET', `/projects/${web.id}`)).data;
  assert.ok(detail.memberIds.includes(dev.user.id));
  assert.equal(detail.myRole, 'manager');
});

test('managers create cards with several assignees; assigning someone adds them to the project', async () => {
  const { ws, web, ops, pm, dev, des } = await org();
  const card = await pm.c('POST', `/projects/${web.id}/issues`, { title: 'Landing page', assigneeIds: [dev.user.id, des.user.id], dueDate: dayOffset(5), description: 'Hero + pricing' });
  assert.equal(card.status, 201);
  assert.deepEqual(card.data.assigneeIds, [dev.user.id, des.user.id]);
  assert.equal(card.data.assigneeId, dev.user.id, 'the first assignee is the primary one');
  for (const who of [dev, des]) {
    const bell = (await who.c('GET', `/notifications/${ws.slug}`)).data;
    assert.ok(bell.items.some((n) => n.kind === 'assigned' && n.text.includes('Landing page')));
    assert.ok((await who.c('GET', `/workspaces/${ws.slug}/my-issues`)).data.some((i) => i.key === card.data.key), 'shows in My tasks');
  }
  // Changing the list: remove one, add another; the newcomer is notified.
  const pmId = pm.user.id;
  const upd = await pm.c('PATCH', `/issues/${card.data.key}`, { assigneeIds: [des.user.id, pmId] });
  assert.deepEqual(upd.data.assigneeIds, [des.user.id, pmId]);
  assert.ok(!(await dev.c('GET', `/workspaces/${ws.slug}/my-issues`)).data.some((i) => i.key === card.data.key));
  // Assigning Dan on Ops puts him on that project too.
  const opsCard = await pm.c('POST', `/projects/${ops.id}/issues`, { title: 'Rotate keys', assigneeIds: [dev.user.id] });
  assert.equal(opsCard.status, 201);
  assert.equal((await dev.c('GET', `/projects/${ops.id}`)).status, 200);
});

test('team members comment, upload, link and move cards, but cannot change dates, assignees or details', async () => {
  const { web, pm, dev, des } = await org();
  const project = (await pm.c('GET', `/projects/${web.id}`)).data;
  const card = (await pm.c('POST', `/projects/${web.id}/issues`, { title: 'API client', assigneeIds: [dev.user.id], dueDate: dayOffset(3) })).data;
  const other = (await pm.c('POST', `/projects/${web.id}/issues`, { title: 'Docs' })).data;
  const doing = project.statuses.find((s) => s.category === 'progress');
  // allowed
  assert.equal((await dev.c('POST', `/issues/${card.key}/comments`, { body: 'Started — PR link: https://github.com/x/y/pull/1' })).status, 201);
  assert.equal((await dev.c('POST', `/issues/${card.key}/links`, { target: other.key, kind: 'relates' })).status, 201);
  assert.equal((await dev.c('POST', `/issues/${card.key}/checklist`, { text: 'Write tests' })).status, 201);
  const upload = await dev.c('POST', `/issues/${card.key}/attachments`, new TextEncoder().encode('spec notes'), { 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt' });
  assert.equal(upload.status, 201, 'team members upload files');
  assert.equal((await dev.c('PATCH', `/issues/${card.key}`, { statusId: doing.id })).status, 200);
  assert.equal((await dev.c('POST', `/issues/${card.key}/move`, { statusId: project.statuses[0].id })).status, 200);
  // blocked
  for (const change of [{ dueDate: dayOffset(30) }, { assigneeIds: [des.user.id] }, { assigneeId: null }, { description: 'rewritten' }, { title: 'Renamed' }, { priority: 'low' }, { startDate: dayOffset(1) }]) {
    const res = await dev.c('PATCH', `/issues/${card.key}`, change);
    assert.equal(res.status, 403, `team member blocked from ${Object.keys(change)[0]}`);
  }
  assert.equal((await dev.c('POST', `/projects/${web.id}/issues`, { title: 'Sneaky' })).status, 403, 'only managers create cards');
  assert.equal((await dev.c('DELETE', `/issues/${other.key}`)).status, 403);
  assert.equal((await dev.c('PATCH', `/projects/${web.id}`, { description: 'Mine now' })).status, 403);
  assert.equal((await dev.c('PUT', `/projects/${web.id}/members`, { userIds: [dev.user.id] })).status, 403);
  assert.equal((await dev.c('POST', `/projects/${web.id}/statuses`, { name: 'QA', category: 'progress' })).status, 403);
  const after = (await pm.c('GET', `/issues/${card.key}`)).data;
  assert.equal(after.dueDate, dayOffset(3));
  assert.deepEqual(after.assigneeIds, [dev.user.id]);
});

test('resources: managers pick the people on a project with checkboxes; only admins change roles', async () => {
  const { admin, ws, web, ops, pm, dev, des } = await org();
  const res = await pm.c('PUT', `/projects/${ops.id}/members`, { userIds: [pm.user.id, dev.user.id, des.user.id] });
  assert.equal(res.status, 200);
  assert.deepEqual([...res.data.memberIds].sort(), [pm.user.id, dev.user.id, des.user.id].sort());
  assert.equal((await des.c('GET', `/projects/${ops.id}`)).status, 200);
  await pm.c('PUT', `/projects/${web.id}/members`, { userIds: [pm.user.id, dev.user.id] });
  assert.equal((await des.c('GET', `/projects/${web.id}`)).status, 404, 'taken off the project');
  assert.equal((await pm.c('PATCH', `/workspaces/${ws.slug}/members/${dev.user.id}`, { role: 'manager' })).status, 403, 'managers do not assign roles');
  assert.equal((await admin('PATCH', `/workspaces/${ws.slug}/members/${dev.user.id}`, { role: 'manager' })).status, 200);
  assert.equal((await dev.c('POST', `/projects/${web.id}/issues`, { title: 'Now allowed' })).status, 201);
  assert.equal((await dev.c('GET', `/projects/${ops.id}`)).status, 200);
});

test('reminders: a personal to-do reminds once at its time and re-arms when moved', async () => {
  const { ws, pm } = await org();
  const past = new Date(Date.now() - 60_000).toISOString();
  const todo = (await pm.c('POST', '/todos', { text: 'Chase the design review', remindAt: past })).data;
  assert.equal(todo.remindAt, past);
  const events = createEvents(db, { publish() {} });
  await runReminders(db, { events });
  await runReminders(db, { events });
  const reminders = (await pm.c('GET', `/notifications/${ws.slug}`)).data.items.filter((n) => n.kind === 'reminder');
  assert.equal(reminders.length, 1, 'sent exactly once');
  assert.match(reminders[0].text, /Chase the design review/);
  const moved = (await pm.c('PATCH', `/todos/${todo.id}`, { remindAt: past })).data;
  assert.equal(moved.reminded, false, 'a new time re-arms it');
  await pm.c('PATCH', `/todos/${todo.id}`, { done: true });
  await runReminders(db, { events });
  assert.equal((await pm.c('GET', `/notifications/${ws.slug}`)).data.items.filter((n) => n.kind === 'reminder').length, 1, 'done to-dos stay quiet');
});
