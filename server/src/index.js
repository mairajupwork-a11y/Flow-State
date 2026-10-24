import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { createMailer, mailHint } from './mail.js';

const here = dirname(fileURLToPath(import.meta.url));
// Settings such as DATABASE_URL can live in a .env file at the repo root.
// On Windows, Notepad often saves it as ".env.txt" with the extension hidden;
// accept that too and say how to fix it.
const root = join(here, '..', '..');
// People also often fill in .env.example itself; use it when it has a DATABASE_URL.
const filled = (f) => /^DATABASE_URL=\S+/m.test(readFileSync(f, 'utf8'));
const envFile = ['.env', '.env.txt', '.env.example'].map((n) => join(root, n))
  .find((f) => existsSync(f) && (!f.endsWith('.example') || filled(f)));
if (envFile) {
  process.loadEnvFile(envFile);
  if (!envFile.endsWith('.env')) console.warn(`Read settings from ${envFile.split(/[\\/]/).pop()} — for clarity, rename it to just ".env".`);
}
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const port = Number(process.env.PORT) || 4000;

let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (production) {
    console.error('SESSION_SECRET must be set in production (any long random string).');
    process.exit(1);
  }
  secret = randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET not set — using a temporary secret. Sessions reset on restart.');
}

// DATABASE_URL (e.g. Supabase's Postgres connection string) selects Postgres;
// otherwise a local SQLite file is used, which needs no setup at all.
/** data/workmars.db, or the file from before the rename so existing work isn't left behind. */
function defaultDatabaseFile(dir) {
  const current = join(dir, 'workmars.db');
  const legacy = join(dir, 'flowstate.db');
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
const db = process.env.DATABASE_URL ? await connectPostgres(process.env.DATABASE_URL) : openDatabase(process.env.DATABASE_FILE || defaultDatabaseFile(join(here, '..', 'data')));

/** Opens Postgres, turning common connection failures into a plain-English fix. */
async function connectPostgres(url) {
  try {
    return await (await import('./db-postgres.js')).openPostgres(url);
  } catch (err) {
    const msg = String(err.message || err);
    const hints = [
      [/password authentication failed/i, 'The password in DATABASE_URL is wrong. Reset it in Supabase (Project Settings → Database) and update .env.'],
      [/Tenant or user not found/i, 'The user name must look like postgres.<project-ref>. Copy the "Session pooler" string from Supabase → Connect again.'],
      [/ENOTFOUND|ENETUNREACH|EAI_AGAIN/i, 'The database host could not be reached. Use the "Session pooler" connection string (not "Direct connection") and check your internet.'],
      [/timeout|ETIMEDOUT/i, 'The connection timed out. Check your internet, and in the Supabase dashboard make sure the project is not paused.'],
      [/Invalid URL|invalid connection/i, 'DATABASE_URL is not a valid connection string. It should start with postgresql:// and contain no spaces or [ ] brackets.'],
    ];
    const hint = hints.find(([re]) => re.test(msg))?.[1] ?? 'Check DATABASE_URL in .env (see SUPABASE.md).';
    console.error(`\nCould not connect to the database: ${msg}\n→ ${hint}\n`);
    process.exit(1);
  }
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) console.log('Google sign-in: on');
console.log(`Database: ${db.dialect === 'postgres' ? `Postgres (${new URL(process.env.DATABASE_URL).hostname})` : 'SQLite'}`);
// Optional SMTP for invitation emails (any provider — see EMAIL.md).
let mailer = null;
try {
  mailer = createMailer();
} catch (err) {
  console.warn(`Email is off: ${err.message}`);
}
if (mailer && production && !process.env.APP_URL) {
  console.warn('Email: set APP_URL to your public address so invitation links point to the right place.');
}
if (mailer) {
  mailer.verify().then((problem) => console.log(problem
    ? `Email: could not log in to ${mailer.host} — ${problem}\n→ ${mailHint(problem)}`
    : `Email: on (${mailer.host}, from ${mailer.from})`));
}

const trustEnv = process.env.TRUST_PROXY?.trim();
const app = createApp({
  ...(trustEnv && { trustProxy: /^\d+$/.test(trustEnv) ? Number(trustEnv) : trustEnv === 'true' ? 1 : false }),
  mailer,
  appUrl: process.env.APP_URL || null,
  db,
  secret,
  production,
  staticDir: join(here, '..', '..', 'web', 'dist'),
  google: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUrl: process.env.GOOGLE_REDIRECT_URL || null }
    : null,
  ollama: process.env.OLLAMA_URL ? { url: process.env.OLLAMA_URL, model: process.env.OLLAMA_MODEL || 'llama3.2' } : null,
});

const server = app.listen(port, () => console.log(`WorkMars API listening on http://localhost:${port}`));

function shutdown() {
  app.locals.hub.closeAll();
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
