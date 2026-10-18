import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { HttpError } from './http.js';

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'fs_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Accounts created with Google have no password; this marker can never match one. */
export const NO_PASSWORD = '!oauth';

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/** Signed tokens: base64url(payload).base64url(hmac). */
export function createSigner(secret) {
  const sign = (data) => createHmac('sha256', secret).update(data).digest('base64url');
  /** Signs any small JSON value with an expiry — used for short-lived OAuth state. */
  const seal = (value, ttlMs) => {
    const payload = Buffer.from(JSON.stringify({ v: value, exp: Date.now() + ttlMs })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const unseal = (token) => {
    if (typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return data.exp > Date.now() ? data.v : null;
    } catch {
      return null;
    }
  };
  return {
    seal,
    unseal,
    /** Session token; `version` is users.session_version, so bumping it signs out every device. */
    issue(userId, version = 0) {
      return seal({ uid: userId, sv: version }, SESSION_DAYS * 864e5);
    },
    /** @returns {{uid:number, sv:number} | null} */
    verify(token) {
      const v = unseal(token);
      return v && Number.isInteger(v.uid) ? { uid: v.uid, sv: v.sv ?? 0 } : null;
    },
  };
}

export function sessionCookieOptions(production) {
  return { httpOnly: true, sameSite: 'lax', secure: production, maxAge: SESSION_DAYS * 864e5, path: '/' };
}

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(db, signer) {
  return async (req, _res, next) => {
    const token = signer.verify(req.cookies?.[SESSION_COOKIE]);
    const user = token ? await db.get('SELECT * FROM users WHERE id = ?', token.uid) : null;
    req.user = user && (user.session_version ?? 0) === token.sv ? user : null;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}

/**
 * Minimal fixed-window limiter. Keyed by client IP by default; pass `key` to
 * limit per account or per user instead (requests without a key pass).
 */
export function rateLimit({ windowMs, max, key: keyOf = (req) => req.ip, message = 'Too many attempts. Please wait a minute and try again.' }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = keyOf(req);
    if (!key) return next();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, message));
    next();
  };
}
