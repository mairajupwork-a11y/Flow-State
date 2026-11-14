import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSigner, sessionMiddleware } from './auth.js';
import { errorHandler, HttpError } from './http.js';
import { createHub } from './realtime.js';
import { createEvents } from './events.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes, inviteRoutes } from './routes/workspaces.js';
import { projectRoutes } from './routes/projects.js';
import { issueRoutes } from './routes/issues.js';
import { todoRoutes, notificationRoutes } from './routes/personal.js';
import { recoveryRoutes } from './routes/recovery.js';
import { fileRoutes } from './routes/files.js';
import { extensionRoutes } from './routes/extensions.js';
import { notifySettingsRoutes } from './routes/notify-settings.js';
import { timeRoutes } from './routes/time.js';
import { integrationRoutes, hookReceiver } from './routes/integrations.js';
import { createChatRelay } from './services/integrations.js';
import { teamToolRoutes } from './routes/team-tools.js';
import { createDelivery } from './delivery.js';

/** Value of the X-Requested-With header our web app sends ('flowstate' from tabs opened before the rename). */
const CLIENT_HEADERS = ['workmars', 'flowstate'];

/**
 * Builds the HTTP app. Kept free of side effects (no listen, no env reads
 * beyond defaults) so tests can spin up isolated instances.
 */
export function createApp({ db, secret, production = false, staticDir = null, google = null, mailer = null, push = null, appUrl = null, trustProxy = production ? 1 : false, log = console, fetcher = globalThis.fetch }) {
  const app = express();
  const hub = createHub();
  const events = createEvents(db, hub, createDelivery({ db, mailer, push, appUrl, log }), createChatRelay({ db, fetcher, appUrl, log }));
  const signer = createSigner(secret);
  const ctx = { db, events, hub, signer, production, google, mailer, push, appUrl, log, fetcher };

  app.disable('x-powered-by');
  // Hops of reverse proxy in front of us (Render, nginx…). Off when Node faces the
  // internet directly, so clients can't fake their IP via X-Forwarded-For.
  app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  // File uploads carry the raw file as the body (whatever its type, even .json); every other route takes JSON.
  const json = express.json({ limit: '256kb' });
  // GitHub / GitLab webhooks: public, signed, read as raw bytes so the signature can be checked.
  app.post('/api/hooks/:id', express.raw({ type: () => true, limit: '5mb' }), (req, res, next) => hookReceiver(ctx)(req, res).catch(next));
  app.use((req, res, next) => (/^\/api\/issues\/[^/]+\/attachments$/.test(req.path) ? next() : json(req, res, next)));
  app.use(cookieParser());

  // CSRF defence: state-changing API calls must come from our own JS (custom header + SameSite cookie).
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !CLIENT_HEADERS.includes(req.get('X-Requested-With'))) {
      return next(new HttpError(403, 'Request blocked for your security. Please refresh the page.'));
    }
    next();
  });
  app.use('/api', sessionMiddleware(db, signer));

  app.get('/api/health', async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, database: db.dialect ?? 'sqlite' });
  });
  app.use('/api/auth', recoveryRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/workspaces', workspaceRoutes(ctx));
  app.use('/api/invites', inviteRoutes(ctx));
  app.use('/api/projects', projectRoutes(ctx));
  app.use('/api/issues', issueRoutes(ctx));
  app.use('/api/todos', todoRoutes(ctx));
  app.use('/api/notifications', notificationRoutes(ctx));
  app.use('/api', fileRoutes(ctx));
  app.use('/api', extensionRoutes(ctx));
  app.use('/api', notifySettingsRoutes(ctx));
  app.use('/api', timeRoutes(ctx));
  app.use('/api', integrationRoutes(ctx));
  app.use('/api', teamToolRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, path) => { if (/\.html$|[\\/](sw\.js|manifest\.webmanifest)$/.test(path)) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use(errorHandler(log));
  app.locals.hub = hub;
  app.locals.events = events;
  return app;
}
