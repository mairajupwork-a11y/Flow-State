import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { recolorSql } from './schema/recolor.js';

/**
 * PostgreSQL adapter (Supabase or any Postgres) with the same surface as
 * db.js's SQLite wrapper: get / all / run / tx / exec. Route code is written
 * once in a portable SQL subset; the few SQLite spellings it uses are
 * translated here:
 *   ?                    → $1, $2, …
 *   datetime('now')      → UTC timestamp text in the same format
 *   INSERT OR IGNORE     → INSERT … ON CONFLICT DO NOTHING
 *   LIKE                 → ILIKE (SQLite's LIKE is case-insensitive)
 *   run() on INSERT      → RETURNING id, exposed as lastInsertRowid
 */

// COUNT / SUM return int8 and AVG numeric; the app expects plain numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const NOW = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";
/** Tables whose primary key is not an `id` column. */
const NO_ID = new Set(['memberships', 'watchers', 'invites']);
const cache = new Map();

export function translate(original) {
  const hit = cache.get(original);
  if (hit) return hit;
  // Rewrite only code outside string literals and comments.
  const code = (part) => part.replaceAll('\0now\0', NOW).replace(/\bLIKE\b/g, 'ILIKE');
  const sql = original.replaceAll("datetime('now')", '\0now\0'); // its quotes aren't a string literal
  let out = '';
  let n = 0;
  let chunk = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += code(chunk) + sql.slice(i, stop);
      chunk = '';
      i = stop - 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += code(chunk) + sql.slice(i, stop);
      chunk = '';
      i = stop - 1;
    } else if (ch === '?') {
      chunk += `$${++n}`;
    } else chunk += ch;
  }
  out += code(chunk);
  let ignore = false;
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, () => { ignore = true; return 'INSERT INTO'; });
  const insert = out.match(/^\s*INSERT\s+INTO\s+([a-z_]+)/i);
  out = out.trimEnd().replace(/;$/, '');
  if (ignore && !/\bON\s+CONFLICT\b/i.test(out)) out += ' ON CONFLICT DO NOTHING';
  if (insert && !NO_ID.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  const result = { text: out, isInsert: !!insert };
  cache.set(original, result);
  return result;
}

/** Supabase requires TLS; local servers usually don't speak it. */
function sslFor(url) {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  if (mode === 'disable') return false;
  if (['localhost', '127.0.0.1', '::1'].includes(u.hostname) && !mode) return false;
  // Supabase's pooler certificates are not in Node's default trust store, so
  // verify against a CA bundle when one is provided, otherwise encrypt only.
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export async function openPostgres(url, { max = Number(process.env.DATABASE_POOL_SIZE) || 10, migrate = true } = {}) {
  const u = new URL(url);
  u.searchParams.delete('sslmode'); // handled by sslFor; pg would otherwise override it
  const pool = new pg.Pool({ connectionString: u.toString(), ssl: sslFor(url), max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  const txClient = new AsyncLocalStorage();

  const query = async (sql, params) => {
    const { text } = translate(sql);
    const client = txClient.getStore() ?? pool;
    return client.query(text, params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p)));
  };

  const db = {
    dialect: 'postgres',
    pool,
    get: async (sql, ...params) => (await query(sql, params)).rows[0],
    all: async (sql, ...params) => (await query(sql, params)).rows,
    async run(sql, ...params) {
      const res = await query(sql, params);
      return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
    },
    exec: async (sql) => { await (txClient.getStore() ?? pool).query(sql); },
    /** Runs fn on one connection inside BEGIN/COMMIT; nested calls join the outer transaction. */
    async tx(fn) {
      if (txClient.getStore()) return fn();
      const client = await pool.connect();
      let broken;
      client.afterCommit = [];
      try {
        await client.query('BEGIN');
        const result = await txClient.run(client, fn);
        await client.query('COMMIT');
        for (const f of client.afterCommit) f();
        return result;
      } catch (err) {
        // A connection that can't even roll back is broken: destroy it rather than reuse it.
        broken = await client.query('ROLLBACK').then(() => undefined, (e) => e);
        throw err;
      } finally {
        client.release(broken);
      }
    },
    /** Runs fn once the current transaction commits (dropped on rollback), or now outside one. */
    afterCommit(fn) {
      const client = txClient.getStore();
      if (client) client.afterCommit.push(fn);
      else fn();
    },
    close: () => pool.end(),
  };

  if (migrate) await migratePostgres(pool);
  return db;
}

/** Applies schema/postgres.sql once per schema version, under an advisory lock so parallel boots don't race. */
export async function migratePostgres(pool) {
  // Version 1 is the full schema file; later versions are small upgrades for
  // databases created before them (all safe to re-run).
  const UPGRADES = [
    null,
    "ALTER TABLE invites ADD COLUMN IF NOT EXISTS designation TEXT NOT NULL DEFAULT ''",
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER NOT NULL DEFAULT 0;
     CREATE INDEX IF NOT EXISTS issues_status_rank ON issues (status_id, rank);
     CREATE INDEX IF NOT EXISTS notifications_issue ON notifications (issue_id);
     CREATE INDEX IF NOT EXISTS todos_issue ON todos (issue_id);
     CREATE INDEX IF NOT EXISTS issue_links_target ON issue_links (target_id);
     CREATE INDEX IF NOT EXISTS invites_workspace ON invites (workspace_id);
     CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);
     CREATE INDEX IF NOT EXISTS users_email_exact ON users (email)`,
    recolorSql(),
  ];
  const VERSION = UPGRADES.length;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    // Databases created before the rename keep their version history under the old table name.
    await client.query(`DO $$ BEGIN
      IF to_regclass('public.flowstate_meta') IS NOT NULL AND to_regclass('public.workmars_meta') IS NULL THEN
        ALTER TABLE flowstate_meta RENAME TO workmars_meta;
      END IF;
    END $$`);
    await client.query('CREATE TABLE IF NOT EXISTS workmars_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await client.query('ALTER TABLE workmars_meta ENABLE ROW LEVEL SECURITY');
    const row = (await client.query("SELECT value FROM workmars_meta WHERE key = 'schema_version'")).rows[0];
    if (Number(row?.value ?? 0) < VERSION) {
      const sql = readFileSync(new URL('./schema/postgres.sql', import.meta.url), 'utf8');
      await client.query('BEGIN');
      try {
        const current = Number(row?.value ?? 0);
        if (current < 1) await client.query(sql);
        for (let v = Math.max(current, 1); v < VERSION; v++) await client.query(UPGRADES[v]);
        await client.query("INSERT INTO workmars_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(VERSION)]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}
