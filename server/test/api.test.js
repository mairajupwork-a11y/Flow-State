import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

/**
 * Runs against in-memory SQLite by default. Set TEST_DATABASE_URL to a
 * disposable Postgres database to run the same suite there — every Flowstate
 * table in it is dropped first, so never point it at real data.
 */
async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase(':memory:');
  const { openPostgres } = await import('../src/db-postgres.js');
  const db = await openPostgres(url, { migrate: false });
  await db.exec(`DROP TABLE IF EXISTS measurements, entries, todos, notifications, activity, watchers, issue_links, comments, checklist_items,
    issues, phases, sprints, statuses, projects, invites, memberships, workspaces, users, flowstate_meta CASCADE`);
  await db.close();
  return openPostgres(url);
}

let db;
before(async () => {
  db = await testDatabase();
  const app = createApp({ db, secret: 'test-secret', log: { error() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await db.close(); });

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
    project: { name: 'Website Redesign', key: 'WEB', methodology: 'scrum', withSamples: true },
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

test('move: drag between sprint and backlog with project-wide ranking', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const pid = ws.projects[0].id;
  const issues = (await api('GET', `/projects/${pid}/issues`)).data;
  const inSprint = issues.find((i) => i.sprintId && i.type !== 'epic');
  const backlog = issues.filter((i) => !i.sprintId && i.type !== 'epic');
  const moved = (await api('POST', `/issues/${inSprint.key}/move`, { sprintId: null, beforeId: backlog[0].id, afterId: backlog[1].id })).data;
  assert.equal(moved.sprintId, null);
  assert.ok(moved.rank > Math.min(backlog[0].rank, backlog[1].rank) && moved.rank < Math.max(backlog[0].rank, backlog[1].rank));
  const detail = (await api('GET', `/issues/${inSprint.key}`)).data;
  assert.ok(detail.activity.some((a) => a.data.field === 'sprintId'));
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

test('every methodology creates a project with the right structure and samples', async () => {
  const api = client();
  const { slug } = await onboard(api);
  const keys = { waterfall: 'WF', scrum: 'SC', kanban: 'KB', lean: 'LN', sixsigma: 'SS', prince2: 'PR', scrumban: 'SB', business: 'BZ' };
  for (const [methodology, key] of Object.entries(keys)) {
    const created = await api('POST', `/workspaces/${slug}/projects`, { name: `${methodology} project`, key, methodology, withSamples: true });
    assert.equal(created.status, 201, methodology);
    assert.equal(created.data.methodology, methodology);
    const p = (await api('GET', `/projects/${created.data.id}`)).data;
    const issues = (await api('GET', `/projects/${p.id}/issues`)).data;
    assert.ok(issues.length >= 4, `${methodology} has sample work`);
    const reports = (await api('GET', `/projects/${p.id}/reports`)).data;
    assert.equal(reports.cfd.days.length, 30);
    if (['waterfall', 'sixsigma', 'prince2'].includes(methodology)) {
      assert.ok(p.phases.length >= 5, `${methodology} has phases`);
      assert.equal(p.phases[0].state, 'complete');
      assert.equal(p.phases[1].state, 'active');
      assert.ok(issues.some((i) => i.phaseId), `${methodology} items are placed in phases`);
    } else {
      assert.equal(p.phases.length, 0);
    }
    if (methodology === 'scrum') assert.equal(p.sprints[0].state, 'active');
    if (methodology === 'scrumban') assert.match(p.sprints[0].name, /Iteration/);
    if (methodology === 'kanban') assert.equal(p.sprints.length, 0);
    if (methodology === 'sixsigma') {
      assert.ok(reports.control.points.length > 5);
      assert.ok(reports.control.ucl > reports.control.mean);
      assert.equal(typeof p.settings.charter.ctq, 'string');
    }
    if (methodology === 'prince2') assert.deepEqual(reports.registers.map((r) => r.kind).sort(), ['issue', 'lesson', 'quality', 'risk']);
    if (['kanban', 'lean', 'scrumban'].includes(methodology)) assert.ok(reports.cycle.samples.length > 0, `${methodology} cycle time`);
  }
});

test('phase gates run in order and record decisions', async () => {
  const api = client();
  const { slug } = await onboard(api);
  const p = (await api('POST', `/workspaces/${slug}/projects`, { name: 'Office move', key: 'MOVE', methodology: 'waterfall' })).data;
  const phases = (await api('GET', `/projects/${p.id}`)).data.phases;
  assert.deepEqual(phases.map((ph) => ph.state), ['active', 'pending', 'pending', 'pending', 'pending', 'pending']);
  const t = (ph, action, decision) => api('POST', `/projects/${p.id}/phases/${ph.id}/transition`, { action, decision });

  assert.equal((await t(phases[2], 'start')).status, 409, 'cannot skip ahead');
  const item = await api('POST', `/projects/${p.id}/issues`, { title: 'Sign requirements', phaseId: phases[0].id });
  assert.equal(item.data.phaseId, phases[0].id);
  assert.equal((await api('POST', `/projects/${p.id}/issues`, { title: 'Nope', type: 'story' })).status, 400, 'waterfall has no stories');

  assert.equal((await t(phases[0], 'submit')).data[0].state, 'review');
  assert.equal((await t(phases[0], 'approve')).status, 400, 'open work needs a recorded decision');
  const approved = (await t(phases[0], 'approve', 'Approved with one open action carried into Design')).data;
  assert.equal(approved[0].state, 'complete');
  assert.match(approved[0].decision, /carried/);
  assert.equal(approved[1].state, 'active', 'next phase opens');

  const registers = await api('POST', `/projects/${p.id}/entries`, { kind: 'risk', title: 'Lease delay', data: { probability: 4, impact: 5 } });
  assert.equal(registers.status, 201);
  assert.equal(registers.data.status, 'Open');
  assert.equal((await api('PATCH', `/projects/${p.id}/entries/${registers.data.id}`, { status: 'Bogus' })).status, 400);
  assert.equal((await api('PATCH', `/projects/${p.id}/entries/${registers.data.id}`, { status: 'Mitigating' })).data.status, 'Mitigating');

  const charter = await api('PATCH', `/projects/${p.id}`, { charter: { objective: 'Move 40 staff by March' } });
  assert.equal(charter.data.settings.charter.objective, 'Move 40 staff by March');
});

test('switching methodology keeps work and can adopt new columns', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const p = ws.projects[0];
  const before = (await api('GET', `/projects/${p.id}/issues`)).data;
  const switched = (await api('PATCH', `/projects/${p.id}`, { methodology: 'scrumban', resetColumns: true })).data;
  assert.equal(switched.methodology, 'scrumban');
  assert.deepEqual(switched.statuses.map((s) => s.name), ['Backlog', 'Ready', 'In progress', 'Review', 'Done']);
  const after = (await api('GET', `/projects/${p.id}/issues`)).data;
  assert.equal(after.length, before.length);
  assert.equal(after.filter((i) => i.statusCategory === 'done').length, before.filter((i) => i.statusCategory === 'done').length);
  const prince = (await api('PATCH', `/projects/${p.id}`, { methodology: 'prince2' })).data;
  assert.equal(prince.phases.length, 5, 'stages are added when needed');
});

test('Flow guide recommends a methodology', async () => {
  const api = client();
  const { slug } = await onboard(api);
  const ask = (question) => api('POST', `/ai/${slug}/ask`, { question }).then((r) => r.data);
  assert.match((await ask('Which methodology should I use for a mobile app with changing requirements?')).text, /Scrumban/);
  const compare = (await ask('Scrum vs Kanban')).text;
  assert.match(compare, /\*\*Scrum\*\*/);
  assert.match(compare, /\*\*Kanban\*\*/);
  assert.doesNotMatch(compare, /Scrumban/);
  assert.match((await ask('what is PRINCE2?')).text, /Project Board/);
});

test('QA regressions: numeric names, bad ids, prototype keys and input caps', async () => {
  const api = client();
  await api('POST', '/auth/signup', { name: 'Nia', email: `nia${Math.random()}@example.com`, password: 'correct-horse' });
  const made = await api('POST', '/workspaces', { name: '2025' });
  assert.match(made.data.workspace.slug, /^ws-2025/, 'all-digit names never become id-like slugs');
  assert.equal((await api('GET', `/workspaces/${made.data.workspace.slug}`)).status, 200);

  const { slug, ws } = await onboard(api);
  const pid = ws.projects[0].id;
  // Postgres would 500 on ids that don't fit an integer; both backends answer 404.
  assert.equal((await api('GET', '/issues/WEB-99999999999')).status, 404);
  assert.equal((await api('GET', '/projects/abc')).status, 404);
  assert.equal((await api('POST', `/projects/${pid}/entries`, { kind: 'toString', title: 'x' })).status, 400);
  const ids = Array.from({ length: 501 }, (_, i) => i + 1);
  assert.equal((await api('POST', `/notifications/${slug}/read`, { ids })).status, 400);
});

test('QA regressions: issue rules hold on update', async () => {
  const api = client();
  const { ws } = await onboard(api);
  const pid = ws.projects[0].id;
  const a = (await api('POST', `/projects/${pid}/issues`, { title: 'A', type: 'story' })).data;
  const b = (await api('POST', `/projects/${pid}/issues`, { title: 'B', type: 'story', parentId: a.id })).data;
  assert.equal((await api('PATCH', `/issues/${a.id}`, { parentId: b.id })).status, 400, 'no parent loops');
  assert.equal((await api('PATCH', `/issues/${a.id}`, { type: 'subtask' })).status, 400, 'sub-tasks need a parent');
  const epic = (await api('POST', `/projects/${pid}/issues`, { title: 'E', type: 'epic' })).data;
  await api('PATCH', `/issues/${a.id}`, { epicId: epic.id });
  await api('PATCH', `/issues/${epic.id}`, { type: 'story' });
  assert.equal((await api('GET', `/issues/${a.id}`)).data.epicId, null, 'an ex-epic releases its children');
});

test('QA regressions: removing a member clears their links and cannot orphan the workspace', async () => {
  const admin = client();
  const { slug, ws } = await onboard(admin);
  const [invite] = (await admin('POST', `/workspaces/${slug}/invites`, { emails: ['mo@example.com'], role: 'admin' })).data;
  const mo = client();
  await mo('POST', '/auth/signup', { name: 'Mo', email: 'mo@example.com', password: 'longenough' });
  await mo('POST', `/invites/${invite.token}/accept`);
  const moId = (await mo('GET', '/auth/me')).data.user.id;
  const issue = (await admin('POST', `/projects/${ws.projects[0].id}/issues`, { title: 'Watched', assigneeId: moId })).data;
  await mo('POST', `/issues/${issue.id}/watch`, { watching: true });
  assert.equal((await admin('DELETE', `/workspaces/${slug}/members/${moId}`)).status, 200);
  const after = (await admin('GET', `/issues/${issue.id}`)).data;
  assert.equal(after.assigneeId, null);
  assert.ok(!after.watchers.includes(moId), 'ex-members stop watching');
  const me = (await admin('GET', '/auth/me')).data.user;
  assert.equal((await admin('DELETE', `/workspaces/${slug}/members/${me.id}`)).status, 400, 'the last admin cannot leave');
});
