import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
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

const db = openDatabase(process.env.DATABASE_FILE || join(here, '..', 'data', 'flowstate.db'));
const app = createApp({
  db,
  secret,
  production,
  staticDir: join(here, '..', '..', 'web', 'dist'),
  ollama: process.env.OLLAMA_URL ? { url: process.env.OLLAMA_URL, model: process.env.OLLAMA_MODEL || 'llama3.2' } : null,
});

const server = app.listen(port, () => console.log(`Flowstate API listening on http://localhost:${port}`));

function shutdown() {
  app.locals.hub.closeAll();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
