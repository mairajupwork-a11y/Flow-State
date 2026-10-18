import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

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

export function translate(sql) {
  const hit = cache.get(sql);
  if (hit) return hit;
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else out += ch;
  }
  out = out.replace(/datetime\('now'\)/g, NOW).replace(/\bLIKE\b/g, 'ILIKE');
  let ignore = false;
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, () => { ignore = true; return 'INSERT INTO'; });
  const insert = out.match(/^\s*INSERT\s+INTO\s+([a-z_]+)/i);
  out = out.trimEnd().replace(/;$/, '');
  if (ignore) out += ' ON CONFLICT DO NOTHING';
  if (insert && !NO_ID.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  const result = { text: out, isInsert: !!insert };
  cache.set(sql, result);
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
      try {
        await client.query('BEGIN');
        const result = await txClient.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
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
  ];
  const VERSION = UPGRADES.length;
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS flowstate_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    await client.query('ALTER TABLE flowstate_meta ENABLE ROW LEVEL SECURITY');
    const row = (await client.query("SELECT value FROM flowstate_meta WHERE key = 'schema_version'")).rows[0];
    if (Number(row?.value ?? 0) < VERSION) {
      const sql = readFileSync(new URL('./schema/postgres.sql', import.meta.url), 'utf8');
      await client.query('BEGIN');
      try {
        const current = Number(row?.value ?? 0);
        if (current < 1) await client.query(sql);
        for (let v = Math.max(current, 1); v < VERSION; v++) await client.query(UPGRADES[v]);
        await client.query("INSERT INTO flowstate_meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(VERSION)]);
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
