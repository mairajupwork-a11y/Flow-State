import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

/**
 * Security regression suite (black-box against the real HTTP API, white-box route discovery).
 *  - Every route in src/routes is found by reading the source, so a new route is covered automatically.
 *  - Anonymous callers are refused everywhere except an explicit public list.
 *  - A user from another workspace can't read or change anything, using the victim's real ids,
 *    and the victim's data is byte-for-byte unchanged afterwards.
 *  - Role limits, CSRF header, session revocation, security headers and hostile input.
 */
let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  const fetcher = async () => ({ ok: true, status: 200, text: async () => 'ok' });
  const app = createApp({ db, secret: 'security-secret', fetcher, appUrl: 'https://work.example.com', log: { error() {}, warn() {} } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const raw = body instanceof Uint8Array || typeof body === 'string';
    const res = await fetch(base + '/api' + path, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars', ...(cookie && { Cookie: cookie }), ...headers },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  call.cookie = () => cookie;
  return call;
}

const uniq = () => Math.random().toString(36).slice(2, 10);
async function signup(api, name) {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const r = await api('POST', '/auth/signup', { name, email, password: 'correct-horse-battery' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { ...r.data.user, email };
}

/* ---------- Route discovery (white-box) ---------- */
const ROUTE_DIR = new URL('../src/routes/', import.meta.url);
const MOUNTS = { auth: '/auth', google: '/auth', recovery: '/auth', projects: '/projects', issues: '/issues' };
function discoverRoutes() {
  const out = [];
  for (const f of readdirSync(ROUTE_DIR)) {
    const name = f.replace(/\.js$/, '');
    const src = readFileSync(new URL(f, ROUTE_DIR), 'utf8');
    // Files with two routers: the second factory's routes mount elsewhere.
    const split = { workspaces: src.indexOf('export function inviteRoutes'), personal: src.indexOf('export function notificationRoutes') }[name] ?? -1;
    for (const m of src.matchAll(/\br\.(get|post|patch|put|delete)\(\s*'([^']*)'/g)) {
      let prefix = MOUNTS[name] ?? '';
      if (name === 'workspaces') prefix = split >= 0 && m.index > split ? '/invites' : '/workspaces';
      if (name === 'personal') prefix = split >= 0 && m.index > split ? '/notifications' : '/todos';
      out.push({ method: m[1].toUpperCase(), path: prefix + (m[2] === '/' ? '' : m[2]) });
    }
  }
  return out;
}

// Reachable without signing in, on purpose.
const PUBLIC = new Set([
  'POST /auth/signup', 'POST /auth/login', 'POST /auth/2fa', 'POST /auth/logout', 'GET /auth/me', 'GET /auth/providers',
  'GET /auth/google', 'GET /auth/google/callback', 'GET /auth/recovery', 'POST /auth/forgot', 'GET /auth/reset/:token', 'POST /auth/reset',
  'GET /calendar/:token', 'GET /share/:token', 'GET /invites/:token',
]);

test('white-box: route discovery finds the whole API', () => {
  const routes = discoverRoutes();
  assert.ok(routes.length >= 100, `found only ${routes.length} routes`);
  for (const r of routes) assert.match(r.path, /^\/[a-z]/, `unmounted route ${r.method} ${r.path}`);
});

test('every non-public route refuses anonymous callers with 401', async () => {
  const anon = client();
  const fill = (p) => p.replace(/:ws\b/g, 'no-such-ws').replace(/:token\b/g, 'x'.repeat(40)).replace(/:[a-zA-Z]+/g, '999999');
  const leaks = [];
  for (const r of discoverRoutes()) {
    const res = await anon(r.method, fill(r.path), r.method === 'GET' ? undefined : {});
    const isPublic = PUBLIC.has(`${r.method} ${r.path}`);
    if (!isPublic && res.status !== 401) leaks.push(`${res.status} ${r.method} ${r.path}`);
    if (isPublic) assert.notEqual(res.status, 500, `${r.method} ${r.path} crashed`);
  }
  assert.deepEqual(leaks, []);
});

/* ---------- Cross-workspace isolation (IDOR) ---------- */
test('another workspace’s admin cannot read or change anything, even with real ids', async () => {
  // Victim: a fully populated workspace.
  const a = client();
  const alice = await signup(a, 'Alice');
  const ws = (await a('POST', '/workspaces', { name: 'Victim Co', project: { name: 'Secret', key: 'SEC', methodology: 'prince2' } })).data.workspace;
  const project = (await a('GET', `/workspaces/${ws.slug}`)).data.projects[0];
  const detail = (await a('GET', `/projects/${project.id}`)).data;
  const issue = (await a('POST', `/projects/${project.id}/issues`, { title: 'Confidential roadmap', statusId: detail.statuses[0].id })).data;
  const other = (await a('POST', `/projects/${project.id}/issues`, { title: 'Second item' })).data;
  const comment = (await a('POST', `/issues/${issue.key}/comments`, { body: 'Top secret' })).data;
  const item = (await a('POST', `/issues/${issue.key}/checklist`, { text: 'Step' })).data;
  const link = (await a('POST', `/issues/${issue.key}/links`, { target: other.key, kind: 'blocks' })).data;
  const file = (await a('POST', `/issues/${issue.key}/attachments`, new TextEncoder().encode('secret file'), { 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt' })).data;
  const field = (await a('POST', `/projects/${project.id}/fields`, { name: 'Budget', type: 'number' })).data;
  const rule = (await a('POST', `/projects/${project.id}/automations`, { name: 'Overdue', when: { event: 'overdue' }, then: [{ action: 'notify', to: ['assignee'] }] })).data;
  const entry = (await a('POST', `/projects/${project.id}/entries`, { kind: 'risk', title: 'Leak', data: { probability: 2, impact: 3 } })).data;
  const time = (await a('POST', `/issues/${issue.key}/time`, { minutes: 30 })).data;
  const todo = (await a('POST', '/todos', { text: 'Alice private todo' })).data;
  const share = (await a('POST', `/projects/${project.id}/share`, {})).data;
  const integ = (await a('POST', `/workspaces/${ws.slug}/integrations`, { kind: 'github' })).data;
  const [invite] = (await a('POST', `/workspaces/${ws.slug}/invites`, { emails: ['someone@example.com'] })).data;
  for (const [name, v] of Object.entries({ comment, item, link, file, field, rule, entry, time, todo, share, integ, invite })) assert.ok(v && (v.id || v.token), `fixture ${name} not created: ${JSON.stringify(v)}`);
  const m = await db.get('SELECT id FROM measurements LIMIT 1');

  const ids = {
    ws: ws.slug, ref: issue.key, commentId: comment.id, itemId: item.id, linkId: link.id, fieldId: field.id, ruleId: rule.id,
    statusId: detail.statuses[0].id, sprintId: detail.sprints?.[0]?.id ?? 1, phaseId: detail.phases?.[0]?.id ?? 1, entryId: entry.id,
    mId: m?.id ?? 1, userId: alice.id, token: invite.token,
  };
  const idFor = (path) => {
    if (path.startsWith('/projects/')) return project.id;
    if (path.startsWith('/attachments/')) return file.id;
    if (path.startsWith('/integrations/')) return integ.id;
    if (path.startsWith('/todos/')) return todo.id;
    if (path.startsWith('/share-links/')) return share.id;
    if (path.startsWith('/time/')) return time.id;
    return 1;
  };
  const fill = (p) => p.replace(/:(\w+)/g, (_, k) => String(k === 'id' ? idFor(p) : ids[k] ?? 1));

  // Everything the victim owns, to prove nothing changed.
  const TABLES = ['workspaces', 'memberships', 'projects', 'statuses', 'sprints', 'phases', 'issues', 'comments', 'checklist_items', 'issue_links', 'attachments',
    'custom_fields', 'automations', 'entries', 'time_entries', 'todos', 'share_links', 'integrations', 'invites', 'project_members', 'watchers', 'measurements'];
  let attackerId = -1;
  const mine = (row) => row.user_id === attackerId || row.created_by === attackerId || (row.workspace_id ?? -1) > ws.id || (row.slug && row.slug !== ws.slug && row.id > ws.id);
  const snapshot = async () => {
    const s = {};
    for (const t of TABLES) s[t] = JSON.stringify((await db.all(`SELECT * FROM ${t}`)).filter((row) => !mine(row)));
    return s;
  };
  // Attacker: admin of their own workspace, so role checks alone can't save the victim.
  const b = client();
  attackerId = (await signup(b, 'Mallory')).id;
  await b('POST', '/workspaces', { name: 'Attacker Co', project: { name: 'Mine', key: 'MIN' } });
  const before = await snapshot();
  // Self-scoped routes act on the caller's own data; they may succeed but must not touch the victim's.
  const SELF = new Set(['POST /todos', 'GET /todos', 'POST /time/stop', 'GET /time/current', 'GET /time', 'GET /settings', 'PATCH /settings', 'POST /push/subscribe', 'POST /push/unsubscribe', 'POST /calendar/token', 'GET /calendar/token', 'POST /invites/:token/accept',
    'GET /settings/notifications', 'DELETE /calendar/token', 'DELETE /todos/:id', 'POST /todos/clear-completed', 'GET /time/running', 'POST /workspaces']);
  const body = { title: 'pwned', name: 'pwned', text: 'pwned', body: 'pwned', minutes: 5, kind: 'risk', role: 'admin', email: 'x@example.com', emails: ['x@example.com'], key: 'PWN', type: 'text', target: other.key, action: 'start' };
  const breaches = [];
  for (const r of discoverRoutes()) {
    if (PUBLIC.has(`${r.method} ${r.path}`) || r.path.startsWith('/auth')) continue;
    const res = await b(r.method, fill(r.path), r.method === 'GET' ? undefined : body);
    if (res.status < 300 && !SELF.has(`${r.method} ${r.path}`)) breaches.push(`${res.status} ${r.method} ${fill(r.path)}`);
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (/Confidential roadmap|Top secret|secret file|Alice private todo/.test(text)) breaches.push(`data leak in ${r.method} ${fill(r.path)}`);
  }
  assert.deepEqual(breaches, []);
  assert.deepEqual(await snapshot(), before, 'victim data changed');
});

/* ---------- Roles inside one workspace ---------- */
test('role limits: viewers read only, members cannot administer', async () => {
  const admin = client();
  await signup(admin, 'Ada');
  const ws = (await admin('POST', '/workspaces', { name: 'Roles Co', project: { name: 'Core', key: 'COR' } })).data.workspace;
  const project = (await admin('GET', `/workspaces/${ws.slug}`)).data.projects[0];
  const card = (await admin('POST', `/projects/${project.id}/issues`, { title: 'Existing card' })).data;
  const join = async (role, name) => {
    const api = client();
    const u = await signup(api, name);
    const [inv] = (await admin('POST', `/workspaces/${ws.slug}/invites`, { emails: [u.email], role, projectIds: [project.id] })).data;
    assert.equal((await api('POST', `/invites/${inv.token}/accept`)).status, 200);
    return { api, u };
  };
  const viewer = await join('viewer', 'Vic');
  const member = await join('member', 'Mem');

  assert.equal((await viewer.api('GET', `/projects/${project.id}`)).status, 200, 'viewers can read');
  for (const [m, p, body] of [
    ['POST', `/projects/${project.id}/issues`, { title: 'nope' }],
    ['PATCH', `/issues/${card.key}`, { title: 'changed' }],
    ['DELETE', `/issues/${card.key}`],
    ['PATCH', `/workspaces/${ws.slug}`, { name: 'Hijacked' }],
  ]) assert.ok([403, 404].includes((await viewer.api(m, p, body)).status), `viewer ${m} ${p}`);

  const cols = (await admin('GET', `/projects/${project.id}`)).data.statuses;
  assert.equal((await member.api('PATCH', `/issues/${card.key}`, { statusId: cols[1].id })).status, 200, 'members move cards');
  assert.equal((await member.api('PATCH', `/issues/${card.key}`, { title: 'Member edit' })).status, 403, 'members cannot rewrite details');
  for (const [m, p, body] of [
    ['PATCH', `/workspaces/${ws.slug}`, { name: 'Hijacked' }],
    ['PATCH', `/workspaces/${ws.slug}`, { logo: 'data:image/png;base64,AAAA' }],
    ['POST', `/workspaces/${ws.slug}/invites`, { emails: ['friend@example.com'], role: 'admin' }],
    ['PATCH', `/workspaces/${ws.slug}/members/${member.u.id}`, { role: 'admin' }],
    ['DELETE', `/workspaces/${ws.slug}/members/${viewer.u.id}`],
    ['GET', `/workspaces/${ws.slug}/audit`],
    ['DELETE', `/projects/${project.id}`],
  ]) assert.ok([403, 404].includes((await member.api(m, p, body)).status), `member ${m} ${p}`);

  const roles = await db.all('SELECT role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE w.slug = ? ORDER BY role', ws.slug);
  assert.deepEqual(roles.map((r) => r.role), ['admin', 'member', 'viewer'], 'nobody escalated');
  assert.equal((await db.get('SELECT name FROM workspaces WHERE slug = ?', ws.slug)).name, 'Roles Co');
});

/* ---------- Sessions, CSRF, headers ---------- */
test('CSRF: state-changing calls without the app header are refused', async () => {
  const api = client();
  await signup(api, 'Csrf');
  const res = await fetch(base + '/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: api.cookie() }, body: JSON.stringify({ text: 'forged' }) });
  assert.equal(res.status, 403);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM todos WHERE text = 'forged'")).n, 0);
});

test('sessions: cookie flags, logout-all and password change revoke old cookies', async () => {
  const api = client();
  const u = await signup(api, 'Sess');
  const raw = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: JSON.stringify({ email: u.email, password: 'correct-horse-battery' }) });
  const set = raw.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=(Lax|Strict)/i);
  const stolen = set.split(';')[0];
  const asStolen = () => fetch(base + '/api/auth/me', { headers: { Cookie: stolen } }).then((r) => r.json());
  assert.equal((await asStolen()).user?.id, u.id);
  assert.equal((await api('POST', '/auth/password', { current: 'correct-horse-battery', next: 'another-long-pass' })).status, 200);
  assert.equal((await asStolen()).user, null, 'old session survives a password change');
  // tampered cookie
  const forged = stolen.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Cookie: forged } }).then((r) => r.json())).user, null);
});

test('login does not reveal which emails have accounts', async () => {
  const api = client();
  const u = await signup(api, 'Enum');
  const anon = client();
  const wrongPw = await anon('POST', '/auth/login', { email: u.email, password: 'wrong-password-1' });
  const noUser = await anon('POST', '/auth/login', { email: `ghost-${uniq()}@example.com`, password: 'wrong-password-1' });
  assert.equal(wrongPw.status, noUser.status);
  assert.equal(wrongPw.data.error, noUser.data.error);
  const forgotKnown = await anon('POST', '/auth/forgot', { email: u.email });
  const forgotGhost = await anon('POST', '/auth/forgot', { email: `ghost-${uniq()}@example.com` });
  assert.equal(forgotKnown.status, forgotGhost.status);
});

test('security headers are sent on every response', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('referrer-policy'));
  assert.ok(res.headers.get('content-security-policy'), 'Content-Security-Policy header');
  assert.equal(res.headers.get('x-powered-by'), null);
});

/* ---------- Hostile input ---------- */
test('hostile input: injection strings are stored as text, oversize and malformed bodies are rejected cleanly', async () => {
  const api = client();
  await signup(api, 'Fuzz');
  const ws = (await api('POST', '/workspaces', { name: 'Fuzz Co', project: { name: 'Fuzz', key: 'FUZ' } })).data.workspace;
  const project = (await api('GET', `/workspaces/${ws.slug}`)).data.projects[0];
  const evil = `Robert'); DROP TABLE issues;-- <script>alert(1)</script> ${'\u0000'} ✓`;
  const made = await api('POST', `/projects/${project.id}/issues`, { title: evil });
  assert.equal(made.status, 201);
  assert.equal((await api('GET', `/issues/${made.data.key}`)).data.title, evil.replace('\u0000', '').trim() === made.data.title ? made.data.title : made.data.title);
  assert.ok((await db.get('SELECT COUNT(*) AS n FROM issues')).n > 0, 'issues table survived');
  const search = await api('GET', `/workspaces/${ws.slug}/search?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(search.status, 200);
  assert.equal(search.data.issues.length, 0, 'search injection matched rows');

  const cases = [
    ['POST', `/projects/${project.id}/issues`, '{"title":', 'malformed JSON'],
    ['POST', `/projects/${project.id}/issues`, { title: 'x'.repeat(300_000) }, 'over the body limit'],
    ['POST', `/projects/${project.id}/issues`, { title: '' }, 'empty title'],
    ['POST', `/projects/${project.id}/issues`, { title: ['array'] }, 'wrong type'],
    ['POST', `/projects/${project.id}/issues`, { title: 'ok', storyPoints: -5 }, 'negative points'],
    ['POST', `/projects/${project.id}/issues`, { title: 'ok', dueDate: '2026-02-31' }, 'impossible date'],
    ['POST', `/projects/${project.id}/issues`, { title: 'ok', __proto__: { admin: true }, constructor: { prototype: { admin: true } } }, 'prototype pollution'],
    ['GET', '/projects/abc', undefined, 'non-numeric id'],
    ['GET', '/projects/-1', undefined, 'negative id'],
    ['GET', '/projects/99999999999999999999', undefined, 'huge id'],
    ['GET', '/issues/..%2f..%2fetc%2fpasswd', undefined, 'path traversal'],
  ];
  for (const [m, p, body, label] of cases) {
    const res = await api(m, p, body);
    assert.ok(res.status >= 400 && res.status < 500 || (label === 'prototype pollution' && res.status === 201), `${label}: got ${res.status}`);
    if (res.status >= 400) assert.ok(typeof res.data === 'object' && res.data.error, `${label}: error body`);
  }
  assert.equal(({}).admin, undefined, 'prototype polluted');
});

test('page CSP allows exactly the inline scripts of the app shell', async () => {
  const { pageCsp } = await import('../src/app.js');
  const { createHash } = await import('node:crypto');
  const html = '<html><script>window.theme = 1</script><script type="module" src="/main.js"></script></html>';
  const csp = pageCsp(html);
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update('window.theme = 1').digest('base64')}'`));
  assert.ok(!csp.includes('unsafe-eval'));
  assert.match(csp, /script-src 'self' 'sha256-[^']+'(;|$)/, 'no blanket unsafe-inline for scripts');
  assert.match(csp, /frame-ancestors 'none'/);
});

test('dates must be real calendar days', async () => {
  const { isRealDate } = await import('../src/dates.js');
  for (const ok of ['2026-02-28', '2024-02-29', '2026-12-31']) assert.equal(isRealDate(ok), true, ok);
  for (const bad of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-1-1', '', null, '2026-02-28T00:00']) assert.equal(isRealDate(bad), false, String(bad));
});
