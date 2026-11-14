/**
 * Test server for the acceptance suite: the real app on an in-memory database,
 * serving the production build, with outgoing email captured to out/mail.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openDatabase } from '../../server/src/db.js';
import { createApp } from '../../server/src/app.js';

const out = new URL('./out/', import.meta.url);
mkdirSync(out, { recursive: true });
const mail = [];
const mailer = { host: 'capture', from: 'WorkMars <hi@example.com>', send: async (m) => { mail.push(m); writeFileSync(new URL('mail.json', out), JSON.stringify(mail, null, 1)); } };
const port = Number(process.env.PORT ?? 4710);
createApp({ db: openDatabase(':memory:'), secret: 'uat-secret', mailer, appUrl: `http://127.0.0.1:${port}`, staticDir: new URL('../../web/dist', import.meta.url).pathname, log: { error: console.error, warn() {} } })
  .listen(port, '127.0.0.1', () => console.log(`UAT server on http://127.0.0.1:${port}`));
