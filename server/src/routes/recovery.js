import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, rateLimit, SESSION_COOKIE, sessionCookieOptions } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { passwordResetEmail, mailHint } from '../emails.js';
import { session } from './auth.js';

const TTL_MINUTES = 60;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const iso = (d) => d.toISOString().replace('T', ' ').slice(0, 19);

/**
 * "Forgot password": emails a one-time link (valid for an hour) that lets the
 * owner of the inbox choose a new password. Only a hash of the token is
 * stored, the answer never reveals whether an account exists, and using the
 * link signs out every other device.
 */
export function recoveryRoutes({ db, signer, mailer, appUrl, production, log = console }) {
  const r = Router();
  const ipLimiter = rateLimit({ windowMs: 15 * 60_000, max: production ? 10 : 1000 });
  const emailLimiter = rateLimit({
    windowMs: 60 * 60_000, max: production ? 3 : 1000,
    key: (req) => typeof req.body?.email === 'string' && `reset:${req.body.email.trim().toLowerCase()}`,
    message: 'We have already sent a few reset emails to this address. Please check your inbox (and spam) or wait an hour.',
  });
  // Links must point at the real site. Behind the scenes in production that means APP_URL,
  // never the request's Host header, which a stranger could set to their own domain.
  const baseUrl = (req) => (appUrl || (production ? null : `${req.protocol}://${req.get('host')}`))?.replace(/\/$/, '');

  r.get('/recovery', (req, res) => res.json({ email: !!mailer && !!baseUrl(req) }));

  r.post('/forgot', ipLimiter, emailLimiter, async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email('enter a valid email address').max(200) }), req.body);
    if (!mailer) throw new HttpError(503, 'Password reset emails are not set up on this server yet. Ask your WorkMars admin to add an email account (see EMAIL.md), or sign in with Google.');
    const base = baseUrl(req);
    if (!base) throw new HttpError(503, 'Password reset needs APP_URL (the public address of WorkMars) to be set on the server.');
    const user = await db.get('SELECT id, name, email FROM users WHERE email = ?', email);
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', iso(new Date()), user.id);
      await db.run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)', user.id, sha256(token), iso(new Date(Date.now() + TTL_MINUTES * 60_000)));
      try {
        await mailer.send(passwordResetEmail({ to: user.email, name: user.name, url: `${base}/reset-password?token=${token}`, minutes: TTL_MINUTES }));
      } catch (err) {
        log.warn?.(`Password reset email to ${user.email} failed: ${err.message}`);
        throw new HttpError(502, `We couldn't send the email right now. ${mailHint(err.message)}`);
      }
    }
    // Same answer either way, so this can't be used to find out who has an account.
    res.json({ ok: true });
  });

  const findToken = async (token) => {
    const row = await db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(String(token)));
    if (!row || row.used_at || row.expires_at < iso(new Date())) return null;
    return row;
  };

  r.get('/reset/:token', async (req, res) => {
    const row = await findToken(req.params.token);
    if (!row) throw new HttpError(400, 'This reset link has expired or was already used. Ask for a new one.');
    const user = await db.get('SELECT email FROM users WHERE id = ?', row.user_id);
    res.json({ email: user?.email ?? '' });
  });

  r.post('/reset', ipLimiter, async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(8, 'use at least 8 characters').max(200) }), req.body);
    const user = await db.tx(async () => {
      const row = await findToken(body.token);
      if (!row) throw new HttpError(400, 'This reset link has expired or was already used. Ask for a new one.');
      const u = await db.get('SELECT * FROM users WHERE id = ?', row.user_id);
      const version = (u.session_version ?? 0) + 1;
      // Following the emailed link proves the inbox, so the address counts as verified too.
      await db.run('UPDATE users SET password_hash = ?, session_version = ?, email_verified = 1 WHERE id = ?', hashPassword(body.password), version, u.id);
      await db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', iso(new Date()), u.id);
      return { ...u, session_version: version };
    });
    res.cookie(SESSION_COOKIE, signer.issue(user.id, user.session_version), sessionCookieOptions(production && req.secure));
    res.json(await session(db, user.id));
  });

  return r;
}
