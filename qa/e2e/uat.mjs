/**
 * WorkMars browser acceptance suite (black-box UAT + responsive, accessibility, performance, CSP).
 * Run:  npm run build  &&  node qa/e2e/server.mjs  (in one terminal)  &&  node qa/e2e/uat.mjs
 * Needs Playwright with Chromium (npx playwright install chromium) — set PLAYWRIGHT to its path if it isn't resolvable.
 */
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
import { readFileSync } from 'node:fs';
import { codeAt } from '../../server/src/totp.js';
const totp = (s) => codeAt(s, Math.floor(Date.now() / 30000));

const B = process.env.UAT_URL ?? 'http://127.0.0.1:4710';
const OUT = new URL('./out/', import.meta.url).pathname;
(await import('node:fs')).mkdirSync(OUT, { recursive: true });
const MAIL = new URL('./out/mail.json', import.meta.url).pathname;
const T = Date.now();
const results = [];
const consoleErrors = [];
const b = await chromium.launch();

async function newPage(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => consoleErrors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|403|404|400)/.test(m.text())) consoleErrors.push(`console ${p.url()}: ${m.text()}`); });
  p.on('response', (r) => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return p;
}
async function step(id, name, fn, page) {
  const t0 = Date.now();
  try { await fn(); results.push({ id, name, ok: true, ms: Date.now() - t0 }); console.log('PASS', id, name); }
  catch (e) {
    results.push({ id, name, ok: false, err: e.message.split('\n')[0] });
    console.log('FAIL', id, name, '—', e.message.split('\n')[0]);
    if (page) await page.screenshot({ path: `${OUT}${id}.png` }).catch(() => {});
  }
}
const expect = (c, msg) => { if (!c) throw new Error(msg); };
const mails = () => { try { return JSON.parse(readFileSync(MAIL, 'utf8')); } catch { return []; } };
const linkIn = (m) => (m.text.match(/https?:\/\/\S+/) ?? [])[0];

/* ================= Admin journey ================= */
const p = await newPage();
const email = `owner${T}@mailinator.com`;
let slug, key;

await step('UAT-01', 'Landing page loads, hero and CTAs work', async () => {
  await p.goto(B + '/welcome');
  await p.waitForSelector('.pd-chrome .wm-logo');
  expect(await p.locator('text=Start free').first().isVisible(), 'Start free CTA missing');
  await p.locator('.pd-chrome a:has-text("Start free")').click();
  await p.waitForURL(/signup/);
}, p);

await step('UAT-02', 'Sign-up form validation (short password, bad email)', async () => {
  await p.fill('input[placeholder="e.g. Alex Morgan"]', 'Olivia Owner');
  await p.fill('input[placeholder="you@company.com"]', 'not-an-email');
  await p.fill('input[placeholder="At least 8 characters"]', 'short');
  await p.click('button:has-text("Create free account")');
  await p.waitForTimeout(500);
  expect(/signup/.test(p.url()), 'accepted invalid sign-up');
}, p);

await step('UAT-03', 'Sign up with valid details', async () => {
  await p.fill('input[placeholder="you@company.com"]', email);
  await p.fill('input[placeholder="At least 8 characters"]', 'longenough1');
  await p.click('button:has-text("Create free account")');
  await p.waitForURL(/onboarding/, { timeout: 8000 });
}, p);

await step('UAT-04', 'Onboarding: all steps, logo upload, open project', async () => {
  await p.click('text=SaaS & product');
  await p.selectOption('.onboard-step select', { index: 2 });
  await p.click('button:has-text("Continue")');
  await p.fill('input[placeholder="e.g. Studio North"]', 'Olivia Studio'); await p.click('button:has-text("Continue")');
  await p.fill('input[placeholder="e.g. Website Redesign"]', 'Website'); await p.click('button:has-text("Continue")');
  await p.locator('.onboard-actions button.btn-primary').click(); await p.waitForTimeout(2000);
  expect(await p.locator('.onboard-step.ready').count(), 'never reached the ready step');
  await p.setInputFiles('.logo-uploader input[type=file]', new URL('./fixture-logo.png', import.meta.url).pathname);
  await p.waitForSelector('.logo-uploader .ws-avatar img', { timeout: 5000 });
  await p.click('button:has-text("Open my project")');
  await p.waitForURL(/\/w\/[^/]+\/p\//);
  [, slug, key] = p.url().match(/\/w\/([^/]+)\/p\/([^/?]+)/);
  await p.waitForSelector('.workspace-switch .ws-avatar img', { timeout: 5000 });
}, p);

await step('UAT-05', 'Create a work item with the C shortcut', async () => {
  await p.goto(`${B}/w/${slug}/p/${key}/board`); await p.waitForTimeout(1200);
  await p.keyboard.press('c');
  await p.fill('input[placeholder="What needs to get done?"]', 'Ship the pricing page');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.task-card:has-text("Ship the pricing page")', { timeout: 5000 });
}, p);

await step('UAT-06', 'Drag a card to another column; it persists after reload', async () => {
  const card = p.locator('.task-card:has-text("Ship the pricing page")');
  const from = await card.boundingBox();
  const cols = p.locator('.kanban-col'); const n = await cols.count();
  let target = null;
  for (let i = 0; i < n; i++) { const bb = await cols.nth(i).boundingBox(); if (bb && bb.x > from.x + from.width + 20) { target = bb; break; } }
  expect(target, 'no column to the right');
  await p.mouse.move(from.x + 30, from.y + 20); await p.mouse.down();
  await p.mouse.move(from.x + 45, from.y + 25, { steps: 4 });
  await p.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 18 }); await p.waitForTimeout(250);
  await p.mouse.up(); await p.waitForTimeout(1200);
  await p.reload(); await p.waitForTimeout(1500);
  const after = await p.locator('.task-card:has-text("Ship the pricing page")').boundingBox();
  expect(Math.abs(after.x - from.x) > 50, `card did not move (x ${from.x} → ${after.x})`);
}, p);

let itemKey;
await step('UAT-07', 'Open work item: comment, checklist, log time', async () => {
  await p.locator('.task-card:has-text("Ship the pricing page")').click();
  await p.waitForSelector('textarea[aria-label="Write a comment"], textarea[placeholder^="Write a comment"]');
  itemKey = new URL(p.url()).searchParams.get('issue');
  await p.fill('[aria-label="Write a comment"]', 'Looks good — shipping Friday');
  await p.locator('button:has-text("Comment")').last().click();
  await p.waitForSelector('text=Looks good — shipping Friday', { timeout: 5000 });
  await p.fill('[aria-label="New checklist item"]', 'Proofread copy'); await p.keyboard.press('Enter');
  await p.waitForSelector('text=Proofread copy', { timeout: 5000 });
  const how = p.locator('[aria-label="How long"]');
  if (await how.count()) { await how.fill('1h 30m'); await p.keyboard.press('Enter'); await p.waitForSelector('text=/1h 30m/', { timeout: 5000 }); }
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
}, p);

await step('UAT-08', 'Command palette finds the work item', async () => {
  await p.keyboard.press('Control+k');
  await p.fill('input[placeholder^="Search work"]', 'pricing');
  await p.waitForSelector('[role=option]:has-text("Ship the pricing page"), .palette-item:has-text("Ship the pricing page"), button:has-text("Ship the pricing page")', { timeout: 5000 });
  await p.keyboard.press('Escape');
}, p);

await step('UAT-09', 'My day: add, complete and persist a to-do', async () => {
  await p.goto(`${B}/w/${slug}/my-day`); await p.waitForTimeout(1000);
  await p.fill('[aria-label="New to-do"], input[placeholder^="Add something"]', 'Call the client');
  await p.keyboard.press('Enter');
  await p.waitForSelector('text=Call the client');
  await p.locator('.todo-item:has-text("Call the client") .todo-check, .todo-row:has-text("Call the client") input[type=checkbox]').first().click();
  await p.reload(); await p.waitForTimeout(1000);
  expect(await p.locator('text=Call the client').count(), 'to-do lost after reload');
}, p);

await step('UAT-10', 'Every main page renders without errors (desktop)', async () => {
  for (const path of ['', '/my-day', '/my-tasks', '/team', '/timesheets', '/workload', '/settings', '/integrations', `/p/${key}/board`, `/p/${key}/backlog`, `/p/${key}/list`, `/p/${key}/timeline`, `/p/${key}/calendar`, `/p/${key}/reports`, `/p/${key}/settings`]) {
    const before = consoleErrors.length;
    await p.goto(`${B}/w/${slug}${path}`); await p.waitForTimeout(900);
    expect(!(await p.locator('text=/Something went wrong|Unknown API route/').count()), `error screen on ${path}`);
    expect(consoleErrors.length === before, `console error on ${path}: ${consoleErrors.at(-1)}`);
  }
}, p);

/* ================= Team journey ================= */
let inviteUrl;
await step('UAT-11', 'Invite a teammate by email (email is sent)', async () => {
  await p.goto(`${B}/w/${slug}/team`); await p.waitForTimeout(1000);
  await p.click('.team-banner button:has-text("Invite people"), button:has-text("Invite people")');
  await p.fill('.modal textarea', `thor${T}@mailinator.com`);
  await p.selectOption('.modal select', { index: 2 });
  await p.locator('.modal button.btn-primary').last().click();
  await p.waitForTimeout(1500);
  const m = mails().find((x) => x.to === `thor${T}@mailinator.com`);
  expect(m, 'no invitation email captured');
  inviteUrl = linkIn(m).replace(/^https?:\/\/[^/]+/, B);
  expect(/\/invite\//.test(inviteUrl), 'email has no invite link');
}, p);

await step('UAT-12', 'Invite opened while signed in as someone else is refused safely', async () => {
  await p.goto(inviteUrl); await p.waitForTimeout(1000);
  expect(await p.locator('.invite-mismatch').count(), 'no wrong-account warning');
  expect(!(await p.locator(`button:has-text("Join as")`).count()), 'offers to join as the wrong person');
}, p);

const t = await newPage();
await step('UAT-13', 'Invitee signs up from the email link and lands in the workspace', async () => {
  await t.goto(inviteUrl); await t.waitForTimeout(800);
  await t.click('text=Create a free account to join');
  await t.waitForURL(/signup/);
  await t.fill('input[placeholder="e.g. Alex Morgan"]', 'Thor Odinson');
  expect((await t.inputValue('input[placeholder="you@company.com"]')) === `thor${T}@mailinator.com`, 'email not prefilled');
  await t.fill('input[placeholder="At least 8 characters"]', 'longenough1');
  await t.click('button:has-text("Create free account")');
  await t.waitForTimeout(2000);
  if (/\/invite\//.test(t.url())) { await t.click('button:has-text("Join as")'); await t.waitForTimeout(1500); }
  await t.waitForURL(new RegExp(`/w/${slug}`), { timeout: 8000 });
  expect(await t.locator(`text=Thor`).count(), 'not signed in as Thor');
}, t);

await step('UAT-14', 'Member permissions: can move cards, cannot see admin settings', async () => {
  await t.goto(`${B}/w/${slug}/settings`); await t.waitForTimeout(1000);
  expect(!(await t.locator('.logo-uploader').count()), 'member sees organisation logo upload');
  const r = await t.evaluate(async (s) => (await fetch(`/api/workspaces/${s}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: '{"name":"hijack"}' })).status, slug);
  expect(r === 403, `member could rename workspace (${r})`);
}, t);

/* ================= Account security ================= */
await step('UAT-15', 'Log out, wrong password is rejected, right password signs in', async () => {
  await p.goto(`${B}/w/${slug}`);
  await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'workmars' } }));
  await p.goto(B + '/login'); await p.waitForTimeout(600);
  await p.fill('input[placeholder="you@company.com"]', email);
  await p.fill('input[placeholder="Your password"]', 'wrongpass99');
  await p.locator('form button[type=submit], form button.btn-primary').first().click(); await p.waitForTimeout(800);
  expect(await p.locator('[role=alert], .form-error').count(), 'no error for wrong password');
  await p.fill('input[placeholder="Your password"]', 'longenough1');
  await p.locator('form button[type=submit], form button.btn-primary').first().click();
  await p.waitForURL(/\/w\//, { timeout: 8000 });
}, p);

await step('UAT-16', 'Two-step sign-in: enable, then login needs the code', async () => {
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch('/api' + path, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }, [m, path, body]);
  const setup = await api('POST', '/auth/2fa/setup', { password: 'longenough1' });
  expect(setup.status === 200 && setup.data.secret, `setup failed ${setup.status}`);
  const en = await api('POST', '/auth/2fa/enable', { code: totp(setup.data.secret), password: 'longenough1' });
  expect(en.status === 200, `enable failed ${en.status} ${JSON.stringify(en.data)}`);
  await api('POST', '/auth/logout');
  await p.goto(B + '/login'); await p.waitForTimeout(500);
  await p.fill('input[placeholder="you@company.com"]', email);
  await p.fill('input[placeholder="Your password"]', 'longenough1');
  await p.locator('form button[type=submit], form button.btn-primary').first().click(); await p.waitForTimeout(1000);
  const code = p.locator('input[placeholder="123456"]');
  expect(await code.count(), 'no code step after password');
  await code.fill('000000'); await p.locator('form button[type=submit], form button.btn-primary').first().click(); await p.waitForTimeout(800);
  expect(!/\/w\//.test(p.url()), 'wrong code accepted');
  await code.fill(totp(setup.data.secret)); await p.locator('form button[type=submit], form button.btn-primary').first().click();
  await p.waitForURL(/\/w\//, { timeout: 8000 });
}, p);

await step('UAT-17', 'Forgot password email → reset link works once', async () => {
  const anon = await newPage();
  anon.on('response', async (r) => { if (r.url().includes('/auth/forgot')) console.log('   forgot →', r.status(), r.request().postData(), await r.text().catch(() => '')); });
  const n0 = mails().length;
  await anon.goto(B + '/login'); await anon.waitForTimeout(500);
  await anon.click('text=/Forgot/i'); await anon.waitForURL(/forgot/);
  await anon.waitForSelector('text=/Back in no time/i');
  await anon.fill('input[type=email]', `thor${T}@mailinator.com`);
  const [resp] = await Promise.all([anon.waitForResponse((r) => r.url().includes('/auth/forgot')), anon.locator('form button.btn-primary, form button[type=submit]').first().click()]);
  expect(resp.status() === 200, `forgot returned ${resp.status()}`);
  await anon.waitForTimeout(300);
  const m = mails().slice(n0).find((x) => x.to === `thor${T}@mailinator.com`);
  expect(m, 'no reset email');
  const url = linkIn(m).replace(/^https?:\/\/[^/]+/, B);
  await anon.goto(url); await anon.waitForTimeout(800);
  await anon.locator('input[type=password]').first().fill('brand-new-pass1');
  const second = anon.locator('input[type=password]').nth(1); if (await second.count()) await second.fill('brand-new-pass1');
  await anon.locator('form button.btn-primary, form button[type=submit]').first().click(); await anon.waitForTimeout(1500);
  expect(/\/w\/|\/login/.test(anon.url()), `reset did not finish (${anon.url()})`);
  await anon.goto(url); await anon.waitForTimeout(800);
  expect(await anon.locator('text=/expired|used|invalid|no longer/i').count(), 'reset link reusable');
}, p);

/* ================= Sharing ================= */
await step('UAT-18', 'Public read-only share link works signed out, and dies when revoked', async () => {
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch('/api' + path, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => null) }; }, [m, path, body]);
  const proj = (await api('GET', `/workspaces/${slug}`)).data.projects[0];
  const link = (await api('POST', `/projects/${proj.id}/share`, { label: 'Client' })).data;
  const anon = await newPage();
  await anon.goto(link.url.replace(/^https?:\/\/[^/]+/, B)); await anon.waitForTimeout(1200);
  expect(await anon.locator('text=Read-only view').count(), 'share page not shown');
  expect(await anon.locator('text=Ship the pricing page').count(), 'share page missing work');
  expect(!(await anon.locator('text=Looks good — shipping Friday').count()), 'share page leaks comments');
  await api('DELETE', `/share-links/${link.id}`);
  await anon.reload(); await anon.waitForTimeout(1000);
  expect(!(await anon.locator('text=Ship the pricing page').count()), 'revoked link still works');
}, p);

/* ================= Responsive & accessibility sweep ================= */
for (const [label, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['tablet', { width: 820, height: 1180, isMobile: true, hasTouch: true }], ['laptop', { width: 1366, height: 768 }], ['desktop', { width: 1920, height: 1080 }]]) {
  const { width, height, ...rest } = vp;
  const v = await newPage({ viewport: { width, height }, ...rest });
  await step(`UAT-RWD-${label}`, `No sideways scrolling on any page (${label} ${width}px)`, async () => {
    await v.goto(B + '/welcome');
    await v.evaluate((e) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'workmars' }, body: JSON.stringify({ email: e, password: 'brand-new-pass1' }) }), `thor${T}@mailinator.com`);
    const bad = [];
    for (const path of ['/welcome', '/login', '/signup', `/w/${slug}`, `/w/${slug}/my-day`, `/w/${slug}/team`, `/w/${slug}/timesheets`, `/w/${slug}/settings`, `/w/${slug}/p/${key}/board`, `/w/${slug}/p/${key}/list`, `/w/${slug}/p/${key}/reports`]) {
      await v.goto(B + path); await v.waitForTimeout(700);
      if (await v.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push(path);
    }
    await v.screenshot({ path: `${OUT}rwd-${label}.png` });
    expect(!bad.length, `overflow on ${bad.join(', ')}`);
  }, v);
}

await step('UAT-A11Y', 'Accessibility basics: names on buttons/inputs, alt on images, lang, focus ring', async () => {
  const issues = [];
  for (const path of ['/welcome', '/login', `/w/${slug}`, `/w/${slug}/p/${key}/board`, `/w/${slug}/settings`]) {
    await p.goto(B + path); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.querySelector('img[alt]:not([alt=""])') ? 'img' : '');
      const unnamedButtons = [...document.querySelectorAll('button, a[href]')].filter((el) => el.offsetParent && !name(el) && !el.getAttribute('aria-labelledby')).map((el) => el.outerHTML.slice(0, 90));
      const unlabeled = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')].filter((el) => el.offsetParent && !el.getAttribute('aria-label') && !el.closest('label') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute('aria-labelledby')).map((el) => el.outerHTML.slice(0, 90));
      const noAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-40));
      return { lang: document.documentElement.lang, unnamedButtons, unlabeled, noAlt, h1: document.querySelectorAll('h1').length };
    });
    if (!r.lang) issues.push(`${path}: no lang`);
    for (const k of ['unnamedButtons', 'unlabeled', 'noAlt']) if (r[k].length) issues.push(`${path}: ${k} ${r[k].length} e.g. ${r[k][0]}`);
  }
  await p.goto(`${B}/w/${slug}`); await p.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('Tab'); await p.waitForTimeout(350); // nav links animate their outline colour
    const f = await p.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { inSidebar: !!e.closest('.sidebar'), style: s.outlineStyle, color: s.outlineColor, tag: e.tagName + '.' + e.className }; });
    if (f.style === 'none') issues.push(`no focus ring on ${f.tag}`);
    else if (f.inSidebar && !/210, 255, 0|212, 255, 31/.test(f.color)) issues.push(`low-contrast focus ring on dark sidebar (${f.color}) ${f.tag}`);
  }
  expect(!issues.length, issues.join(' | '));
}, p);

await step('UAT-PERF', 'Performance: app shell loads fast, JS within budget', async () => {
  const perf = await newPage();
  const t0 = Date.now(); await perf.goto(B + '/welcome', { waitUntil: 'load' }); const load = Date.now() - t0;
  const js = await perf.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script').reduce((n, r) => n + (r.encodedBodySize || 0), 0));
  const lcp = await perf.evaluate(() => new Promise((res) => { new PerformanceObserver((l) => { const e = l.getEntries(); res(e.at(-1)?.startTime ?? 0); }).observe({ type: 'largest-contentful-paint', buffered: true }); setTimeout(() => res(-1), 3000); }));
  console.log(`   load ${load} ms, LCP ${Math.round(lcp)} ms, JS ${Math.round(js / 1024)} KB transferred`);
  expect(load < 4000, `load ${load} ms`);
}, p);

await step('UAT-CSP', 'No Content-Security-Policy violations or console errors during the whole run', async () => {
  expect(!consoleErrors.length, consoleErrors.slice(0, 5).join(' || '));
}, p);

await b.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
(await import('node:fs')).writeFileSync(OUT + 'uat-results.json', JSON.stringify({ results, consoleErrors }, null, 1));
process.exit(pass === results.length ? 0 : 1);
