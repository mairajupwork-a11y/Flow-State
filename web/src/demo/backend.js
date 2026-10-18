/**
 * In-browser Flowstate backend for the shareable demo. Runs the real server
 * route modules against SQLite compiled to WebAssembly (sql.js) and keeps the
 * database in this browser's local storage.
 */
// Pure-JavaScript SQLite build: no WebAssembly, so it runs under strict hosting policies.
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { runMigrations, wrap } from '../../../server/src/db.js';
import { errorHandler } from '../../../server/src/http.js';
import { createHub } from '../../../server/src/realtime.js';
import { createEvents } from '../../../server/src/events.js';
import { createGuide } from '../../../server/src/ai/guide.js';
import { authRoutes } from '../../../server/src/routes/auth.js';
import { workspaceRoutes, inviteRoutes } from '../../../server/src/routes/workspaces.js';
import { projectRoutes } from '../../../server/src/routes/projects.js';
import { issueRoutes } from '../../../server/src/routes/issues.js';
import { todoRoutes, notificationRoutes } from '../../../server/src/routes/personal.js';
import { aiRoutes } from '../../../server/src/routes/ai.js';
import { createSigner, sessionMiddleware, SESSION_COOKIE } from './auth.js';
import { Router } from './shims/express.js';

const DB_KEY = 'fs_demo_db_v1';
const COOKIE_KEY = 'fs_demo_session';
const memory = new Map();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory.get(k) ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory.set(k, v); } },
  del(k) { try { localStorage.removeItem(k); } catch { memory.delete(k); } },
};

const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

async function openBrowserDb() {
  const SQL = await initSqlJs();
  let sqlite;
  try {
    const saved = store.get(DB_KEY);
    sqlite = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
  } catch {
    sqlite = new SQL.Database();
  }
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const all = (sql, params) => {
    const st = sqlite.prepare(sql);
    try {
      st.bind(params.map(norm));
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  };
  // Same surface as node:sqlite's DatabaseSync, which db.js's wrap() expects.
  const raw = {
    prepare: (sql) => ({
      all: (...p) => all(sql, p),
      get: (...p) => all(sql, p)[0],
      run: (...p) => {
        sqlite.run(sql, p.map(norm));
        return { lastInsertRowid: sqlite.exec('SELECT last_insert_rowid()')[0].values[0][0], changes: sqlite.getRowsModified() };
      },
    }),
    exec: (sql) => sqlite.exec(sql),
    close: () => sqlite.close(),
  };
  runMigrations(raw);
  let timer;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => store.set(DB_KEY, toB64(sqlite.export())), 150); };
  return { db: wrap(raw), save };
}

let ready;
function boot() {
  ready ??= openBrowserDb().then(({ db, save }) => {
    const hub = createHub();
    const ctx = { db, events: createEvents(db, hub), hub, guide: createGuide({ db }), signer: createSigner(), production: false };
    const api = Router();
    api.use(sessionMiddleware(db));
    api.get('/health', (_req, res) => res.json({ ok: true, ai: 'builtin', demo: true }));
    api.use('/auth', authRoutes(ctx));
    api.use('/workspaces', workspaceRoutes(ctx));
    api.use('/invites', inviteRoutes(ctx));
    api.use('/projects', projectRoutes(ctx));
    api.use('/issues', issueRoutes(ctx));
    api.use('/todos', todoRoutes(ctx));
    api.use('/notifications', notificationRoutes(ctx));
    api.use('/ai', aiRoutes(ctx));
    return { api, save, onError: errorHandler({ error: (e) => console.error(e) }) };
  });
  return ready;
}

/** fetch()-like entry point used by lib/api.ts in demo builds. */
export async function demoFetch(method, path, body) {
  const { api, save, onError } = await boot();
  const url = new URL(path, 'http://demo.local');
  let status = 200;
  let data = null;
  const res = {
    status(code) { status = code; return res; },
    json(obj) { data = obj; return res; },
    cookie(name, value) { if (name === SESSION_COOKIE) store.set(COOKIE_KEY, value); return res; },
    clearCookie(name) { if (name === SESSION_COOKIE) store.del(COOKIE_KEY); return res; },
    redirect(to) { status = 302; data = { redirect: to }; return res; },
    setHeader() {}, writeHead() {}, write() {}, end() {}, on() {},
  };
  const req = {
    method, body: body ?? {}, query: Object.fromEntries(url.searchParams), params: {}, ip: 'demo',
    cookies: { [SESSION_COOKIE]: store.get(COOKIE_KEY) }, get: () => 'flowstate',
  };
  try {
    const handled = await api.handle(req, res, url.pathname);
    if (!handled) { status = 404; data = { error: 'Unknown API route.' }; }
  } catch (err) {
    onError(err, req, res, () => {});
  }
  if (method !== 'GET') save();
  // Round-trip through JSON so the UI sees exactly what the real API would send.
  return { status, data: data == null ? null : JSON.parse(JSON.stringify(data)) };
}
