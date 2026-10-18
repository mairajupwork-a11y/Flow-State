import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { NO_PASSWORD, SESSION_COOKIE, sessionCookieOptions, rateLimit } from '../auth.js';
import { USER_COLORS } from '../templates.js';

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
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function googleRoutes({ db, signer, production, google, mailer }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, max: production ? 20 : 1000 });
  const urls = { ...ENDPOINTS, ...(google?.endpoints ?? {}) };
  const enabled = !!(google?.clientId && google?.clientSecret);

  // The redirect URI must match one registered in Google Cloud exactly.
  const redirectUri = (req) => google.redirectUrl || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const fail = (res, reason) => res.redirect(`/login?error=${encodeURIComponent(reason)}`);

  r.get('/providers', (_req, res) => res.json({ google: enabled, email: !!mailer }));

  r.get('/google', limiter, (req, res) => {
    if (!enabled) return fail(res, 'Google sign-in is not set up on this server yet.');
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
    if (req.query.error) return fail(res, req.query.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in did not complete. Please try again.');
    if (!saved || typeof req.query.state !== 'string' || req.query.state !== saved.state || typeof req.query.code !== 'string') {
      return fail(res, 'Your Google sign-in expired. Please try again.');
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
      return fail(res, 'Google sign-in failed. Please try again.');
    }

    const email = String(profile.email ?? '').trim().toLowerCase();
    if (!email || profile.email_verified !== true) return fail(res, 'Your Google account email is not verified, so it cannot be used to sign in.');

    let user = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      const count = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
      const name = String(profile.name || profile.given_name || email.split('@')[0]).trim().slice(0, 80);
      const { lastInsertRowid } = await db.run('INSERT INTO users (email, name, password_hash, color) VALUES (?, ?, ?, ?)',
        email, name, NO_PASSWORD, USER_COLORS[count % USER_COLORS.length]);
      user = { id: Number(lastInsertRowid) };
    }
    res.cookie(SESSION_COOKIE, signer.issue(user.id), sessionCookieOptions(production && req.secure));
    res.redirect(saved.next);
  });

  return r;
}
