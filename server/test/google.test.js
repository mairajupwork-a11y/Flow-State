import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

/** A stand-in for Google's OAuth endpoints so the whole flow runs offline. */
let fake;
let fakeUrl;
let profile = { email: 'priya@example.com', email_verified: true, name: 'Priya Shah' };
const seen = {};
before(async () => {
  fake = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url.startsWith('/token')) {
      const p = new URLSearchParams(body);
      seen.token = Object.fromEntries(p);
      const ok = p.get('code') === 'good-code' && p.get('client_secret') === 'secret' && p.get('code_verifier')?.length > 40;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(ok ? { access_token: 'at-123', id_token: 'x' } : { error: 'invalid_grant' }));
    }
    if (req.url.startsWith('/userinfo')) {
      const ok = req.headers.authorization === 'Bearer at-123';
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(ok ? profile : {}));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => fake.listen(0, r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
});
after(() => fake.close());

const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections(); s.close(); }));
function start(google) {
  const db = openDatabase(':memory:');
  const app = createApp({ db, secret: 'test-secret', log: { error() {} }, google });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, db }));
    servers.push(server);
  });
}

const google = () => ({ clientId: 'client-1', clientSecret: 'secret', endpoints: { auth: `${fakeUrl}/auth`, token: `${fakeUrl}/token`, userinfo: `${fakeUrl}/userinfo` } });
const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

/** Runs the redirect → consent → callback dance like a browser would. */
async function signIn(base, { next = '/', code = 'good-code', tamper = false } = {}) {
  const startRes = await fetch(`${base}/api/auth/google?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
  assert.equal(startRes.status, 302);
  const consent = new URL(startRes.headers.get('location'));
  const state = cookieOf(startRes, 'fs_oauth');
  assert.ok(state, 'state cookie set');
  const back = new URL(`${base}/api/auth/google/callback`);
  back.searchParams.set('code', code);
  back.searchParams.set('state', tamper ? 'forged' : consent.searchParams.get('state'));
  const cb = await fetch(back, { redirect: 'manual', headers: { Cookie: state } });
  return { consent, cb, session: cookieOf(cb, 'fs_session') };
}

test('providers endpoint reports whether Google is configured', async () => {
  const off = await start(null);
  assert.deepEqual(await (await fetch(`${off.base}/api/auth/providers`)).json(), { google: false, email: false });
  const offStart = await fetch(`${off.base}/api/auth/google`, { redirect: 'manual' });
  assert.match(offStart.headers.get('location'), /^\/login\?error=/);
  off.server.close();
  const on = await start(google());
  assert.deepEqual(await (await fetch(`${on.base}/api/auth/providers`)).json(), { google: true, email: false });
  on.server.close();
});

test('Google sign-in creates an account, signs in, and links on return', async () => {
  const { server, base, db } = await start(google());
  const first = await signIn(base, { next: '/invite/abc' });
  assert.equal(first.consent.searchParams.get('client_id'), 'client-1');
  assert.equal(first.consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(first.consent.searchParams.get('redirect_uri'), `${base}/api/auth/google/callback`);
  assert.equal(seen.token.redirect_uri, `${base}/api/auth/google/callback`);
  assert.equal(first.cb.status, 302);
  assert.equal(first.cb.headers.get('location'), '/invite/abc');
  assert.ok(first.session);

  const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: first.session } })).json();
  assert.equal(me.user.email, 'priya@example.com');
  assert.equal(me.user.name, 'Priya Shah');
  assert.equal(me.workspaces.length, 0, 'new users go to onboarding');

  const again = await signIn(base);
  assert.ok(again.session);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 1, 'same email reuses the account');

  const pw = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate' }, body: JSON.stringify({ email: 'priya@example.com', password: 'whatever1' }) });
  assert.equal(pw.status, 401);
  assert.match((await pw.json()).error, /Continue with Google/);
  server.close();
});

test('an existing password account is linked by verified email', async () => {
  const { server, base, db } = await start(google());
  const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate' }, body: JSON.stringify({ name: 'Priya', email: 'Priya@Example.com', password: 'correct-horse' }) });
  assert.equal(signup.status, 201);
  const oldCookie = signup.headers.get('set-cookie').split(';')[0];
  const { session } = await signIn(base);
  assert.ok(session);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 1);
  // The address was never proven, so whoever set that password may be an impostor:
  // linking drops the password and signs out its sessions.
  const me = (cookie) => fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal((await me(oldCookie)).user, null, 'pre-existing sessions are revoked');
  assert.equal((await me(session)).user.email, 'priya@example.com');
  assert.equal((await me(session)).user.hasPassword, false);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate' }, body: JSON.stringify({ email: 'priya@example.com', password: 'correct-horse' }) });
  assert.equal(login.status, 401);
  // Google-only accounts can set a password without knowing an old one.
  const set = await fetch(`${base}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate', Cookie: session }, body: JSON.stringify({ next: 'brand-new-pass' }) });
  assert.equal(set.status, 200);
  assert.equal((await me(session)).user, null, 'changing the password signs out other sessions');
  assert.ok((await me(set.headers.get('set-cookie').split(';')[0])).user, 'but keeps this one signed in');
  server.close();
});

test('forged state, bad codes and unverified emails are rejected', async () => {
  const { server, base, db } = await start(google());
  const forged = await signIn(base, { tamper: true });
  assert.match(forged.cb.headers.get('location'), /^\/login\?error=.*expired/);
  assert.equal(forged.session, undefined);

  const bad = await signIn(base, { code: 'stolen-code' });
  assert.match(bad.cb.headers.get('location'), /^\/login\?error=/);
  assert.equal(bad.session, undefined);

  profile = { email: 'eve@example.com', email_verified: false, name: 'Eve' };
  const unverified = await signIn(base);
  assert.equal(unverified.cb.headers.get('location'), '/login?error=google_unverified');
  assert.equal(unverified.session, undefined);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM users')).n, 0);
  profile = { email: 'priya@example.com', email_verified: true, name: 'Priya Shah' };

  const noCookie = await fetch(`${base}/api/auth/google/callback?code=good-code&state=x`, { redirect: 'manual' });
  assert.match(noCookie.headers.get('location'), /expired/);
  const open = await signIn(base, { next: '//evil.example' });
  assert.equal(open.cb.headers.get('location'), '/', 'no open redirects');
  const backslash = await signIn(base, { next: '/\\evil.example' });
  assert.equal(backslash.cb.headers.get('location'), '/', 'browsers read /\\ as //');
  server.close();
});
