import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { HttpError } from './http.js';

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'fs_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/** Stateless signed session token: base64url(payload).base64url(hmac). */
export function createSigner(secret) {
  const sign = (data) => createHmac('sha256', secret).update(data).digest('base64url');
  return {
    issue(userId) {
      const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    verify(token) {
      if (typeof token !== 'string') return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return data.exp > Date.now() ? data.uid : null;
      } catch {
        return null;
      }
    },
  };
}

export function sessionCookieOptions(production) {
  return { httpOnly: true, sameSite: 'lax', secure: production, maxAge: SESSION_DAYS * 864e5, path: '/' };
}

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(db, signer) {
  return (req, _res, next) => {
    const uid = signer.verify(req.cookies?.[SESSION_COOKIE]);
    req.user = uid ? db.get('SELECT * FROM users WHERE id = ?', uid) ?? null : null;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}

/** Minimal fixed-window limiter for credential endpoints. */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.'));
    next();
  };
}
