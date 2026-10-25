import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { runScheduledAutomations } from '../src/services/automations.js';
import { dayOffset } from '../src/dates.js';

/** Password reset, attachments, custom fields, automations, email + push delivery and the calendar feed. */
let server;
let base;
let db;
const mail = [];
const pushes = [];
const mailer = { host: 'test', from: 'WorkMars <hi@example.com>', send: async (m) => { mail.push(m); } };
const push = { publicKey: 'BTestKey', sendToUser: async (userId, payload) => {
  const n = (await db.get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', userId)).n;
  if (n) pushes.push({ userId, ...payload });
  return { devices: n, sent: n };
} };

async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase(':memory:');
  const { openPostgres } = await import('../src/db-postgres.js');
  const pg = await openPostgres(url, { migrate: false });
  await pg.exec(`DROP TABLE IF EXISTS automation_runs, automations, issue_field_values, custom_fields, attachments, password_resets, push_subscriptions, app_kv,
    measurements, entries, todos, notifications, activity, watchers, issue_links, comments, checklist_items,
    issues, phases, sprints, statuses, projects, invites, memberships, workspaces, users, workmars_meta, flowstate_meta CASCADE`);
  await pg.close();
  return openPostgres(url);
}

before(async () => {
  db = await testDatabase();
  const app = createApp({ db, secret: 'test-secret', mailer, push, appUrl: 'https://work.example.com', log: { error() {}, warn() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await db.close(); });

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const raw = body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), 'X-Requested-With': 'workmars', ...(cookie && { Cookie: cookie }), ...headers },
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return call;
}

const settle = () => new Promise((r) => setTimeout(r, 30));
let seq = 0;
async function team() {
  const a = client();
  const b = client();
  const tag = ++seq;
  await a('POST', '/auth/signup', { name: 'Alex Morgan', email: `alex${tag}@example.com`, password: 'correct-horse' });
  const ws = (await a('POST', '/workspaces', { name: `Studio ${tag}`, project: { name: 'Web', key: `W${tag}`, methodology: 'scrum' } })).data.workspace;
  const inv = (await a('POST', `/workspaces/${ws.slug}/invites`, { emails: [`sam${tag}@example.com`], role: 'member' })).data;
  await b('POST', '/auth/signup', { name: 'Sam Lee', email: `sam${tag}@example.com`, password: 'correct-horse' });
  await b('POST', `/invites/${inv[0].token}/accept`);
  const detail = (await a('GET', `/workspaces/${ws.slug}`)).data;
  const project = (await a('GET', `/projects/${detail.projects[0].id}`)).data;
  const alex = detail.members.find((m) => m.name === 'Alex Morgan');
  const sam = detail.members.find((m) => m.name === 'Sam Lee');
  return { a, b, ws, project, alex, sam, tag };
}

test('password reset: email link sets a new password once and signs out other devices', async () => {
  const { a, tag } = await team();
  const email = `alex${tag}@example.com`;
  assert.equal((await client()('GET', '/auth/recovery')).data.email, true);
  mail.length = 0;
  assert.equal((await client()('POST', '/auth/forgot', { email: 'nobody@example.com' })).status, 200);
  assert.equal(mail.length, 0, 'no email for unknown accounts, same answer');
  assert.equal((await client()('POST', '/auth/forgot', { email })).status, 200);
  assert.equal(mail.length, 1);
  const link = mail[0].text.match(/https:\/\/work\.example\.com\/reset-password\?token=([\w-]+)/);
  assert.ok(link, 'link uses APP_URL');
  const token = link[1];
  const anon = client();
  assert.equal((await anon('GET', `/auth/reset/${token}`)).data.email, email);
  assert.equal((await anon('POST', '/auth/reset', { token, password: 'short' })).status, 400);
  const done = await anon('POST', '/auth/reset', { token, password: 'brand-new-pass' });
  assert.equal(done.status, 200);
  assert.equal(done.data.user.email, email);
  assert.equal((await anon('POST', '/auth/reset', { token, password: 'another-pass-1' })).status, 400, 'single use');
  assert.equal((await a('GET', '/auth/me')).data.user, null, 'old session signed out');
  assert.equal((await client()('POST', '/auth/login', { email, password: 'correct-horse' })).status, 401);
  assert.equal((await client()('POST', '/auth/login', { email, password: 'brand-new-pass' })).status, 200);
  // an older link stops working once a newer one is issued
  mail.length = 0;
  await client()('POST', '/auth/forgot', { email });
  await client()('POST', '/auth/forgot', { email });
  const [first, second] = mail.map((m) => m.text.match(/token=([\w-]+)/)[1]);
  assert.equal((await client()('GET', `/auth/reset/${first}`)).status, 400);
  assert.equal((await client()('GET', `/auth/reset/${second}`)).status, 200);
});

test('attachments: upload, list, download safely, permissions and delete', async () => {
  const { a, b, project, ws } = await team();
  const item = (await a('POST', `/projects/${project.id}/issues`, { title: 'Spec' })).data;
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const up = await a('POST', `/issues/${item.key}/attachments`, png, { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('screen shot ✓.png') });
  assert.equal(up.status, 201);
  assert.equal(up.data.name, 'screen shot ✓.png');
  assert.equal(up.data.size, png.length);
  const html = await b('POST', `/issues/${item.key}/attachments`, new TextEncoder().encode('<script>alert(1)</script>'), { 'Content-Type': 'text/html', 'X-File-Name': 'x.html' });
  assert.equal(html.status, 201);
  const detail = (await a('GET', `/issues/${item.key}`)).data;
  assert.equal(detail.attachments.length, 2);
  assert.equal(detail.attachmentCount, 2);
  const dl = await a('GET', `/attachments/${up.data.id}`);
  assert.equal(dl.status, 200);
  assert.deepEqual([...dl.data], [...png]);
  assert.equal(dl.headers.get('content-type'), 'image/png');
  const risky = await a('GET', `/attachments/${html.data.id}`);
  assert.equal(risky.headers.get('content-type'), 'application/octet-stream', 'html never renders inline');
  assert.match(risky.headers.get('content-disposition'), /^attachment/);
  assert.match(risky.headers.get('content-security-policy'), /sandbox/);
  // outsiders can't read; empty files are refused; only uploader/admin may delete
  const stranger = client();
  await stranger('POST', '/auth/signup', { name: 'Eve', email: `eve${Date.now()}@example.com`, password: 'correct-horse' });
  assert.equal((await stranger('GET', `/attachments/${up.data.id}`)).status, 404);
  assert.equal((await a('POST', `/issues/${item.key}/attachments`, new Uint8Array(0), { 'X-File-Name': 'e.txt' })).status, 400);
  const jsonFile = new TextEncoder().encode(JSON.stringify({ big: 'x'.repeat(300_000) }));
  const js = await a('POST', `/issues/${item.key}/attachments`, jsonFile, { 'Content-Type': 'application/json', 'X-File-Name': 'data.json' });
  assert.equal(js.status, 201, 'a JSON file uploads as a file, even above the JSON body limit');
  assert.equal(js.data.size, jsonFile.length);
  const tooBig = await a('POST', `/issues/${item.key}/attachments`, new Uint8Array(10 * 1024 * 1024 + 1), { 'X-File-Name': 'huge.bin' });
  assert.equal(tooBig.status, 413);
  await a('DELETE', `/attachments/${js.data.id}`);
  assert.equal((await b('DELETE', `/attachments/${up.data.id}`)).status, 403);
  assert.equal((await a('DELETE', `/attachments/${html.data.id}`)).status, 200, 'admin can remove anyone’s file');
  assert.equal((await a('DELETE', `/attachments/${up.data.id}`)).status, 200);
  assert.equal((await a('GET', `/issues/${item.key}`)).data.attachments.length, 0);
  void ws;
});

test('custom fields: define, validate values, show in detail and log changes', async () => {
  const { a, project, sam } = await team();
  const add = (body) => a('POST', `/projects/${project.id}/fields`, body);
  const env = (await add({ name: 'Environment', type: 'select', options: ['Staging', 'Production'] })).data;
  const cost = (await add({ name: 'Cost', type: 'number' })).data;
  const reviewer = (await add({ name: 'Reviewer', type: 'person' })).data;
  const signed = (await add({ name: 'Signed off', type: 'checkbox' })).data;
  const link = (await add({ name: 'Design', type: 'url' })).data;
  assert.equal((await add({ name: 'environment', type: 'text' })).status, 409);
  assert.equal((await add({ name: 'Empty', type: 'select', options: [] })).status, 400);
  assert.equal((await a('GET', `/projects/${project.id}`)).data.fields.length, 5);
  const item = (await a('POST', `/projects/${project.id}/issues`, { title: 'Release' })).data;
  const put = (f, value) => a('PUT', `/issues/${item.key}/fields/${f.id}`, { value });
  assert.equal((await put(env, 'Dev')).status, 400);
  assert.equal((await put(cost, 'abc')).status, 400);
  assert.equal((await put(link, 'javascript:alert(1)')).status, 400);
  assert.equal((await put(reviewer, 999999)).status, 400);
  assert.equal((await put(env, 'Production')).data.value, 'Production');
  assert.equal((await put(cost, '1,250.5')).data.value, 1250.5);
  assert.equal((await put(reviewer, sam.id)).data.value, sam.id);
  assert.equal((await put(signed, true)).data.value, true);
  assert.equal((await put(link, 'https://figma.com/file/x')).status, 200);
  let detail = (await a('GET', `/issues/${item.key}`)).data;
  assert.deepEqual(detail.fields, { [env.id]: 'Production', [cost.id]: 1250.5, [reviewer.id]: sam.id, [signed.id]: true, [link.id]: 'https://figma.com/file/x' });
  assert.ok(detail.activity.some((x) => x.data.field === 'custom' && x.data.name === 'Reviewer' && x.data.to === 'Sam Lee'));
  await put(cost, null);
  await a('DELETE', `/projects/${project.id}/fields/${env.id}`);
  detail = (await a('GET', `/issues/${item.key}`)).data;
  assert.equal(detail.fields[cost.id], undefined);
  assert.equal(detail.fields[env.id], undefined);
});

test('automations: event rules act and notify, never loop, and timed rules fire once', async () => {
  const { a, b, ws, project, alex, sam } = await team();
  const done = project.statuses.find((s) => s.category === 'done');
  const review = project.statuses.find((s) => s.name === 'In review');
  const rule = (body) => a('POST', `/projects/${project.id}/automations`, body);
  assert.equal((await rule({ name: 'bad', when: { event: 'status' }, then: [{ action: 'move' }] })).status, 400);
  const r1 = await rule({ name: 'Done → tell the reporter', when: { event: 'status', statusId: done.id }, then: [{ action: 'notify', to: ['reporter'], message: 'Shipped' }, { action: 'label', label: 'shipped' }] });
  assert.equal(r1.status, 201);
  await rule({ name: 'Bugs are urgent and go to Sam', when: { event: 'created', filter: { type: 'bug' } }, then: [{ action: 'priority', priority: 'urgent' }, { action: 'assign', userId: sam.id }] });
  // a rule that would bounce items between columns forever if automations chained
  await rule({ name: 'Review → Done', when: { event: 'status', statusId: review.id }, then: [{ action: 'move', statusId: done.id }] });
  await rule({ name: 'Done → Review', when: { event: 'status', statusId: done.id }, then: [{ action: 'move', statusId: review.id }] });
  await rule({ name: 'Comment echo', when: { event: 'comment' }, then: [{ action: 'comment', text: 'Thanks — we will look at this.' }] });

  const bug = (await a('POST', `/projects/${project.id}/issues`, { title: 'Crash', type: 'bug' })).data;
  let d = (await a('GET', `/issues/${bug.key}`)).data;
  assert.equal(d.priority, 'urgent');
  assert.equal(d.assigneeId, sam.id);

  const task = (await b('POST', `/projects/${project.id}/issues`, { title: 'Write docs' })).data;
  const moved = await a('PATCH', `/issues/${task.key}`, { statusId: review.id });
  assert.equal(moved.status, 200);
  d = (await a('GET', `/issues/${task.key}`)).data;
  assert.equal(d.statusId, done.id, 'review rule moved it to done, and the done rules did not bounce it back');
  await a('PATCH', `/issues/${task.key}`, { statusId: project.statuses[0].id });
  await a('PATCH', `/issues/${task.key}`, { statusId: done.id });
  d = (await a('GET', `/issues/${task.key}`)).data;
  assert.ok(d.labels.includes('shipped'));
  const samBell = (await b('GET', `/notifications/${ws.slug}`)).data;
  assert.ok(samBell.items.some((n) => n.kind === 'automation' && /Shipped — W\d+-\d+ “Write docs” moved to Done/.test(n.text)));
  await b('POST', `/issues/${task.key}/comments`, { body: 'Is this live?' });
  d = (await a('GET', `/issues/${task.key}`)).data;
  assert.ok(d.comments.some((c) => c.body === '🤖 Thanks — we will look at this.'));
  assert.equal(d.comments.length, 2, 'the automation’s own comment did not trigger it again');

  // timed: overdue fires once per item; moving the due date re-arms it
  await a('POST', `/projects/${project.id}/automations`, { name: 'Overdue → assignee', when: { event: 'overdue' }, then: [{ action: 'notify', to: ['assignee'] }] });
  const late = (await a('POST', `/projects/${project.id}/issues`, { title: 'Late thing', assigneeId: alex.id, dueDate: dayOffset(-2) })).data;
  const count = async () => (await db.get("SELECT COUNT(*) AS n FROM notifications WHERE issue_id = ? AND kind = 'automation'", late.id)).n;
  await runScheduledAutomations(db, { events: null });
  const first = await count();
  assert.equal(first, 0, 'no events object, no notification — but marked as run');
  await db.run('DELETE FROM automation_runs WHERE issue_id = ?', late.id);
  const { createEvents } = await import('../src/events.js');
  const events = createEvents(db, { publish() {} });
  await runScheduledAutomations(db, { events });
  await runScheduledAutomations(db, { events });
  assert.equal(await count(), 1, 'fires once');
  await a('PATCH', `/issues/${late.key}`, { dueDate: dayOffset(-1) });
  await runScheduledAutomations(db, { events });
  assert.equal(await count(), 2, 'a new due date re-arms it');
  const list = (await a('GET', `/projects/${project.id}/automations`)).data;
  assert.ok(list.find((x) => x.name === 'Done → tell the reporter').runCount >= 1);
  assert.equal((await a('PATCH', `/projects/${project.id}/automations/${r1.data.id}`, { enabled: false })).data.enabled, false);
});

test('email + push: assignments and mentions are delivered by preference', async () => {
  const { a, b, project, sam } = await team();
  await settle();
  mail.length = 0;
  pushes.length = 0;
  assert.equal((await b('POST', '/push/subscribe', { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } })).status, 201);
  const s = (await b('GET', '/settings/notifications')).data;
  assert.equal(s.devices, 1);
  assert.equal(s.emailAvailable, true);
  assert.equal(s.email, 'important');
  const item = (await a('POST', `/projects/${project.id}/issues`, { title: 'Pricing page', assigneeId: sam.id })).data;
  await settle();
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /assigned/);
  assert.match(mail[0].text, /https:\/\/work\.example\.com\/w\/[\w-]+\?issue=W\d+-\d+/);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].userId, sam.id);
  // comments aren't "important"; mentions are
  await a('POST', `/issues/${item.key}/comments`, { body: 'Looks good' });
  await settle();
  assert.equal(mail.length, 1);
  await a('POST', `/issues/${item.key}/comments`, { body: '@Sam can you check the copy?' });
  await settle();
  assert.equal(mail.length, 2);
  assert.match(mail[1].text, /mentioned you/);
  // turning email off stops email, push keeps going
  await b('PATCH', '/settings/notifications', { email: 'off', push: 'all' });
  await a('POST', `/issues/${item.key}/comments`, { body: 'Another note' });
  await settle();
  assert.equal(mail.length, 2);
  assert.equal(pushes.length, 3);
  assert.equal((await b('POST', '/push/test')).data.sent, 1);
  await b('POST', '/push/unsubscribe', { endpoint: 'https://push.example.com/abc' });
  assert.equal((await b('POST', '/push/test')).status, 400);
});

test('calendar feed: private link lists my due work as all-day events', async () => {
  const { a, b, project, alex } = await team();
  await a('POST', `/projects/${project.id}/issues`, { title: 'Launch, phase; one', assigneeId: alex.id, dueDate: '2026-12-03' });
  await a('POST', `/projects/${project.id}/issues`, { title: 'Not mine', dueDate: '2026-12-04' });
  const { calendarUrl, calendarReachable } = (await a('POST', '/calendar/token')).data;
  assert.equal(calendarReachable, true);
  const token = calendarUrl.split('/').pop();
  const anon = client();
  const feed = await anon('GET', `/calendar/${token}`);
  assert.equal(feed.status, 200);
  const text = feed.data.toString();
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /DTSTART;VALUE=DATE:20261203\r\nDTEND;VALUE=DATE:20261204/);
  assert.match(text, /Launch\\, phase\; one/);
  assert.doesNotMatch(text, /Not mine/);
  assert.ok(text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded');
  await a('POST', '/calendar/token');
  assert.equal((await anon('GET', `/calendar/${token}`)).status, 404, 'rotating the link revokes the old one');
  assert.equal((await b('GET', `/calendar/short`)).status, 404);
});
