import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword, requireUser, rateLimit, SESSION_COOKIE, sessionCookieOptions, NO_PASSWORD } from '../auth.js';
import { googleRoutes } from './google.js';
import { HttpError, parse, isUniqueViolation } from '../http.js';
import { me as serializeMe, workspace as serializeWorkspace } from '../serialize.js';
import { USER_COLORS } from '../templates.js';
import { newRecoveryCodes, newSecret, otpauthUri, useRecoveryCode, verifyCode } from '../totp.js';

const email = z.string().trim().toLowerCase().email('enter a valid email address').max(200);
const password = z.string().min(8, 'use at least 8 characters').max(200);

export function authRoutes(ctx) {
  const { db, signer, production } = ctx;
  const r = Router();
  r.use(googleRoutes(ctx));
  const limiter = rateLimit({ windowMs: 60_000, max: production ? 10 : 1000 });
  // Per-account limit too, so rotating IP addresses can't guess one person's password.
  const accountLimiter = rateLimit({
    windowMs: 15 * 60_000, max: production ? 20 : 1000,
    key: (req) => typeof req.body?.email === 'string' && req.body.email.trim().toLowerCase(),
    message: 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.',
  });

  // Secure cookies only over HTTPS, so production mode still works on http://localhost.
  const startSession = (req, res, user) => res.cookie(SESSION_COOKIE, signer.issue(user.id, user.session_version ?? 0), sessionCookieOptions(production && req.secure));

  r.post('/signup', limiter, async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1, 'tell us your name').max(80), email, password }), req.body);
    if (await db.get('SELECT 1 FROM users WHERE email = ?', body.email)) {
      throw new HttpError(409, 'An account with this email already exists. Try signing in instead.');
    }
    const count = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    let id;
    try {
      id = Number((await db.run(
        'INSERT INTO users (email, name, password_hash, color) VALUES (?, ?, ?, ?)',
        body.email, body.name, hashPassword(body.password), USER_COLORS[count % USER_COLORS.length],
      )).lastInsertRowid);
    } catch (err) {
      // A double-submitted form can race past the check above.
      if (isUniqueViolation(err)) throw new HttpError(409, 'An account with this email already exists. Try signing in instead.');
      throw err;
    }
    startSession(req, res, { id });
    res.status(201).json(await session(db, id));
  });

  r.post('/login', limiter, accountLimiter, async (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'enter your password') }), req.body);
    const user = await db.get('SELECT * FROM users WHERE email = ?', body.email);
    if (user?.password_hash === NO_PASSWORD) {
      throw new HttpError(401, 'This account signs in with Google. Use “Continue with Google” instead.');
    }
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(401, 'That email and password combination did not match. Please try again.');
    }
    // Two-step sign-in: the password is right, now ask for the code before starting a session.
    if (user.totp_enabled) return res.json({ needsTwoFactor: true, ticket: twoFactorTicket(signer, user) });
    startSession(req, res, user);
    res.json(await session(db, user.id));
  });

  // ---- Two-step sign-in (authenticator app codes) ----
  const codeLimiter = rateLimit({ windowMs: 15 * 60_000, max: production ? 10 : 1000, key: (req) => `2fa:${String(req.body?.ticket ?? '').slice(0, 40)}:${req.ip}`, message: 'Too many codes tried. Please wait 15 minutes and sign in again.' });
  r.post('/2fa', limiter, codeLimiter, async (req, res) => {
    const body = parse(z.object({ ticket: z.string().min(10).max(2000), code: z.string().trim().min(6).max(20) }), req.body);
    const t = signer.unseal(body.ticket);
    if (!t || t.step !== '2fa') throw new HttpError(401, 'That sign-in took too long. Please sign in again.');
    const user = await db.get('SELECT * FROM users WHERE id = ?', t.uid);
    if (!user || !user.totp_enabled || (user.session_version ?? 0) !== t.sv) throw new HttpError(401, 'Please sign in again.');
    if (verifyCode(user.totp_secret, body.code) < 0) {
      const left = useRecoveryCode(user.totp_recovery, body.code);
      if (!left) throw new HttpError(401, 'That code didn’t match. Check your authenticator app (codes change every 30 seconds) or use a recovery code.');
      await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', JSON.stringify(left), user.id);
    }
    startSession(req, res, user);
    res.json(await session(db, user.id));
  });

  /** Step 1 of turning it on: a new secret for the authenticator app (not active until a code confirms it). */
  r.post('/2fa/setup', requireUser, limiter, async (req, res) => {
    if (req.user.totp_enabled) throw new HttpError(400, 'Two-step sign-in is already on.');
    const secret = newSecret();
    await db.run('UPDATE users SET totp_secret = ? WHERE id = ?', secret, req.user.id);
    res.json({ secret, uri: otpauthUri(secret, req.user.email) });
  });

  r.post('/2fa/enable', requireUser, limiter, async (req, res) => {
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!user.totp_secret) throw new HttpError(400, 'Start the setup again.');
    if (verifyCode(user.totp_secret, code) < 0) throw new HttpError(400, 'That code didn’t match. Make sure your phone’s clock is set automatically and try the newest code.');
    const { codes, hashes } = newRecoveryCodes();
    await db.run('UPDATE users SET totp_enabled = 1, totp_recovery = ? WHERE id = ?', JSON.stringify(hashes), user.id);
    await auditUser(db, user.id, 'security.2fa_on', req.ip);
    res.json({ recoveryCodes: codes, ...await session(db, user.id) });
  });

  r.post('/2fa/disable', requireUser, limiter, async (req, res) => {
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!user.totp_enabled) return res.json(await session(db, user.id));
    if (verifyCode(user.totp_secret, code) < 0 && !useRecoveryCode(user.totp_recovery, code)) throw new HttpError(400, 'That code didn’t match.');
    await db.run("UPDATE users SET totp_enabled = 0, totp_secret = '', totp_recovery = '[]' WHERE id = ?", user.id);
    await auditUser(db, user.id, 'security.2fa_off', req.ip);
    res.json(await session(db, user.id));
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', async (req, res) => {
    res.json(req.user ? await session(db, req.user.id) : { user: null, workspaces: [] });
  });

  r.patch('/me', requireUser, async (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(1, 'tell us your name').max(80, 'keep your name under 80 characters').optional(),
      jobTitle: z.string().trim().max(80).optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      locale: z.enum(['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU']).optional(),
    }), req.body);
    const map = { name: 'name', jobTitle: 'job_title', theme: 'theme', locale: 'locale' };
    for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) await db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, body[k], req.user.id);
    res.json(await session(db, req.user.id));
  });

  /** Changes the password (or sets one for a Google-only account) and signs out every other device. */
  r.post('/password', requireUser, limiter, async (req, res) => {
    const body = parse(z.object({ current: z.string().default(''), next: password }), req.body);
    const hasPassword = req.user.password_hash !== NO_PASSWORD;
    if (hasPassword && !verifyPassword(body.current, req.user.password_hash)) throw new HttpError(400, 'Your current password is not correct.');
    const version = (req.user.session_version ?? 0) + 1;
    await db.run('UPDATE users SET password_hash = ?, session_version = ? WHERE id = ?', hashPassword(body.next), version, req.user.id);
    startSession(req, res, { id: req.user.id, session_version: version });
    res.json({ ok: true });
  });

  /** Signs out everywhere, e.g. after using a shared computer. */
  r.post('/logout-all', requireUser, async (req, res) => {
    await db.run('UPDATE users SET session_version = ? WHERE id = ?', (req.user.session_version ?? 0) + 1, req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return r;
}

/** Short-lived proof that the password (or Google) step passed; the code step turns it into a session. */
export const twoFactorTicket = (signer, user) => signer.seal({ uid: user.id, sv: user.session_version ?? 0, step: '2fa' }, 5 * 60_000);

/** Security events are recorded in every workspace the person belongs to. */
async function auditUser(db, userId, action, ip) {
  for (const m of await db.all('SELECT workspace_id FROM memberships WHERE user_id = ?', userId)) {
    await db.run('INSERT INTO audit_log (workspace_id, user_id, action, ip) VALUES (?, ?, ?, ?)', m.workspace_id, userId, action, ip ?? '');
  }
}

export async function session(db, userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', userId);
  const workspaces = (await db.all(
    'SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY m.joined_at, w.id',
    userId,
  )).map((w) => serializeWorkspace(w, w.role));
  return { user: serializeMe(user), workspaces };
}
