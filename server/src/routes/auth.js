import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword, requireUser, rateLimit, SESSION_COOKIE, sessionCookieOptions } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { me as serializeMe, workspace as serializeWorkspace } from '../serialize.js';
import { USER_COLORS } from '../templates.js';

const email = z.string().trim().toLowerCase().email('enter a valid email address').max(200);
const password = z.string().min(8, 'use at least 8 characters').max(200);

export function authRoutes({ db, signer, production }) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, max: production ? 10 : 1000 });

  const startSession = (res, userId) => res.cookie(SESSION_COOKIE, signer.issue(userId), sessionCookieOptions(production));

  r.post('/signup', limiter, (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1, 'tell us your name').max(80), email, password }), req.body);
    if (db.get('SELECT 1 FROM users WHERE email = ?', body.email)) {
      throw new HttpError(409, 'An account with this email already exists. Try signing in instead.');
    }
    const count = db.get('SELECT COUNT(*) AS n FROM users').n;
    const { lastInsertRowid } = db.run(
      'INSERT INTO users (email, name, password_hash, color) VALUES (?, ?, ?, ?)',
      body.email, body.name, hashPassword(body.password), USER_COLORS[count % USER_COLORS.length],
    );
    startSession(res, Number(lastInsertRowid));
    res.status(201).json(session(db, Number(lastInsertRowid)));
  });

  r.post('/login', limiter, (req, res) => {
    const body = parse(z.object({ email, password: z.string().min(1, 'enter your password') }), req.body);
    const user = db.get('SELECT * FROM users WHERE email = ?', body.email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(401, 'That email and password combination did not match. Please try again.');
    }
    startSession(res, user.id);
    res.json(session(db, user.id));
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json(req.user ? session(db, req.user.id) : { user: null, workspaces: [] });
  });

  r.patch('/me', requireUser, (req, res) => {
    const body = parse(z.object({
      name: z.string().trim().min(1).max(80).optional(),
      jobTitle: z.string().trim().max(80).optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      locale: z.enum(['en-GB', 'en-US', 'en-IN', 'en-SG', 'en-AU']).optional(),
    }), req.body);
    const map = { name: 'name', jobTitle: 'job_title', theme: 'theme', locale: 'locale' };
    for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, body[k], req.user.id);
    res.json(session(db, req.user.id));
  });

  r.post('/password', requireUser, limiter, (req, res) => {
    const body = parse(z.object({ current: z.string(), next: password }), req.body);
    if (!verifyPassword(body.current, req.user.password_hash)) throw new HttpError(400, 'Your current password is not correct.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.next), req.user.id);
    res.json({ ok: true });
  });

  return r;
}

export function session(db, userId) {
  const user = db.get('SELECT * FROM users WHERE id = ?', userId);
  const workspaces = db.all(
    'SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? ORDER BY m.joined_at',
    userId,
  ).map((w) => serializeWorkspace(w, w.role));
  return { user: serializeMe(user), workspaces };
}
