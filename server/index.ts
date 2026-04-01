process.env.TZ = 'America/Los_Angeles';


import http from 'http';
import type { Server } from 'http';
import { getErrorMessage, getErrorStatusCode, parseConstraintError } from './utils/errorUtils';
import { logger } from './core/logger';
import { usingPooler } from './core/db';

let isShuttingDown = false;
let isReady = false;
let httpServer: Server | null = null;
let schedulersInitialized = false;
let websocketInitialized = false;
let expressApp: import('express').Express | null = null;
let cachedIndexHtml: string | null = null;
let mainCssPath: string | null = null;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

interface IncomingMessageWithExpressProps extends http.IncomingMessage {
  originalUrl?: string;
  rawBody?: string;
}

process.on('uncaughtException', (error) => {
  logger.error('[Process] Uncaught Exception - shutting down:', { extra: { error: getErrorMessage(error) } });
  process.exit(1);
});

let unhandledRejectionCount = 0;
process.on('unhandledRejection', (reason, _promise) => {
  unhandledRejectionCount++;
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  logger.error('[Process] Unhandled Rejection (non-fatal):', { extra: { errorMessage, totalCount: unhandledRejectionCount } });
});

process.on('beforeExit', (code) => {
  logger.warn(`[Process] beforeExit with code ${code} — event loop drained`);
});

process.on('exit', (code) => {
  console.error(`[Process] exit with code ${code}`);
});

process.on('SIGTERM', () => {
  logger.info('[Process] Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  logger.info('[Process] Received SIGINT signal');
  gracefulShutdown('SIGINT');
});

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  isReady = false;
  logger.info(`[Shutdown] Starting graceful shutdown (${signal})...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('[Shutdown] Timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    if (schedulersInitialized) {
      try {
        const { stopSchedulers } = await import('./schedulers');
        stopSchedulers();
      } catch (err) { logger.warn('[Shutdown] Failed to stop schedulers:', { extra: { error: getErrorMessage(err) } }); }
    }
    if (websocketInitialized) {
      try {
        const { closeWebSocketServer } = await import('./core/websocket');
        await closeWebSocketServer();
      } catch (err) { logger.warn('[Shutdown] Failed to close WebSocket server:', { extra: { error: getErrorMessage(err) } }); }
    }

    if (httpServer) {
      if (typeof httpServer.closeIdleConnections === 'function') {
        httpServer.closeIdleConnections();
      }
      await new Promise<void>((resolve) => {
        httpServer!.close(() => {
          logger.info('[Shutdown] HTTP server closed gracefully');
          resolve();
        });
        setTimeout(() => {
          logger.warn('[Shutdown] HTTP server close timed out after 10s, continuing shutdown');
          resolve();
        }, 10000);
      });
    }

    try {
      const { pool } = await import('./core/db');
      await pool.end();
    } catch (err) { logger.warn('[Shutdown] Failed to close database pool:', { extra: { error: getErrorMessage(err) } }); }

    clearTimeout(shutdownTimeout);
    logger.info('[Shutdown] Complete');
    process.exit(0);
  } catch (error: unknown) {
    logger.error('[Shutdown] Error:', { extra: { error: getErrorMessage(error) } });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProduction ? 3000 : 3001);

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
  <meta http-equiv="refresh" content="5"/>
  <title>Ever Club — Updating</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#293515;color:#f5f0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;min-height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);text-align:center}
    .container{max-width:360px;padding:2rem}
    .logo{width:64px;height:64px;margin:0 auto 1.5rem;opacity:.9;border-radius:50%;object-fit:contain}
    h1{font-size:1.25rem;font-weight:600;margin-bottom:.75rem;letter-spacing:-.01em}
    p{font-size:.9rem;line-height:1.5;opacity:.7;margin-bottom:1.5rem}
    .spinner{width:24px;height:24px;border:2px solid rgba(245,240,232,.2);border-top-color:#f5f0e8;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(prefers-color-scheme:dark){body{background:#1a2310}}
  </style>
</head>
<body>
  <div class="container">
    <img class="logo" src="data:image/webp;base64,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" alt="Ever Club" />
    <h1>Updating the app</h1>
    <p>We just pushed a new update. This page will automatically refresh in a few seconds.</p>
    <div class="spinner"></div>
  </div>
</body>
</html>`;

httpServer = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/_health') {
    if (isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('SHUTTING_DOWN');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (req.url === '/' && req.method === 'GET' && !isReady) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Retry-After': '5' });
    res.end(MAINTENANCE_HTML);
    return;
  }

  if (expressApp) {
    expressApp(req, res);
    return;
  }

  if (req.url?.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: false, reason: 'starting_up' }));
    return;
  }

  res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Retry-After': '5' });
  res.end(MAINTENANCE_HTML);
});

httpServer.keepAliveTimeout = 65000;
httpServer.headersTimeout = 66000;

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`[Startup] HTTP server listening on port ${PORT} - health check ready`);

  initializeApp().catch((err) => {
    logger.error('[Startup] Express initialization failed:', { extra: { error: getErrorMessage(err) } });
    process.exit(1);
  });
});

httpServer.on('error', (err: unknown) => {
  logger.error(`[Startup] Server failed to start:`, { extra: { error: getErrorMessage(err) } });
  process.exit(1);
});

async function initializeApp() {
  const { default: express } = await import('express');
  const { default: cors } = await import('cors');
  const { default: compression } = await import('compression');
  const { default: expressStaticGzip } = await import('express-static-gzip');
  const { default: rateLimit } = await import('express-rate-limit');
  const path = await import('path');

  const { globalRateLimiter } = await import('./middleware/rateLimiting');
  const { getSession, registerAuthRoutes } = await import('./replit_integrations/auth');
  const { setupSupabaseAuthRoutes } = await import('./supabase/auth');
  const { isProduction, pool: _pool } = await import('./core/db');
  const { db } = await import('./db');
  const { sql } = await import('drizzle-orm');
  const { resources, cafeItems } = await import('../shared/schema');
  const { requestIdMiddleware, logRequest } = await import('./core/logger');
  const { registerRoutes } = await import('./loaders/routes');
  const { runStartupTasks, getStartupHealth } = await import('./loaders/startup');
  const { initWebSocketServer, closeWebSocketServer: _closeWebSocketServer } = await import('./core/websocket');
  const { initSchedulers, stopSchedulers: _stopSchedulers } = await import('./schedulers');
  const { processStripeWebhook } = await import('./core/stripe');
  const { securityMiddleware, csrfOriginCheck } = await import('./middleware/security');
  const { registerSitemapRoutes } = await import('./middleware/sitemap');
  const { seoMiddleware } = await import('./middleware/seo');

  const distDir = path.join(process.cwd(), 'dist');

  logger.info(`[Startup] Environment: ${isProduction ? 'production' : 'development'}`);
  logger.info(`[Startup] DATABASE_URL: ${process.env.DATABASE_URL ? 'configured' : 'MISSING'}`);
  logger.info(`[Startup] DATABASE_POOLER_URL: ${usingPooler ? 'configured (session pooler active)' : process.env.DATABASE_POOLER_URL ? 'set but disabled (ENABLE_PGBOUNCER != true)' : 'not set (using direct connection)'}`);

  const app = express();

  app.get('/healthz', (req, res) => {
    res.status(isShuttingDown ? 503 : 200).send(isShuttingDown ? 'SHUTTING_DOWN' : 'OK');
  });
  app.get('/_health', (req, res) => {
    res.status(isShuttingDown ? 503 : 200).send(isShuttingDown ? 'SHUTTING_DOWN' : 'OK');
  });

  app.get('/api/ready', async (req, res) => {
    const startupHealth = getStartupHealth();
    const backgroundTasksComplete = !!startupHealth.completedAt;

    if (isShuttingDown) {
      return res.status(503).json({ ready: false, reason: 'shutting_down' });
    }

    if (!isReady) {
      return res.status(503).json({ ready: false, reason: 'starting_up', startupHealth });
    }

    try {
      await db.execute(sql`SELECT 1`);
      res.status(200).json({
        ready: true,
        backgroundTasksComplete,
        startupHealth,
        uptime: process.uptime()
      });
    } catch (_dbError: unknown) {
      res.status(503).json({
        ready: false,
        reason: 'database_unavailable',
        startupHealth
      });
    }
  });

  app.set('trust proxy', 1);

  type CorsCallback = (err: Error | null, allow?: boolean) => void;
  type CorsOriginFunction = (origin: string | undefined, callback: CorsCallback) => void;

  const getAllowedOrigins = (): string[] | boolean | CorsOriginFunction => {
    const origins = process.env.ALLOWED_ORIGINS;
    if (origins && origins.trim()) {
      const allowed = origins.split(',').map(o => o.trim()).filter(Boolean);
      if (!isProduction) {
        allowed.push('http://localhost:5000', 'http://localhost:3001', 'http://127.0.0.1:5000', 'http://127.0.0.1:3001');
        const replitDomain = process.env.REPLIT_DEV_DOMAIN;
        if (replitDomain) {
          allowed.push(`https://${replitDomain}`, `https://${replitDomain.replace('-00-', '-')}`);
        }
      }
      return allowed;
    }
    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      try {
        const url = new URL(origin);
        const hostname = url.hostname;

        if (!isProduction) {
          if (hostname === 'localhost' || hostname === '127.0.0.1') {
            callback(null, true);
            return;
          }
          if (origin.startsWith('exp://')) {
            callback(null, true);
            return;
          }
        }

        const replitDomain = process.env.REPLIT_DEV_DOMAIN;
        if (replitDomain && (hostname === replitDomain || hostname === replitDomain.replace('-00-', '-'))) {
          callback(null, true);
          return;
        }
        if (hostname.endsWith('.replit.app')) {
          callback(null, true);
          return;
        }
        if (hostname === 'everclub.app' ||
            hostname.endsWith('.everclub.app')) {
          callback(null, true);
          return;
        }
      } catch (err) {
        logger.debug('CORS origin parsing failed', { extra: { error: getErrorMessage(err) } });
      }
      callback(new Error('Not allowed by CORS'));
    };
  };

  const corsOptions = {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };

  app.disable('x-powered-by');
  app.use(securityMiddleware);


  app.use((req, res, next) => {
    if (isShuttingDown) {
      res.setHeader('Connection', 'close');
      if (req.path.startsWith('/api/')) {
        return res.status(503).json({ error: 'Server is shutting down', reason: 'shutting_down' });
      }
    }
    next();
  });

  app.use(requestIdMiddleware);
  app.use(logRequest);
  app.use(cors(corsOptions));
  app.use(csrfOriginCheck);
  app.use(compression());

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];

      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          logger.error('[Stripe Webhook] req.body is not a Buffer - express.json() may have run first');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        await processStripeWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: unknown) {
        const errorMsg = getErrorMessage(error);
        logger.error('[Stripe Webhook] Error:', { extra: { errorMsg } });

        if (errorMsg.includes('signature') || errorMsg.includes('payload') || (error && typeof error === 'object' && 'type' in error && (error as { type: unknown }).type === 'StripeSignatureVerificationError')) {
          return res.status(400).json({ error: 'Invalid request' });
        }

        res.status(500).json({ error: 'Server processing error' });
      }
    }
  );

  const LARGE_BODY_ROUTES = new Set(['/api/admin/scan-id', '/api/admin/save-id-image']);
  app.use((req, res, next) => {
    if (LARGE_BODY_ROUTES.has(req.path)) {
      return next();
    }
    express.json({
      limit: '1mb',
      verify: (req: http.IncomingMessage, _res: http.ServerResponse, buf: Buffer) => {
        const expressReq = req as IncomingMessageWithExpressProps;
        if (expressReq.originalUrl?.includes('/webhooks') || req.url?.includes('/webhooks')) {
          expressReq.rawBody = buf.toString('utf8');
        }
      }
    })(req, res, next);
  });
  app.use(express.urlencoded({ limit: '1mb' }));
  app.use(getSession());
  app.use(globalRateLimiter);

  app.use((req, res, next) => {
    if (req.path === '/healthz' || req.path === '/_health' || req.path === '/api/stripe/webhook') {
      return next();
    }
    const timeout = req.path.startsWith('/api/admin/') ? 120000 : 60000;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    res.json = function guardedJson(body?: unknown) {
      if (res.locals.timedOut) {
        return res;
      }
      return originalJson(body);
    } as typeof res.json;
    res.send = function guardedSend(body?: unknown) {
      if (res.locals.timedOut) {
        return res;
      }
      return originalSend(body);
    } as typeof res.send;

    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        logger.warn(`[Timeout] Request timed out after ${timeout}ms`, { extra: { method: req.method, path: req.path } });
        res.locals.timedOut = true;
        res.status(504);
        originalJson({ error: 'Request timed out' });
      }
    });
    next();
  });

  app.get('/api/health', async (req, res) => {
    if (!isReady) {
      return res.status(503).json({
        status: 'starting',
        database: 'initializing',
        uptime: process.uptime()
      });
    }

    try {
      const dbResult = await db.execute(sql`SELECT NOW() as time`);
      const isAuthenticated = req.session?.user?.isStaff === true;
      const startupHealth = getStartupHealth();

      const baseResponse = {
        status: 'ok',
        database: 'connected',
        timestamp: dbResult.rows[0]?.time,
        uptime: process.uptime()
      };

      if (isAuthenticated) {
        const { getAlertCounts, getRecentAlerts } = await import('./core/monitoring');
        const alertCounts = getAlertCounts();
        const recentCritical = getRecentAlerts({ severity: 'critical', limit: 5 });

        const resourceCountResult = await db.select({ count: sql<number>`count(*)` }).from(resources);
        const resourceTypes = await db.execute(sql`SELECT type, COUNT(*) as count FROM resources GROUP BY type`);

        res.json({
          ...baseResponse,
          environment: isProduction ? 'production' : 'development',
          resourceCount: Number(resourceCountResult[0]?.count ?? 0),
          resourcesByType: resourceTypes.rows,
          databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing',
          databasePooler: usingPooler ? 'session_pooler' : 'direct',
          startupHealth,
          alerts: {
            counts: alertCounts,
            recentCritical: recentCritical.map(a => ({
              message: a.message,
              category: a.category,
              timestamp: a.timestamp
            }))
          }
        });
      } else {
        res.json(baseResponse);
      }
    } catch (error: unknown) {
      const isAuthenticated = req.session?.user?.isStaff === true;
      res.status(500).json({
        status: 'error',
        database: 'disconnected',
        ...(isAuthenticated && { error: getErrorMessage(error) })
      });
    }
  });

  registerSitemapRoutes(app, isProduction);

  if (isProduction) {
    app.use((req, res, next) => {
      if (/^\/index\.html(\.br|\.gz)?$/i.test(req.path)) {
        req.url = '/';
      }
      next();
    });

    const staticGzipHandler = expressStaticGzip(distDir, {
      enableBrotli: true,
      orderPreference: ['br', 'gz'],
      serveStatic: {
        maxAge: '1y',
        immutable: true,
        etag: true,
        index: false,
        setHeaders: (res, filePath) => {
          const fileName = filePath.replace(/\.(br|gz)$/, '');
          if (fileName.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (fileName.endsWith('sw.js') || fileName.endsWith('manifest.webmanifest')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        }
      }
    });
    app.use((req, res, next) => {
      if (/\.html?(\.br|\.gz)?$/i.test(req.path)) {
        return next();
      }
      staticGzipHandler(req, res, next);
    });

    app.use('/assets/', async (req, res, next) => {
      if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.js.br') || req.path.endsWith('.css.br')) {
        const fs = await import('fs');
        const filePath = path.join(distDir, 'assets', req.path);
        if (!fs.existsSync(filePath)) {
          logger.info(`[Stale Asset] 404 for /assets${req.path} - returning 404 (error boundary will handle reload)`);
          res.status(404).setHeader('Cache-Control', 'no-store').send('');
          return;
        }
      }
      next();
    });
  } else {
    app.get('/', (req, res) => {
      const devDomain = process.env.REPLIT_DEV_DOMAIN;
      if (devDomain) {
        res.redirect(`https://${devDomain}`);
      } else {
        res.send('API Server running. Frontend is at port 5000.');
      }
    });
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts, please try again later' }
  });
  app.use('/api/auth/login', loginLimiter);

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    keyGenerator: (req) => {
      const userId = req.session?.user?.id;
      return userId ? `api:${userId}` : `api:${req.ip || 'unknown'}`;
    },
    validate: false,
  });
  app.use('/api/', apiLimiter);

  const clientErrorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    message: { error: 'Too many error reports, please try again later' }
  });

  app.post('/api/client-error', clientErrorLimiter, (req, res) => {
    const { page, error, stack, componentStack } = req.body || {};
    logger.error(`[CLIENT ERROR] Page: ${page}, Error: ${error}`);
    if (stack) logger.error(`[CLIENT ERROR] Stack: ${stack}`);
    if (componentStack) logger.error(`[CLIENT ERROR] Component: ${componentStack}`);
    res.json({ ok: true });
  });

  app.post('/api/web-vitals', (req, res) => {
    const { name, value, rating, delta, id, navigationType } = req.body || {};
    if (name && typeof value === 'number') {
      logger.info(`[Web Vitals] ${name}: ${name === 'CLS' ? value.toFixed(4) : Math.round(value) + 'ms'} (${rating})`, {
        metric: name,
        value,
        rating,
        delta,
        id,
        navigationType,
      });
    }
    res.status(204).end();
  });

  try {
    setupSupabaseAuthRoutes(app);
    registerAuthRoutes(app);
  } catch (err: unknown) {
    logger.error('[Startup] Auth routes setup failed:', { extra: { error: getErrorMessage(err) } });
  }

  registerRoutes(app);

  if (isProduction) {
    const siteOrigin = 'https://everclub.app';
    app.use(seoMiddleware({
      getCachedIndexHtml: () => cachedIndexHtml,
      getMainCssPath: () => mainCssPath,
      siteOrigin,
      distDir,
    }));
  }


  app.use((err: Error, req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    const appErr = err as unknown as { statusCode?: number; error?: string; details?: Record<string, unknown> };
    if (err.constructor?.name === 'AppError' && typeof appErr.statusCode === 'number' && typeof appErr.error === 'string') {
      logger.warn('[Express] AppError', {
        extra: { error: getErrorMessage(err), method: req.method, url: req.originalUrl, status: appErr.statusCode }
      });
      if (!res.headersSent) {
        const body: Record<string, unknown> = { error: appErr.error };
        if (appErr.details) {
          for (const [key, value] of Object.entries(appErr.details)) {
            body[key] = value;
          }
        }
        res.status(appErr.statusCode).json(body);
      }
      return;
    }

    const parsed = parseConstraintError(err);
    if (parsed.isConstraintError) {
      logger.warn('[Express] Database constraint violation', {
        extra: { error: getErrorMessage(err), method: req.method, url: req.originalUrl, table: parsed.table, constraint: parsed.constraintName }
      });
      if (!res.headersSent) {
        res.status(409).json({ error: parsed.message, table: parsed.table, constraint: parsed.constraintName });
      }
      return;
    }

    const status = getErrorStatusCode(err) || 500;
    logger.error('[Express] Unhandled route error', {
      extra: { error: getErrorMessage(err), method: req.method, url: req.originalUrl, status }
    });
    if (!res.headersSent) {
      res.status(status).json({ error: status >= 500 ? 'Internal server error' : getErrorMessage(err) });
    }
  });

  expressApp = app;

  if (isProduction) {
    try {
      const indexPath = path.join(distDir, 'index.html');
      const fs = await import('fs');
      cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
      const cssMatch = cachedIndexHtml.match(/href="(\/assets\/[^"]+\.css)"/);
      if (cssMatch) {
        mainCssPath = cssMatch[1];
      }
      logger.info('[Startup] Cached index.html for fast serving', { mainCssPath });
    } catch (err: unknown) {
      logger.error('[Startup] Failed to cache index.html:', { extra: { error: getErrorMessage(err) } });
    }
  }

  try {
    await initWebSocketServer(httpServer!);
    websocketInitialized = true;
  } catch (err: unknown) {
    logger.error('[Startup] WebSocket initialization failed:', { extra: { error: getErrorMessage(err) } });
  }

  isReady = true;
  logger.info('[Startup] Express app initialized — app is ready to serve requests');

  setImmediate(() => {
    logger.info('[Startup] Starting background initialization tasks...');

    const handleStartupResult = (attempt: number) => {
      const startupHealth = getStartupHealth();
      if (startupHealth.criticalFailures.length > 0) {
        if (attempt < 3) {
          logger.warn(`[Startup] Critical failures on attempt ${attempt} — retrying in 30s...`, { extra: { criticalFailures: startupHealth.criticalFailures } });
          setTimeout(() => {
            runStartupTasks().then(() => handleStartupResult(attempt + 1)).catch((err) => {
              logger.error('[Startup] Startup retry failed unexpectedly:', { extra: { error: getErrorMessage(err) } });
            });
          }, 30000);
        } else {
          logger.error('[Startup] Critical failures persist after retries:', { extra: { criticalFailures: startupHealth.criticalFailures } });
        }
      } else {
        logger.info('[Startup] All startup tasks complete');
        if (startupHealth.warnings.length > 0) {
          logger.warn('[Startup] Startup completed with warnings:', { extra: { warnings: startupHealth.warnings } });
        }
      }
    };

    runStartupTasks()
      .then(() => handleStartupResult(1))
      .then(() => {
        try {
          initSchedulers();
          schedulersInitialized = true;
          logger.info('[Startup] Schedulers initialized after startup tasks completed');
        } catch (err: unknown) {
          logger.error('[Startup] Scheduler initialization failed:', { extra: { error: getErrorMessage(err) } });
        }
      })
      .catch((err) => {
        logger.error('[Startup] Startup tasks failed unexpectedly:', { extra: { error: getErrorMessage(err) } });
        try {
          initSchedulers();
          schedulersInitialized = true;
          logger.warn('[Startup] Schedulers initialized despite startup task failure');
        } catch (schedErr: unknown) {
          logger.error('[Startup] Scheduler initialization also failed:', { extra: { error: getErrorMessage(schedErr) } });
        }
      });

    if (!isProduction) {
      setTimeout(async () => {
        try {
          await autoSeedResources(db, sql, resources, isProduction);
        } catch (err: unknown) {
          logger.error('[Startup] Auto-seed resources failed:', { extra: { error: getErrorMessage(err) } });
        }
      }, 30000);
    }

    logger.info('[Startup] Background initialization launched');
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic Drizzle types not worth replicating for one-time seed function
async function autoSeedResources(db: { select: (...args: any[]) => any; insert: (...args: any[]) => any }, sql: any, resourcesTable: any, isProduction: boolean) {
  try {
    const result = await db.select({ count: sql<number>`count(*)` }).from(resourcesTable);
    const count = Number(result[0]?.count ?? 0);

    if (count === 0) {
      if (!isProduction) logger.info('Auto-seeding resources...');
      const seedResources = [
        { name: 'Simulator Bay 1', type: 'simulator', description: 'TrackMan Simulator Bay 1', capacity: 6 },
        { name: 'Simulator Bay 2', type: 'simulator', description: 'TrackMan Simulator Bay 2', capacity: 6 },
        { name: 'Simulator Bay 3', type: 'simulator', description: 'TrackMan Simulator Bay 3', capacity: 6 },
        { name: 'Simulator Bay 4', type: 'simulator', description: 'TrackMan Simulator Bay 4', capacity: 6 },
        { name: 'Conference Room', type: 'conference_room', description: 'Main conference room with AV setup', capacity: 12 },
      ];

      for (const resource of seedResources) {
        await db.insert(resourcesTable).values(resource).onConflictDoNothing();
      }
      if (!isProduction) logger.info(`Auto-seeded ${seedResources.length} resources`);
    }
  } catch (_error: unknown) {
    if (!isProduction) logger.info('Resources table may not exist yet, skipping auto-seed');
  }
}

