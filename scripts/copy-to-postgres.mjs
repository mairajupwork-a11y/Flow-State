#!/usr/bin/env node
/**
 * Copies an existing Flowstate SQLite database into Postgres (e.g. Supabase).
 *
 *   node scripts/copy-to-postgres.mjs [path/to/flowstate.db]
 *
 * Reads DATABASE_URL from the environment or the repo's .env file. The target
 * must be empty (pass --force to copy into a database that already has users;
 * existing Flowstate rows there are deleted first). IDs are preserved, so
 * links, invites and sessions keep working.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openPostgres } from '../server/src/db-postgres.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(join(root, '.env')); } catch { /* no .env */ }

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.DATABASE_FILE ?? join(root, 'server', 'data', 'flowstate.db'));
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL (in .env or the environment) to your Supabase / Postgres connection string.'); process.exit(1); }
if (!existsSync(file)) { console.error(`No SQLite database at ${file}`); process.exit(1); }

// Parents before children so foreign keys are satisfied.
const TABLES = ['users', 'workspaces', 'memberships', 'invites', 'projects', 'statuses', 'sprints', 'phases', 'issues', 'checklist_items',
  'comments', 'issue_links', 'watchers', 'activity', 'notifications', 'todos', 'entries', 'measurements'];

const lite = new DatabaseSync(file, { readOnly: true });
const version = lite.prepare('PRAGMA user_version').get().user_version;
if (version < 2) { console.error('Start Flowstate once with this SQLite file first so it upgrades to the latest schema, then re-run.'); process.exit(1); }

const db = await openPostgres(url);
const existing = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
if (existing && !force) { console.error(`The target already has ${existing} user(s). Re-run with --force to replace its Flowstate data.`); process.exit(1); }

const liteTables = new Set(lite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
await db.tx(async () => {
  if (existing) await db.exec(`TRUNCATE ${[...TABLES].reverse().join(', ')} RESTART IDENTITY CASCADE`);
  for (const table of TABLES) {
    if (!liteTables.has(table)) continue;
    const pgCols = new Set((await db.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table)).map((c) => c.column_name));
    const rows = lite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) { console.log(`  ${table.padEnd(16)} 0`); continue; }
    const cols = Object.keys(rows[0]).filter((c) => pgCols.has(c));
    // Issues reference each other (epic / parent); set those after every row exists.
    const deferred = table === 'issues' ? ['epic_id', 'parent_id'] : [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = [];
      const tuples = chunk.map((r) => `(${cols.map((c) => { values.push(deferred.includes(c) ? null : r[c]); return '?'; }).join(', ')})`);
      const override = pgCols.has('id') ? ' OVERRIDING SYSTEM VALUE' : '';
      await db.run(`INSERT INTO ${table} (${cols.join(', ')})${override} VALUES ${tuples.join(', ')}`, ...values);
    }
    for (const r of rows) {
      if (deferred.length && (r.epic_id || r.parent_id)) await db.run('UPDATE issues SET epic_id = ?, parent_id = ? WHERE id = ?', r.epic_id, r.parent_id, r.id);
    }
    if (pgCols.has('id')) await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`);
    console.log(`  ${table.padEnd(16)} ${rows.length}`);
  }
});
await db.close();
console.log(`Copied ${file} → ${new URL(url).hostname}. Start Flowstate with DATABASE_URL set to use it.`);
