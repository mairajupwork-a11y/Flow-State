import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSigner, sessionMiddleware } from './auth.js';
import { errorHandler, HttpError } from './http.js';
import { createHub } from './realtime.js';
import { createEvents } from './events.js';
import { createGuide, createOllama } from './ai/guide.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes, inviteRoutes } from './routes/workspaces.js';
import { projectRoutes } from './routes/projects.js';
import { issueRoutes } from './routes/issues.js';
import { todoRoutes, notificationRoutes } from './routes/personal.js';
import { aiRoutes } from './routes/ai.js';

/**
 * Builds the HTTP app. Kept free of side effects (no listen, no env reads
 * beyond defaults) so tests can spin up isolated instances.
 */
export function createApp({ db, secret, production = false, staticDir = null, ollama = null, google = null, mailer = null, appUrl = null, log = console }) {
  const app = express();
  const hub = createHub();
  const events = createEvents(db, hub);
  const guide = createGuide({ db, llm: ollama?.url ? createOllama(ollama) : null });
  const signer = createSigner(secret);
  const ctx = { db, events, hub, guide, signer, production, google, mailer, appUrl };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // CSRF defence: state-changing API calls must come from our own JS (custom header + SameSite cookie).
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'flowstate') {
      return next(new HttpError(403, 'Request blocked for your security. Please refresh the page.'));
    }
    next();
  });
  app.use('/api', sessionMiddleware(db, signer));

  app.get('/api/health', async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, database: db.dialect ?? 'sqlite', ai: ollama?.url ? 'builtin+local-model' : 'builtin' });
  });
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/workspaces', workspaceRoutes(ctx));
  app.use('/api/invites', inviteRoutes(ctx));
  app.use('/api/projects', projectRoutes(ctx));
  app.use('/api/issues', issueRoutes(ctx));
  app.use('/api/todos', todoRoutes(ctx));
  app.use('/api/notifications', notificationRoutes(ctx));
  app.use('/api/ai', aiRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, path) => { if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use(errorHandler(log));
  app.locals.hub = hub;
  return app;
}
