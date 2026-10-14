import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const db = openDatabase(':memory:');
  const app = createApp({ db, secret: 'test-secret', log: { error() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

/** Tiny cookie-aware client. */
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate', ...(cookie && { Cookie: cookie }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

async function onboard(api, email = `user${Math.random()}@example.com`, name = 'Alex Morgan') {
  await api('POST', '/auth/signup', { name, email, password: 'correct-horse' });
  const { data } = await api('POST', '/workspaces', {
    name: 'Studio North', region: 'uk', teamSize: '11-50', useCase: 'software',
    project: { name: 'Website Redesign', key: 'WEB', template: 'scrum', withSamples: true },
  });
  const ws = await api('GET', `/workspaces/${data.workspace.slug}`);
  return { slug: data.workspace.slug, ws: ws.data, email };
}

test('signup validates input and rejects duplicates', async () => {
  const api = client();
  const bad = await api('POST', '/auth/signup', { name: 'A', email: 'nope', password: 'x' });
  assert.equal(bad.status, 400);
  const ok = await api('POST', '/auth/signup', { name: 'Sam', email: 'sam@example.com', password: 'longenough' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.initials, 'S');
  const dup = await client()('POST', '/auth/signup', { name: 'Sam', email: 'SAM@example.com', password: 'longenough' });
  assert.equal(dup.status, 409);
});

test('mutations without the CSRF header are refused', async () => {
  const res = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('login, session and logout', async () => {
  const api = client();
  await api('POST', '/auth/signup', { name: 'Lee', email: 'lee@example.com', password: 'longenough' });
  await api('POST', '/auth/logout');
  assert.equal((await api('GET', '/auth/me')).data.user, null);
  assert.equal((await api('POST', '/auth/login', { email: 'lee@example.com', password: 'wrong-pass' })).status, 401);
  assert.equal((await api('POST', '/auth/login', { email: 'lee@example.com', password: 'longenough' })).status, 200);
  assert.equal((await api('GET', '/auth/me')).data.user.name, 'Lee');
});

test('onboarding creates workspace, scrum project, statuses, sprint and sample work', async () => {
  const api = client();
  const { ws } = await onboard(api);
  assert.equal(ws.workspace.locale, 'en-GB');
  assert.equal(ws.projects.length, 1);
  const project = (await api('GET', `/projects/${ws.projects[0].id}`)).data;
  assert.deepEqual(project.statuses.map((s) => s.name), ['To do', 'In progress', 'In review', 'Done']);
  assert.equal(project.sprints[0].state, 'active');
  const issues = (await api('GET', `/projects/${project.id}/issues`)).data;
  assert.ok(issues.length >= 10);
  assert.ok(issues.every((i) => i.key.startsWith('WEB-')));
});

test('issue lifecycle: create, update, move, comment, checklist, link, delete', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const project = (await api('GET', `/projects/${ws.projects[0].id}`)).data;
  const [todo, , , done] = project.statuses;

  const created = await api('POST', `/projects/${project.id}/issues`, { title: 'Write release notes', type: 'task', priority: 'high' });
  assert.equal(created.status, 201);
  assert.equal(created.data.statusId, todo.id);
  const key = created.data.key;

  const updated = await api('PATCH', `/issues/${key}`, { dueDate: '2030-01-15', labels: ['Docs', 'Docs', ' '] });
  assert.deepEqual(updated.data.labels, ['Docs']);

  const moved = await api('POST', `/issues/${key}/move`, { statusId: done.id });
  assert.equal(moved.data.statusCategory, 'done');
  assert.ok(moved.data.resolvedAt);

  const commented = await api('POST', `/issues/${key}/comments`, { body: 'Shipped 🎉' });
  assert.equal(commented.data.comments.length, 1);
  const withItem = await api('POST', `/issues/${key}/checklist`, { text: 'Proofread' });
  const item = withItem.data.checklist[0];
  const ticked = await api('PATCH', `/issues/${key}/checklist/${item.id}`, { done: true });
  assert.equal(ticked.data.checklist[0].done, true);

  const other = (await api('POST', `/projects/${project.id}/issues`, { title: 'Publish blog' })).data;
  const linked = await api('POST', `/issues/${key}/links`, { target: other.key, kind: 'blocks' });
  assert.equal(linked.data.links[0].issue.key, other.key);
  assert.ok(linked.data.activity.some((a) => a.verb === 'linked'));

  const badStatus = await api('PATCH', `/issues/${key}`, { statusId: 999999 });
  assert.equal(badStatus.status, 400);

  assert.equal((await api('DELETE', `/issues/${key}`)).status, 200);
  assert.equal((await api('GET', `/issues/${key}`)).status, 404);
});

test('workspace isolation: outsiders cannot read or edit', async () => {
  const owner = client();
  const { ws, slug } = await onboard(owner);
  const stranger = client();
  await stranger('POST', '/auth/signup', { name: 'Eve', email: 'eve@example.com', password: 'longenough' });
  assert.equal((await stranger('GET', `/workspaces/${slug}`)).status, 404);
  assert.equal((await stranger('GET', `/projects/${ws.projects[0].id}/issues`)).status, 404);
  assert.equal((await stranger('GET', '/issues/WEB-101')).status, 404);
});

test('invites: unlimited members join with the right role; viewers are read-only', async () => {
  const admin = client();
  const { slug, ws } = await onboard(admin);
  const [invite] = (await admin('POST', `/workspaces/${slug}/invites`, { emails: ['viewer@example.com'], role: 'viewer' })).data;
  const guest = client();
  await guest('POST', '/auth/signup', { name: 'Vic Viewer', email: 'viewer@example.com', password: 'longenough' });
  const preview = await guest('GET', `/invites/${invite.token}`);
  assert.equal(preview.data.workspaceName, 'Studio North');
  assert.equal((await guest('POST', `/invites/${invite.token}/accept`)).status, 200);
  assert.equal((await guest('GET', `/workspaces/${slug}`)).status, 200);
  const denied = await guest('POST', `/projects/${ws.projects[0].id}/issues`, { title: 'Sneaky' });
  assert.equal(denied.status, 403);
  // Single-use email invite
  assert.equal((await client()('GET', `/invites/${invite.token}`)).status, 404);
});

test('sole admin cannot demote themselves', async () => {
  const api = client();
  const { slug } = await onboard(api);
  const me = (await api('GET', '/auth/me')).data.user;
  assert.equal((await api('PATCH', `/workspaces/${slug}/members/${me.id}`, { role: 'member' })).status, 400);
});

test('sprints: start requires work, complete records velocity and moves leftovers', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const pid = ws.projects[0].id;
  let project = (await api('GET', `/projects/${pid}`)).data;
  const active = project.sprints.find((s) => s.state === 'active');
  const next = (await api('POST', `/projects/${pid}/sprints`, {})).data;
  assert.equal((await api('POST', `/projects/${pid}/sprints/${next.id}/start`, {})).status, 409);
  const result = (await api('POST', `/projects/${pid}/sprints/${active.id}/complete`, { moveTo: next.id })).data;
  assert.ok(result.movedIssues > 0);
  assert.ok(result.completed > 0);
  assert.equal((await api('POST', `/projects/${pid}/sprints/${next.id}/start`, { weeks: 2 })).status, 200);
  const reports = (await api('GET', `/projects/${pid}/reports`)).data;
  assert.equal(reports.velocity.length, 1);
  assert.ok(reports.burndown.points.length >= 14);
});

test('workflow columns: add, reorder, delete moves work', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const pid = ws.projects[0].id;
  const statuses = (await api('POST', `/projects/${pid}/statuses`, { name: 'QA', category: 'progress' })).data;
  assert.deepEqual(statuses.map((s) => s.name), ['To do', 'In progress', 'In review', 'QA', 'Done']);
  const qa = statuses.find((s) => s.name === 'QA');
  const reordered = (await api('PATCH', `/projects/${pid}/statuses/${qa.id}`, { position: 1, wipLimit: 2 })).data;
  assert.equal(reordered[1].name, 'QA');
  assert.equal(reordered[1].wipLimit, 2);
  const inReview = statuses.find((s) => s.name === 'In review');
  const after = (await api('DELETE', `/projects/${pid}/statuses/${inReview.id}`, {})).data;
  assert.equal(after.length, 4);
  const issues = (await api('GET', `/projects/${pid}/issues`)).data;
  assert.ok(issues.every((i) => i.statusId !== inReview.id));
});

test('my day: todos roll over, complete and clear', async () => {
  const api = client();
  await api('POST', '/auth/signup', { name: 'Tia', email: 'tia@example.com', password: 'longenough' });
  await api('POST', '/todos', { text: 'Old task', day: '2020-01-01' });
  const fresh = (await api('POST', '/todos', { text: 'Call supplier', timeBlock: 'morning', important: true })).data;
  const list = (await api('GET', '/todos')).data;
  assert.deepEqual(list.items.map((t) => t.text).sort(), ['Call supplier', 'Old task']);
  const done = (await api('PATCH', `/todos/${fresh.id}`, { done: true })).data;
  assert.equal(done.done, true);
  await api('POST', '/todos/clear-completed', {});
  assert.equal((await api('GET', '/todos')).data.items.length, 1);
});

test('notifications: assignment and @mention notify the right people', async () => {
  const admin = client();
  const { slug, ws } = await onboard(admin);
  const [invite] = (await admin('POST', `/workspaces/${slug}/invites`, { emails: ['sara@example.com'] })).data;
  const sara = client();
  const saraUser = (await sara('POST', '/auth/signup', { name: 'Sara Chen', email: 'sara@example.com', password: 'longenough' })).data.user;
  await sara('POST', `/invites/${invite.token}/accept`);
  const issue = (await admin('POST', `/projects/${ws.projects[0].id}/issues`, { title: 'Review copy', assigneeId: saraUser.id })).data;
  await admin('POST', `/issues/${issue.key}/comments`, { body: 'Thanks @Sara — over to you' });
  const inbox = (await sara('GET', `/notifications/${slug}`)).data;
  assert.equal(inbox.unread, 2);
  assert.deepEqual(inbox.items.map((n) => n.kind).sort(), ['assigned', 'mention']);
  await sara('POST', `/notifications/${slug}/read`, {});
  assert.equal((await sara('GET', `/notifications/${slug}`)).data.unread, 0);
});

test('search finds by key and text', async () => {
  const api = client();
  const { slug } = await onboard(api);
  const byKey = (await api('GET', `/workspaces/${slug}/search?q=WEB-102`)).data;
  assert.equal(byKey.issues[0].key, 'WEB-102');
  const byText = (await api('GET', `/workspaces/${slug}/search?q=landing`)).data;
  assert.ok(byText.issues.some((i) => /landing/i.test(i.title)));
});

test('Flow guide answers from live data and drafts actions', async () => {
  const api = client();
  const { slug, ws } = await onboard(api);
  const projectId = ws.projects[0].id;
  const ask = (question) => api('POST', `/ai/${slug}/ask`, { question, projectId }).then((r) => r.data);

  const focus = await ask('Prioritise my day');
  assert.match(focus.text, /WEB-\d+/);
  assert.ok(focus.actions.some((a) => a.type === 'plan_day'));

  const draft = await ask('create an urgent bug: checkout button broken, assign to me, due tomorrow #payments');
  const action = draft.actions[0];
  assert.equal(action.type, 'create_issue');
  assert.equal(action.payload.type, 'bug');
  assert.equal(action.payload.priority, 'urgent');
  assert.equal(action.payload.title, 'Checkout button broken');
  assert.deepEqual(action.payload.labels, ['payments']);
  assert.ok(action.payload.assigneeId);

  const howTo = await ask('how do WIP limits work?');
  assert.match(howTo.text, /WIP/);
  assert.equal(howTo.source, 'builtin');

  const todo = await ask('remind me to call the supplier');
  assert.equal(todo.actions[0].payload.text, 'Call the supplier');

  assert.match((await ask('what needs attention?')).text, /attention|healthy/);
  assert.match((await ask('write my stand-up')).text, /Yesterday/);
  assert.match((await ask('plan the next sprint')).text, /points/);
});
