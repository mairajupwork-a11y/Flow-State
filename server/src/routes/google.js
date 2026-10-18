import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { NO_PASSWORD, SESSION_COOKIE, sessionCookieOptions, rateLimit } from '../auth.js';
import { USER_COLORS } from '../templates.js';
import { isUniqueViolation } from '../http.js';

/**
 * "Continue with Google" — OAuth 2.0 authorization code flow with PKCE.
 *
 *   GET /api/auth/google            → redirects to Google's consent screen
 *   GET /api/auth/google/callback   → exchanges the code, signs the user in
 *
 * Accounts are matched by verified email: an existing Flowstate account with
 * the same address is signed in, otherwise a new one is created (and goes
 * through onboarding). Configure with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 */
const STATE_COOKIE = 'fs_oauth';
const ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
};

const b64url = (buf) => buf.toString('base64url');
/** Only same-site paths: no `//host`, no `/\\host` (browsers treat `\\` as `/`), no control characters. */
export const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])[^\\\s]*$/.test(next) ? next : '/');

export function googleRoutes({ db, signer, production, google, mailer }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, max: production ? 20 : 1000 });
  const urls = { ...ENDPOINTS, ...(google?.endpoints ?? {}) };
  const enabled = !!(google?.clientId && google?.clientSecret);

  // The redirect URI must match one registered in Google Cloud exactly.
  const redirectUri = (req) => google.redirectUrl || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  // Errors travel as fixed codes (the login page maps them to messages), keeping any invite `next`.
  const fail = (res, code, next = '/') => res.redirect(`/login?error=${code}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);

  r.get('/providers', (_req, res) => res.json({ google: enabled, email: !!mailer }));

  r.get('/google', limiter, (req, res) => {
    if (!enabled) return fail(res, 'google_off', safeNext(req.query.next));
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const uri = redirectUri(req);
    res.cookie(STATE_COOKIE, signer.seal({ state, verifier, uri, next: safeNext(req.query.next) }, 10 * 60_000), {
      httpOnly: true, sameSite: 'lax', secure: production && req.secure, maxAge: 10 * 60_000, path: '/api/auth/google',
    });
    const params = new URLSearchParams({
      client_id: google.clientId, redirect_uri: uri, response_type: 'code', scope: 'openid email profile',
      state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    res.redirect(`${urls.auth}?${params}`);
  });

  r.get('/google/callback', limiter, async (req, res) => {
    const saved = signer.unseal(req.cookies?.[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
    if (req.query.error) return fail(res, req.query.error === 'access_denied' ? 'google_cancelled' : 'google_incomplete', saved?.next);
    if (!saved || typeof req.query.state !== 'string' || req.query.state !== saved.state || typeof req.query.code !== 'string') {
      return fail(res, 'google_expired', saved?.next);
    }

    let profile;
    try {
      const tokenRes = await fetch(urls.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code, client_id: google.clientId, client_secret: google.clientSecret,
          redirect_uri: saved.uri, grant_type: 'authorization_code', code_verifier: saved.verifier,
        }),
      });
      const tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || `token exchange failed (${tokenRes.status})`);
      const infoRes = await fetch(urls.userinfo, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      profile = await infoRes.json();
      if (!infoRes.ok) throw new Error(`profile request failed (${infoRes.status})`);
    } catch (err) {
      console.error('Google sign-in failed:', err.message);
      return fail(res, 'google_failed', saved.next);
    }

    const email = String(profile.email ?? '').trim().toLowerCase();
    if (!email || profile.email_verified !== true) return fail(res, 'google_unverified', saved.next);

    let user = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      const count = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
      const name = String(profile.name || profile.given_name || email.split('@')[0]).trim().slice(0, 80);
      try {
        await db.run('INSERT INTO users (email, name, password_hash, color, email_verified) VALUES (?, ?, ?, ?, 1)',
          email, name, NO_PASSWORD, USER_COLORS[count % USER_COLORS.length]);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err; // a replayed callback created it a moment ago
      }
      user = await db.get('SELECT * FROM users WHERE email = ?', email);
    } else if (!user.email_verified) {
      // Password sign-ups never proved they own the address, so whoever set that
      // password may not be this person. Google just proved ownership: drop the
      // unproven password and sign out its sessions before linking.
      const version = (user.session_version ?? 0) + 1;
      await db.run('UPDATE users SET email_verified = 1, password_hash = ?, session_version = ? WHERE id = ?', NO_PASSWORD, version, user.id);
      user = { ...user, session_version: version };
    }
    res.cookie(SESSION_COOKIE, signer.issue(user.id, user.session_version ?? 0), sessionCookieOptions(production && req.secure));
    res.redirect(saved.next);
  });

  return r;
}
