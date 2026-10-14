/**
 * Demo replacement for server/src/auth.js. Same exports, browser-safe
 * internals. Data never leaves this browser, so a lightweight salted hash
 * is enough to keep passwords out of plain sight in local storage.
 */
import { HttpError } from '../../../server/src/http.js';

export const SESSION_COOKIE = 'fs_session';

function hash(text) {
  let h1 = 0xdeadbeef ^ text.length, h2 = 0x41c6ce57 ^ text.length;
  for (let r = 0; r < 2000; r++) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  }
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function hashPassword(password) {
  const salt = Math.random().toString(36).slice(2, 12);
  return `demo$${salt}$${hash(salt + password)}`;
}
export function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored).split('$');
  return scheme === 'demo' && hash(salt + password) === digest;
}
export function createSigner() {
  return { issue: (uid) => String(uid), verify: (token) => (token && /^\d+$/.test(token) ? Number(token) : null) };
}
export const sessionCookieOptions = () => ({});
export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const uid = req.cookies?.[SESSION_COOKIE];
    req.user = uid ? db.get('SELECT * FROM users WHERE id = ?', Number(uid)) ?? null : null;
    next();
  };
}
export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue.'));
  next();
}
export const rateLimit = () => (_req, _res, next) => next();
