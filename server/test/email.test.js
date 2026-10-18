import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/mail.js';

function client(base) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'flowstate', ...(cookie && { Cookie: cookie }) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

function start(t, opts) {
  const app = createApp({ db: openDatabase(':memory:'), secret: 's', log: { error() {} }, ...opts });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api` }));
    t.after(() => { server.closeAllConnections(); server.close(); });
  });
}

async function admin(api, invites = []) {
  await api('POST', '/auth/signup', { name: 'Mairaj <Ali>', email: 'owner@example.com', password: 'correct-horse' });
  return api('POST', '/workspaces', { name: 'Studio & Co', invites });
}

test('invitations are emailed to any address with a working join link', async (t) => {
  const sent = [];
  const mailer = { send: async (m) => { if (m.to.endsWith('@bounce.test')) throw new Error('550 mailbox unavailable'); sent.push(m); } };
  const { server, base } = await start(t, { mailer, appUrl: 'https://flowstate.example/' });
  const api = client(base);

  const onboard = await admin(api, ['first@hotmail.com']);
  assert.equal(onboard.data.invites[0].emailed, true, 'onboarding invites are emailed too');
  const slug = onboard.data.workspace.slug;

  const res = await api('POST', `/workspaces/${slug}/invites`, { emails: ['sam@gmail.com', 'lee@yahoo.co.uk', 'x@bounce.test'], role: 'viewer' });
  assert.equal(res.status, 201);
  const byEmail = Object.fromEntries(res.data.map((i) => [i.email, i]));
  assert.equal(byEmail['sam@gmail.com'].emailed, true);
  assert.equal(byEmail['lee@yahoo.co.uk'].emailed, true);
  assert.equal(byEmail['x@bounce.test'].emailed, false, 'a failed send does not fail the invite');
  assert.match(byEmail['x@bounce.test'].emailError, /spelled correctly/);

  const mail = sent.find((m) => m.to === 'sam@gmail.com');
  assert.match(mail.subject, /Mairaj <Ali> invited you to Studio & Co/);
  assert.ok(mail.text.includes(`https://flowstate.example/invite/${byEmail['sam@gmail.com'].token}`));
  assert.ok(mail.html.includes('Mairaj &lt;Ali&gt;') && !mail.html.includes('<Ali>'), 'names are HTML-escaped');
  assert.match(mail.html, /as a viewer/);

  // The emailed link really works: the invitee can preview and accept it.
  const preview = await fetch(`${base}/invites/${byEmail['sam@gmail.com'].token}`).then((r) => r.json());
  assert.equal(preview.workspaceName, 'Studio & Co');
  const sam = client(base);
  await sam('POST', '/auth/signup', { name: 'Sam', email: 'sam@gmail.com', password: 'longenough1' });
  assert.equal((await sam('POST', `/invites/${byEmail['sam@gmail.com'].token}/accept`)).status, 200);

  const resend = await api('POST', `/workspaces/${slug}/invites/${byEmail['lee@yahoo.co.uk'].token}/resend`);
  assert.equal(resend.status, 200);
  assert.equal(sent.filter((m) => m.to === 'lee@yahoo.co.uk').length, 2);
  assert.equal((await api('POST', `/workspaces/${slug}/invites/${byEmail['x@bounce.test'].token}/resend`)).status, 502);
  assert.deepEqual(await fetch(`${base}/auth/providers`).then((r) => r.json()), { google: false, email: true });
});

test('without SMTP, invites still work as links and say they were not emailed', async (t) => {
  const { server, base } = await start(t, {});
  const api = client(base);
  const slug = (await admin(api)).data.workspace.slug;
  const res = await api('POST', `/workspaces/${slug}/invites`, { emails: ['sam@gmail.com'] });
  assert.equal(res.data[0].emailed, false);
  assert.ok(res.data[0].token);
  assert.equal((await api('POST', `/workspaces/${slug}/invites/${res.data[0].token}/resend`)).status, 400);
  assert.deepEqual(await fetch(`${base}/auth/providers`).then((r) => r.json()), { google: false, email: false });
});

test('the SMTP mailer delivers a real message over the wire', async () => {
  // Minimal SMTP server: enough of RFC 5321 to accept one authenticated message.
  const received = { auth: null, from: null, to: [], data: '' };
  const smtp = createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        received.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        sock.write('250 OK queued\r\n');
      }
      let i;
      while (!inData && (i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN/i.test(line)) { received.auth = Buffer.from(line.split(' ')[2], 'base64').toString(); sock.write('235 ok\r\n'); }
        else if (/^MAIL FROM/i.test(line)) { received.from = line; sock.write('250 ok\r\n'); }
        else if (/^RCPT TO/i.test(line)) { received.to.push(line); sock.write('250 ok\r\n'); }
        else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const port = smtp.address().port;
  const mailer = createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'bot@example.com', SMTP_PASS: 'app-pass', MAIL_FROM: 'Flowstate <bot@example.com>' });
  assert.equal(await mailer.verify(), null);
  await mailer.send({ to: 'friend@outlook.com', subject: 'Hello', text: 'Join here', html: '<b>Join</b>' });
  assert.match(received.auth, /bot@example\.com\0app-pass/);
  assert.match(received.from, /bot@example\.com/);
  assert.match(received.to[0], /friend@outlook\.com/);
  assert.match(received.data, /Subject: Hello/);
  assert.match(received.data, /Flowstate/);
  smtp.close();
  assert.equal(createMailer({}), null, 'no SMTP settings means email is off');
});
