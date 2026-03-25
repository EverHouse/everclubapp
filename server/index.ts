process.env.TZ = 'America/Los_Angeles';


import http from 'http';
import type { Server } from 'http';
import { randomBytes } from 'crypto';
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
  logger.error('[Process] Uncaught Exception - shutting down:', { error: error as Error });
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
      } catch (err) { logger.warn('[Shutdown] Failed to stop schedulers:', { error: getErrorMessage(err) }); }
    }
    if (websocketInitialized) {
      try {
        const { closeWebSocketServer } = await import('./core/websocket');
        closeWebSocketServer();
      } catch (err) { logger.warn('[Shutdown] Failed to close WebSocket server:', { error: getErrorMessage(err) }); }
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
    } catch (err) { logger.warn('[Shutdown] Failed to close database pool:', { error: getErrorMessage(err) }); }

    clearTimeout(shutdownTimeout);
    logger.info('[Shutdown] Complete');
    process.exit(0);
  } catch (error: unknown) {
    logger.error('[Shutdown] Error:', { error: error as Error });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || (isProduction ? 5001 : 3001);

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
    logger.error('[Startup] Express initialization failed:', { error: err as Error });
    process.exit(1);
  });
});

httpServer.on('error', (err: unknown) => {
  logger.error(`[Startup] Server failed to start:`, { error: err as Error });
  process.exit(1);
});

async function initializeApp() {
  const { default: express } = await import('express');
  const { default: cors } = await import('cors');
  // @ts-expect-error no declaration file for compression
  const { default: compression } = await import('compression');
  const { default: expressStaticGzip } = await import('express-static-gzip');
  const { default: rateLimit } = await import('express-rate-limit');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
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

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

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
    if (!isProduction) {
      return true;
    }
    const origins = process.env.ALLOWED_ORIGINS;
    if (origins && origins.trim()) {
      return origins.split(',').map(o => o.trim()).filter(Boolean);
    }
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      return [`https://${replitDomain}`, `https://${replitDomain.replace('-00-', '-')}`];
    }
    return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!isProduction && origin.startsWith('exp://')) {
        callback(null, true);
        return;
      }

      try {
        const url = new URL(origin);
        const hostname = url.hostname;
        if (hostname.endsWith('.replit.app') || hostname.endsWith('.replit.dev') || hostname.endsWith('.repl.co')) {
          callback(null, true);
          return;
        }
        if (hostname === 'everclub.app' ||
            hostname.endsWith('.everclub.app')) {
          callback(null, true);
          return;
        }
      } catch (err) {
        logger.debug('CORS origin parsing failed', { error: getErrorMessage(err) });
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
  app.use((req, res, next) => {
    const nonce = randomBytes(16).toString('base64');
    res.locals.cspNonce = nonce;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    // ─── CSP External Resource Audit ───────────────────────────────────────
    // Stripe:        js.stripe.com (script, frame), hooks.stripe.com (frame),
    //                api.stripe.com (connect), *.stripe.com (img — badge/logos)
    // Google:        accounts.google.com (script, style, connect, frame, img),
    //                fonts.googleapis.com (style), fonts.gstatic.com (font),
    //                *.gstatic.com (img — sign-in assets),
    //                *.googleusercontent.com (img — user avatars),
    //                www.google.com (frame — reCAPTCHA)
    // Apple:         appleid.cdn-apple.com (script, img — Sign-In SDK),
    //                cdn.apple-mapkit.com (script, style — MapKit JS),
    //                appleid.apple.com (connect, frame — Sign-In flow),
    //                *.apple-mapkit.com (connect — MapKit tile API)
    // HubSpot:       *.hs-scripts.com (script — tracking loader),
    //                *.hsforms.net (script, style, img — forms),
    //                *.hscollectedforms.net (script, connect — collected forms),
    //                *.hs-banner.com (script — cookie banner),
    //                *.hs-analytics.net (script, connect, img — analytics),
    //                *.hsadspixel.net (script, img — ads pixel),
    //                *.hubspot.com (script, connect, img — general/tracking),
    //                *.usemessages.com (script — live chat),
    //                app.hubspot.com (frame — embedded tools),
    //                *.hubapi.com (connect — HubSpot API calls)
    // Facebook:      connect.facebook.net (script, connect — pixel SDK),
    //                www.facebook.com (connect, img — tracking pixel)
    // Matterport:    my.matterport.com (frame — virtual tour embed)
    // QR codes:      api.qrserver.com (img — member card QR generation)
    // Unsplash:      images.unsplash.com (img — fallback event images)
    // Object storage: served via /objects/ on same origin ('self')
    // To debug CSP: check browser DevTools console for "Refused to load" errors
    // ────────────────────────────────────────────────────────────────────────

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://accounts.google.com https://appleid.cdn-apple.com https://cdn.apple-mapkit.com https://*.hs-scripts.com https://*.hsforms.net https://*.hscollectedforms.net https://*.hs-banner.com https://*.hs-analytics.net https://*.hsadspixel.net https://*.hubspot.com https://*.usemessages.com https://connect.facebook.net`,
      `style-src 'self' 'unsafe-inline' 'nonce-${nonce}' https://fonts.googleapis.com https://accounts.google.com https://cdn.apple-mapkit.com https://*.hsforms.net`,
      "img-src 'self' data: blob: https://*.stripe.com https://accounts.google.com https://*.gstatic.com https://*.googleusercontent.com https://appleid.cdn-apple.com https://*.hubspot.com https://*.hsforms.net https://*.hs-analytics.net https://*.hsadspixel.net https://www.facebook.com https://images.unsplash.com https://api.qrserver.com https://my.matterport.com",
      "connect-src 'self' https://api.stripe.com https://accounts.google.com https://appleid.apple.com https://*.apple-mapkit.com https://*.hubspot.com https://*.hubapi.com https://*.hscollectedforms.net https://*.hsforms.net https://*.hs-analytics.net https://www.facebook.com https://connect.facebook.net wss: ws:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://accounts.google.com https://appleid.apple.com https://www.google.com https://my.matterport.com https://app.hubspot.com",
      "frame-ancestors 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; '));
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    next();
  });

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

  const siteOrigin = isProduction
    ? 'https://everclub.app'
    : `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send([
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /dashboard',
      'Disallow: /login',
      'Disallow: /checkout',
      'Disallow: /profile',
      'Disallow: /book',
      'Disallow: /events',
      'Disallow: /wellness',
      'Disallow: /updates',
      'Disallow: /history',
      'Disallow: /auth/',
      'Disallow: /reset-password',
      'Disallow: /join',
      'Disallow: /nfc-checkin',
      'Disallow: /dev-preview/',
      'Disallow: /_health',
      'Disallow: /healthz',
      '',
      'Allow: /api/faqs',
      'Allow: /api/events',
      'Allow: /api/wellness-classes',
      'Allow: /api/membership-tiers',
      'Allow: /api/tier-features',
      'Allow: /api/cafe-menu',
      'Allow: /api/settings/public',
      'Allow: /api/gallery',
      'Allow: /api/tours/availability',
      'Allow: /api/announcements',
      'Allow: /api/bays',
      'Allow: /api/closures',
      'Disallow: /api/',
      '',
      'Allow: /',
      '',
      `Sitemap: ${siteOrigin}/sitemap.xml`,
    ].join('\n') + '\n');
  });

  app.get('/sitemap.xml', (req, res) => {
    const publicPages = [
      { path: '/', priority: '1.0', changefreq: 'weekly' },
      { path: '/membership', priority: '0.9', changefreq: 'monthly' },
      { path: '/membership/apply', priority: '0.8', changefreq: 'monthly' },
      { path: '/about', priority: '0.8', changefreq: 'monthly' },
      { path: '/contact', priority: '0.8', changefreq: 'monthly' },
      { path: '/gallery', priority: '0.7', changefreq: 'weekly' },
      { path: '/whats-on', priority: '0.7', changefreq: 'weekly' },
      { path: '/private-hire', priority: '0.7', changefreq: 'monthly' },
      { path: '/private-hire/inquire', priority: '0.6', changefreq: 'monthly' },
      { path: '/menu', priority: '0.6', changefreq: 'monthly' },
      { path: '/tour', priority: '0.8', changefreq: 'monthly' },
      { path: '/day-pass', priority: '0.7', changefreq: 'monthly' },
      { path: '/membership/compare', priority: '0.7', changefreq: 'monthly' },
      { path: '/faq', priority: '0.5', changefreq: 'monthly' },
      { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
      { path: '/terms', priority: '0.3', changefreq: 'yearly' },
    ];

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const urls = publicPages.map(p =>
      `  <url>\n    <loc>${siteOrigin}${p.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join('\n');

    res.type('application/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
  });

  app.get([
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemaps.xml',
    '/sitemap1.xml',
    '/post-sitemap.xml',
    '/page-sitemap.xml',
    '/wp-sitemap.xml',
    '/news-sitemap.xml',
  ], (req, res) => {
    res.redirect(301, '/sitemap.xml');
  });

  if (isProduction) {
    app.use(expressStaticGzip(path.join(__dirname, '../dist'), {
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
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          } else if (fileName.endsWith('sw.js') || fileName.endsWith('manifest.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          } else if (filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        }
      }
    }));

    app.use('/assets/', async (req, res, next) => {
      if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.js.br') || req.path.endsWith('.css.br')) {
        const fs = await import('fs');
        const filePath = path.join(__dirname, '../dist/assets', req.path);
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
    logger.error('[Startup] Auth routes setup failed:', { error: err as Error });
  }

  registerRoutes(app);

  if (isProduction) {
    const SEO_META: Record<string, { title: string; description: string }> = {
      '/': {
        title: 'Ever Club | Golf Simulator & Social Club, Tustin OC',
        description: 'Orange County\'s premier indoor golf simulator club in Tustin, CA. Trackman simulators, coworking, farm-to-table café & wellness. Book a tour today.',
      },
      '/membership': {
        title: 'Membership Plans & Pricing | Ever Club — Tustin OC',
        description: 'Explore membership tiers at Ever Club. Social, Core, Premium & Corporate plans with Trackman golf simulator access, coworking & events in Tustin, OC.',
      },
      '/membership/apply': {
        title: 'Apply for Membership | Ever Club — OC Golf Club',
        description: 'Join OC\'s premier indoor golf & social club. Apply for membership at Ever Club in Tustin — Trackman simulators, workspace, wellness & community.',
      },
      '/private-hire': {
        title: 'Private Events & Venue Hire | Ever Club, Tustin',
        description: 'Host private events, corporate gatherings & celebrations at Ever Club in Tustin. Trackman simulator bays, conference rooms & event spaces in OC.',
      },
      '/whats-on': {
        title: 'Events & Happenings in OC | Ever Club',
        description: 'Discover golf tournaments, social nights, wellness classes & curated events at Ever Club in Tustin, OC. Browse upcoming events and RSVP today.',
      },
      '/menu': {
        title: 'Café Menu | Ever Club — Tustin, OC',
        description: 'Explore the Ever Club café menu. Farm-to-table breakfast, artisan lunch, craft coffee & curated beverages at OC\'s premier indoor golf & social club.',
      },
      '/gallery': {
        title: 'Gallery & Photos | Ever Club — Golf Club in OC',
        description: 'See inside Ever Club in Tustin. Photos of Trackman golf simulators, lounge, café, coworking spaces & member events at OC\'s private social club.',
      },
      '/contact': {
        title: 'Contact Us | Ever Club — Tustin, OC',
        description: 'Contact Ever Club at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780. Membership inquiries, private events, tours & questions. (949) 545-5855.',
      },
      '/tour': {
        title: 'Book a Tour | Ever Club — Golf & Social Club, OC',
        description: 'Schedule a free 30-minute tour of Ever Club in Tustin. See Trackman golf simulators, coworking, café & wellness spaces at OC\'s top private club.',
      },
      '/day-pass': {
        title: 'Day Pass — Golf Simulator & Coworking | Ever Club OC',
        description: 'No membership needed. Buy a day pass for Trackman indoor golf simulators or premium coworking at Ever Club in Tustin, Orange County. Walk in & play.',
      },
      '/faq': {
        title: 'FAQ — Frequently Asked Questions | Ever Club',
        description: 'Got questions about Ever Club? Find answers about memberships, Trackman golf simulators, events, hours, day passes & more at our Tustin, OC location.',
      },
      '/privacy': {
        title: 'Privacy Policy | Ever Members Club',
        description: 'Read the Ever Members Club privacy policy. How we collect, use, and protect your personal data from bookings, payments & membership in Tustin, CA.',
      },
      '/terms': {
        title: 'Terms of Service | Ever Members Club',
        description: 'Ever Members Club terms of service — membership agreements, monthly fees, cancellation policy, liability waivers & guest pass rules at our Tustin, OC club.',
      },
      '/private-hire/inquire': {
        title: 'Private Event Inquiry | Ever Club — OC Venue',
        description: 'Submit an inquiry for private events at Ever Club in Tustin, OC. Golf simulator parties, corporate gatherings, celebrations & custom event packages.',
      },
      '/about': {
        title: 'About Ever Club | Golf & Social Club, Tustin OC',
        description: 'Learn about Ever Club, Orange County\'s premier indoor golf & social club in Tustin. Trackman simulators, coworking, café, events & wellness.',
      },
      '/membership/compare': {
        title: 'Compare Membership Plans | Ever Club — Tustin OC',
        description: 'Compare Ever Club membership tiers side-by-side. Features, pricing & benefits for Social, Core, Premium & Corporate plans at our Tustin, OC golf club.',
      },
    };

    const BASE_JSON_LD = {
      "@type": ["SportsActivityLocation", "LocalBusiness"],
      "name": "Ever Members Club",
      "alternateName": ["Ever Club", "Even House"],
      "description": "Orange County's premier private indoor golf & social club featuring Trackman simulators, premium coworking, wellness programs, and curated events.",
      "url": "https://everclub.app",
      "telephone": "+19495455855",
      "email": "info@joinever.club",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "15771 Red Hill Ave, Ste 500",
        "addressLocality": "Tustin",
        "addressRegion": "CA",
        "postalCode": "92780",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 33.709,
        "longitude": -117.8272
      },
      "areaServed": {
        "@type": "GeoCircle",
        "geoMidpoint": {
          "@type": "GeoCoordinates",
          "latitude": 33.709,
          "longitude": -117.8272
        },
        "geoRadius": "30 mi"
      },
      "priceRange": "$$$",
      "paymentAccepted": "Credit Card, Debit Card",
      "currenciesAccepted": "USD",
      "openingHoursSpecification": [
        {
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          "opens": "07:00",
          "closes": "22:00"
        },
        {
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": ["Saturday", "Sunday"],
          "opens": "08:00",
          "closes": "22:00"
        }
      ],
      "sameAs": ["https://www.instagram.com/everhouse.app/"],
      "image": "https://everclub.app/images/hero-lounge-optimized.webp",
      "amenityFeature": [
        {"@type": "LocationFeatureSpecification", "name": "Trackman Golf Simulators", "value": true},
        {"@type": "LocationFeatureSpecification", "name": "Premium Coworking Space", "value": true},
        {"@type": "LocationFeatureSpecification", "name": "Café & Bar", "value": true},
        {"@type": "LocationFeatureSpecification", "name": "Private Event Space", "value": true},
        {"@type": "LocationFeatureSpecification", "name": "Wellness Programs", "value": true}
      ],
      "hasOfferCatalog": {
        "@type": "OfferCatalog",
        "name": "Membership Plans",
        "itemListElement": [
          {"@type": "Offer", "name": "Social Membership", "description": "Access to social events and café"},
          {"@type": "Offer", "name": "Core Membership", "description": "Golf simulator access, coworking, and events"},
          {"@type": "Offer", "name": "Premium Membership", "description": "Full access including priority booking and wellness"},
          {"@type": "Offer", "name": "Day Pass", "description": "Single-day access to golf simulators or coworking"}
        ]
      }
    };

    const FAQ_JSON_LD = {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is Ever Members Club?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Ever Members Club is Orange County's premier private indoor golf and social club, located in Tustin, CA. We combine Trackman golf simulators, premium coworking spaces, a café, wellness programs, and curated social events under one roof."
          }
        },
        {
          "@type": "Question",
          "name": "Where is Ever Members Club located?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "We're located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County."
          }
        },
        {
          "@type": "Question",
          "name": "What golf simulators do you use?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "We use Trackman golf simulators, the industry-leading technology used by PGA Tour professionals for practice, play, and entertainment."
          }
        },
        {
          "@type": "Question",
          "name": "Do I need a membership to visit?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "You can experience the club with a Day Pass for golf simulators or coworking, or book a private tour to see the full facility before joining."
          }
        },
        {
          "@type": "Question",
          "name": "What membership options are available?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "We offer Social, Core, Premium, and Corporate membership tiers, each with different levels of access to golf simulators, coworking, events, and wellness programs."
          }
        },
        {
          "@type": "Question",
          "name": "Can I host a private event at Ever Club?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes! We offer private event spaces including golf simulator bays and conference rooms for corporate events, celebrations, and social gatherings."
          }
        }
      ]
    };

    const TOURS_JSON_LD = {
      "@type": "TouristAttraction",
      "name": "Ever Members Club",
      "description": "Schedule a free 30-minute tour of Orange County's premier indoor golf & social club featuring Trackman simulators, premium coworking, café & wellness facilities.",
      "url": "https://everclub.app/tour",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "15771 Red Hill Ave, Ste 500",
        "addressLocality": "Tustin",
        "addressRegion": "CA",
        "postalCode": "92780",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 33.709,
        "longitude": -117.8272
      },
      "touristType": ["Golf Enthusiasts", "Professionals", "Social Groups"]
    };

    const EVENT_VENUE_JSON_LD = {
      "@type": "EventVenue",
      "name": "Ever Members Club — Private Event Venue",
      "description": "Host private events, corporate gatherings & celebrations at Ever Members Club in Tustin. Trackman golf simulator bays, conference rooms & elegant event spaces in Orange County.",
      "url": "https://everclub.app/private-hire",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "15771 Red Hill Ave, Ste 500",
        "addressLocality": "Tustin",
        "addressRegion": "CA",
        "postalCode": "92780",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 33.709,
        "longitude": -117.8272
      },
      "maximumAttendeeCapacity": 100,
      "telephone": "+19495455855"
    };

    const GEO_META_TAGS = `<meta name="geo.region" content="US-CA" />\n<meta name="geo.placename" content="Tustin, California" />\n<meta name="geo.position" content="33.709;-117.8272" />\n<meta name="ICBM" content="33.709, -117.8272" />`;

    const NAV_LINKS = `<nav aria-label="Site Navigation"><ul>
<li><a href="/">Home</a></li>
<li><a href="/membership">Membership Plans</a></li>
<li><a href="/membership/compare">Compare Memberships</a></li>
<li><a href="/membership/apply">Apply for Membership</a></li>
<li><a href="/tour">Book a Tour</a></li>
<li><a href="/day-pass">Day Pass</a></li>
<li><a href="/private-hire">Private Events</a></li>
<li><a href="/whats-on">Events &amp; Happenings</a></li>
<li><a href="/menu">Caf&eacute; Menu</a></li>
<li><a href="/gallery">Gallery</a></li>
<li><a href="/about">About Ever Club</a></li>
<li><a href="/faq">FAQ</a></li>
<li><a href="/contact">Contact Us</a></li>
<li><a href="/privacy">Privacy Policy</a></li>
<li><a href="/terms">Terms of Service</a></li>
</ul></nav>`;

    const FOOTER_BLOCK = `<footer>
<p>Ever Members Club &mdash; Indoor Golf &amp; Social Club</p>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780 | (949) 545-5855 | info@joinever.club</p>
<p>Hours: Tue&ndash;Thu 8:30 AM&ndash;8 PM | Fri&ndash;Sat 8:30 AM&ndash;10 PM | Sun 8:30 AM&ndash;6 PM | Mon Closed</p>
${NAV_LINKS}
</footer>`;

    const SSR_CONTENT: Record<string, string> = {
      '/': `<div role="main">
<h1>Ever Club &mdash; Indoor Golf Simulator &amp; Social Club in Tustin, Orange County</h1>
<p>Ever Club (formerly Even House) is Orange County&rsquo;s premier private indoor golf and social club, located in Tustin, CA. Experience state-of-the-art Trackman golf simulators, premium coworking spaces, a chef-driven farm-to-table caf&eacute;, curated events, and wellness programming &mdash; all under one roof.</p>
<h2>Trackman Golf Simulators in Orange County</h2>
<p>Play year-round on four Trackman 4 simulator bays delivering tour-level ball and club data. Practice your swing, compete on 100+ championship courses, or host a league night. Our indoor golf simulators near Tustin offer the best golf simulator experience in OC &mdash; rain or shine, no tee time required.</p>
<h2>Premium Coworking &amp; Private Offices</h2>
<p>Thoughtfully designed workspaces with high-speed fiber, private offices, conference rooms, and open lounges built for focus and creative collaboration in Orange County.</p>
<h2>Farm-to-Table Caf&eacute; &amp; Bar</h2>
<p>From morning espresso to craft cocktails, our chef-driven caf&eacute; serves locally-sourced dishes in a relaxed club atmosphere.</p>
<h2>Curated Events &amp; Wellness</h2>
<p>Wine tastings, golf socials, wellness workshops, and chef-led dinners designed to build connection and community every week.</p>
<h2>Membership Plans</h2>
<p>Choose from Social, Core, Premium, and Corporate membership tiers. Each offers different levels of access to golf simulators, coworking, events, and wellness programs. <a href="/membership">Explore membership options</a> or <a href="/tour">book a private tour</a>.</p>
<h2>Private Events &amp; Venue Hire in OC</h2>
<p>Host corporate events, celebrations, and social gatherings at Ever Club. <a href="/private-hire">Learn about private events</a>.</p>
<p>As seen in <strong>Forbes</strong>, <strong>Hypebeast</strong>, and <strong>Fox 11</strong>.</p>
<p><a href="/tour">Book a Tour</a> | <a href="/membership">Explore Membership</a> | <a href="/day-pass">Get a Day Pass</a></p>
${FOOTER_BLOCK}
</div>`,

      '/membership': `<div role="main">
<h1>Membership Plans &amp; Pricing &mdash; Ever Club Indoor Golf Club, Tustin OC</h1>
<p>Join Orange County&rsquo;s premier indoor golf and social club. Ever Club offers flexible membership tiers designed for professionals who want Trackman golf simulator access, premium coworking, curated events, and wellness programming in Tustin, CA.</p>
<h2>Social Membership</h2>
<p>Access to social events, caf&eacute;, and lounge areas at Ever Club. Perfect for those who want community and connection.</p>
<h2>Core Membership</h2>
<p>Includes golf simulator access, coworking spaces, and all social events. The most popular plan for professionals in Orange County.</p>
<h2>Premium Membership</h2>
<p>Full access including priority booking, extended simulator sessions, wellness programs, and exclusive member dinners.</p>
<h2>Corporate Membership</h2>
<p>Volume-discounted plans for teams. Includes Premium-level benefits for every employee with group booking and guest passes.</p>
<h2>Day Passes Available</h2>
<p>No membership needed &mdash; try Ever Club with a <a href="/day-pass">golf simulator or coworking day pass</a>.</p>
<p><a href="/membership/compare">Compare all tiers</a> | <a href="/membership/apply">Apply now</a> | <a href="/tour">Book a tour</a></p>
${FOOTER_BLOCK}
</div>`,

      '/about': `<div role="main">
<h1>About Ever Club &mdash; Indoor Golf &amp; Social Club in Tustin, Orange County</h1>
<p>Ever Club, formerly known as Even House, is a private members club located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County. Founded to create a refined third space where ambitious professionals come together, the club offers an experience unlike any other in the region.</p>
<h2>What We Offer</h2>
<ul>
<li><strong>Indoor Golf Simulators</strong> &mdash; State-of-the-art Trackman 4 simulators for practice, play, and entertainment in Orange County.</li>
<li><strong>Premium Workspace</strong> &mdash; Focused coworking spaces and bookable conference rooms for professionals.</li>
<li><strong>Chef-Driven Caf&eacute;</strong> &mdash; Farm-to-table food and craft beverages from morning coffee to evening cocktails.</li>
<li><strong>Curated Events</strong> &mdash; Networking nights, golf tournaments, wine tastings, and social gatherings.</li>
<li><strong>Wellness Programs</strong> &mdash; Services and programming designed for the modern professional.</li>
<li><strong>Private Hire</strong> &mdash; Host corporate events, birthdays, and team outings in our versatile OC venue.</li>
</ul>
<h2>Our Values</h2>
<p>Community First &mdash; Quality Over Quantity &mdash; Inclusive Excellence. Whether you shoot a 70 or have never held a club, you belong here.</p>
<p><a href="/tour">Book a Tour</a> | <a href="/membership">Explore Membership</a></p>
${FOOTER_BLOCK}
</div>`,

      '/day-pass': `<div role="main">
<h1>Day Pass &mdash; Golf Simulator &amp; Coworking in Tustin, Orange County</h1>
<p>No membership required. Experience Ever Club with a day pass for Trackman golf simulators or premium coworking in Tustin, OC.</p>
<h2>Golf Simulator Day Pass</h2>
<p>Book a 60-minute session on our Trackman 4 indoor golf simulators. Play championship courses, analyze your swing data, or just have fun with friends. The best indoor golf experience near you in Orange County.</p>
<h2>Coworking Day Pass</h2>
<p>Full-day access to our premium workspace with high-speed internet, espresso, and a professional atmosphere in Tustin, CA.</p>
<p>Want unlimited access? <a href="/membership">Explore membership plans</a> or <a href="/tour">book a tour</a> to see the full club.</p>
${FOOTER_BLOCK}
</div>`,

      '/contact': `<div role="main">
<h1>Contact Ever Club &mdash; Indoor Golf &amp; Social Club, Tustin OC</h1>
<h2>Visit Us</h2>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780</p>
<h2>Call Us</h2>
<p>(949) 545-5855</p>
<h2>Email Us</h2>
<p>info@joinever.club</p>
<h2>Hours of Operation</h2>
<p>Monday: Closed | Tuesday&ndash;Thursday: 8:30 AM&ndash;8:00 PM | Friday&ndash;Saturday: 8:30 AM&ndash;10:00 PM | Sunday: 8:30 AM&ndash;6:00 PM</p>
<p><a href="/tour">Book a private tour</a> | <a href="/membership">Apply for membership</a></p>
${FOOTER_BLOCK}
</div>`,

      '/tour': `<div role="main">
<h1>Book a Tour &mdash; Ever Club Indoor Golf &amp; Social Club, Tustin OC</h1>
<p>Schedule a free 30-minute tour of Orange County&rsquo;s premier indoor golf and social club. See our Trackman golf simulators, premium coworking spaces, chef-driven caf&eacute;, and wellness facilities firsthand.</p>
<p>Located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780.</p>
<p><a href="/membership">Explore membership</a> | <a href="/day-pass">Try a day pass</a></p>
${FOOTER_BLOCK}
</div>`,

      '/private-hire': `<div role="main">
<h1>Private Events &amp; Venue Hire &mdash; Ever Club, Tustin, Orange County</h1>
<p>Host your next private event at Ever Club in Tustin, OC. Our versatile spaces include Trackman golf simulator bays, conference rooms, and elegant event areas perfect for corporate gatherings, celebrations, team outings, and social events.</p>
<h2>Event Spaces</h2>
<p>Full club buyouts, private simulator bays, and dedicated event areas with catering from our chef-driven kitchen.</p>
<p><a href="/private-hire/inquire">Submit an event inquiry</a> | <a href="/contact">Contact us</a></p>
${FOOTER_BLOCK}
</div>`,

      '/private-hire/inquire': `<div role="main">
<h1>Private Event Inquiry &mdash; Ever Club, Tustin OC</h1>
<p>Submit an inquiry for your next private event at Ever Club in Orange County. Golf simulator parties, corporate events, team outings, celebrations, and more.</p>
<p><a href="/private-hire">Learn about our event spaces</a> | <a href="/contact">Contact us</a></p>
${FOOTER_BLOCK}
</div>`,

      '/faq': `<div role="main">
<h1>Frequently Asked Questions &mdash; Ever Club, Tustin OC</h1>
<h2>What is Ever Members Club?</h2>
<p>Ever Members Club is Orange County&rsquo;s premier private indoor golf and social club, located in Tustin, CA. We combine Trackman golf simulators, premium coworking spaces, a caf&eacute;, wellness programs, and curated social events under one roof.</p>
<h2>Where is Ever Members Club located?</h2>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County.</p>
<h2>What golf simulators do you use?</h2>
<p>We use Trackman golf simulators, the industry-leading technology used by PGA Tour professionals.</p>
<h2>Do I need a membership to visit?</h2>
<p>You can experience the club with a <a href="/day-pass">Day Pass</a> or <a href="/tour">book a private tour</a>.</p>
<h2>What membership options are available?</h2>
<p>We offer Social, Core, Premium, and Corporate membership tiers. <a href="/membership">See all plans</a>.</p>
<h2>Can I host a private event?</h2>
<p>Yes! <a href="/private-hire">Learn about private events</a> at Ever Club.</p>
${FOOTER_BLOCK}
</div>`,

      '/gallery': `<div role="main">
<h1>Gallery &amp; Photos &mdash; Ever Club Indoor Golf &amp; Social Club, OC</h1>
<p>See inside Ever Club in Tustin, Orange County. Photos of our Trackman golf simulators, lounge, caf&eacute;, coworking spaces, and member events at OC&rsquo;s private social club.</p>
<p><a href="/tour">Book a tour</a> to experience it in person | <a href="/membership">Explore membership</a></p>
${FOOTER_BLOCK}
</div>`,

      '/menu': `<div role="main">
<h1>Caf&eacute; Menu &mdash; Ever Club, Tustin OC</h1>
<p>Explore the Ever Club caf&eacute; menu. Farm-to-table breakfast, artisan lunch, craft coffee, and curated beverages at Orange County&rsquo;s premier indoor golf and social club.</p>
<p><a href="/tour">Book a tour</a> | <a href="/membership">Explore membership</a></p>
${FOOTER_BLOCK}
</div>`,

      '/whats-on': `<div role="main">
<h1>Events &amp; Happenings &mdash; Ever Club, Tustin OC</h1>
<p>Discover golf tournaments, social nights, wellness classes, and curated events at Ever Club in Tustin, Orange County. See what&rsquo;s on and RSVP.</p>
<p><a href="/membership">Become a member</a> | <a href="/tour">Book a tour</a></p>
${FOOTER_BLOCK}
</div>`,

      '/membership/apply': `<div role="main">
<h1>Apply for Membership &mdash; Ever Club Indoor Golf Club, Orange County</h1>
<p>Join OC&rsquo;s premier indoor golf and social club. Apply for membership at Ever Club in Tustin &mdash; Trackman simulators, workspace, wellness, and community.</p>
<p><a href="/membership">View membership plans</a> | <a href="/tour">Book a tour first</a></p>
${FOOTER_BLOCK}
</div>`,

      '/membership/compare': `<div role="main">
<h1>Compare Membership Plans &mdash; Ever Club Golf Simulator Club, OC</h1>
<p>Compare Ever Club membership tiers side-by-side. See the full feature table for Social, Core, Premium, and Corporate plans at our Tustin, Orange County indoor golf club.</p>
<p><a href="/membership">Back to membership overview</a> | <a href="/membership/apply">Apply now</a></p>
${FOOTER_BLOCK}
</div>`,

      '/privacy': `<div role="main">
<h1>Privacy Policy &mdash; Ever Members Club</h1>
<p>Read the Ever Members Club privacy policy. Learn how we collect, use, and protect your personal data.</p>
${FOOTER_BLOCK}
</div>`,

      '/terms': `<div role="main">
<h1>Terms of Service &mdash; Ever Members Club</h1>
<p>Review the Ever Members Club terms of service &mdash; membership agreements, fees, cancellation policy, and guest pass rules.</p>
${FOOTER_BLOCK}
</div>`,
    };

    function getBreadcrumbs(routePath: string): object {
      const items: { name: string; item: string }[] = [
        { name: "Home", item: "https://everclub.app" }
      ];

      const breadcrumbMap: Record<string, { name: string; item: string }[]> = {
        '/membership': [{ name: "Membership", item: "https://everclub.app/membership" }],
        '/membership/apply': [
          { name: "Membership", item: "https://everclub.app/membership" },
          { name: "Apply", item: "https://everclub.app/membership/apply" }
        ],
        '/membership/compare': [
          { name: "Membership", item: "https://everclub.app/membership" },
          { name: "Compare Plans", item: "https://everclub.app/membership/compare" }
        ],
        '/tour': [{ name: "Book a Tour", item: "https://everclub.app/tour" }],
        '/private-hire': [{ name: "Private Events", item: "https://everclub.app/private-hire" }],
        '/private-hire/inquire': [
          { name: "Private Events", item: "https://everclub.app/private-hire" },
          { name: "Inquire", item: "https://everclub.app/private-hire/inquire" }
        ],
        '/whats-on': [{ name: "Events", item: "https://everclub.app/whats-on" }],
        '/menu': [{ name: "Café Menu", item: "https://everclub.app/menu" }],
        '/gallery': [{ name: "Gallery", item: "https://everclub.app/gallery" }],
        '/contact': [{ name: "Contact", item: "https://everclub.app/contact" }],
        '/day-pass': [{ name: "Day Pass", item: "https://everclub.app/day-pass" }],
        '/faq': [{ name: "FAQ", item: "https://everclub.app/faq" }],
        '/about': [{ name: "About", item: "https://everclub.app/about" }],
      };

      const additionalItems = breadcrumbMap[routePath] || [];
      const allItems = [...items, ...additionalItems];

      return {
        "@type": "BreadcrumbList",
        "itemListElement": allItems.map((item, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "name": item.name,
          "item": item.item
        }))
      };
    }

    function getJsonLdScripts(routePath: string): string {
      const graphItems: object[] = [
        {
          "@type": "Organization",
          "@id": "https://everclub.app/#organization",
          "name": "Ever Members Club",
          "alternateName": ["Ever Club", "Even House"],
          "url": "https://everclub.app",
          "logo": "https://everclub.app/images/everclub-logo-dark.webp",
          "sameAs": [
            "https://www.instagram.com/everclub/",
            "https://evenhouse.club",
            "https://www.linkedin.com/company/ever-club",
            "https://www.tiktok.com/@everclub"
          ],
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "15771 Red Hill Ave, Ste 500",
            "addressLocality": "Tustin",
            "addressRegion": "CA",
            "postalCode": "92780",
            "addressCountry": "US"
          },
          "contactPoint": {
            "@type": "ContactPoint",
            "telephone": "+19495455855",
            "contactType": "customer service",
            "email": "info@joinever.club"
          }
        },
        {
          "@type": "WebSite",
          "@id": "https://everclub.app/#website",
          "url": "https://everclub.app",
          "name": "Ever Members Club",
          "publisher": { "@id": "https://everclub.app/#organization" },
          "potentialAction": {
            "@type": "SearchAction",
            "target": "https://everclub.app/faq?q={search_term_string}",
            "query-input": "required name=search_term_string"
          }
        },
        { ...BASE_JSON_LD, "@id": "https://everclub.app/#localbusiness" }
      ];

      if (routePath === '/faq') {
        graphItems.push(FAQ_JSON_LD);
      }
      if (routePath === '/tour') {
        graphItems.push(TOURS_JSON_LD);
      }
      if (routePath === '/private-hire') {
        graphItems.push(EVENT_VENUE_JSON_LD);
      }
      if (routePath === '/about') {
        graphItems.push({
          "@type": "AboutPage",
          "name": "About Ever Club",
          "description": "Learn about Ever Club, Orange County's premier indoor golf & social club in Tustin.",
          "url": "https://everclub.app/about",
          "mainEntity": {
            "@type": "Organization",
            "name": "Ever Members Club"
          }
        });
      }

      if (routePath !== '/') {
        graphItems.push(getBreadcrumbs(routePath));
      }

      return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graphItems })}</script>`;
    }

    const injectCspNonce = (html: string, nonce: string): string => {
      return html
        .replace(/<script(?![^>]*type\s*=\s*["']application\/ld\+json["'])(?=[\s>])/gi, `<script nonce="${nonce}"`)
        .replace(/<style(?=[\s>])/gi, `<style nonce="${nonce}"`);
    };

    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/') && !req.path.startsWith('/assets/') && req.path !== '/healthz' && req.path !== '/_health') {
        if (!cachedIndexHtml) {
          const indexPath = path.join(__dirname, '../dist/index.html');
          try {
            const { readFileSync } = require('fs') as typeof import('fs');
            const rawHtml = readFileSync(indexPath, 'utf8');
            const nonce = res.locals.cspNonce as string;
            res.setHeader('Content-Type', 'text/html');
            return res.send(injectCspNonce(rawHtml, nonce));
          } catch {
            return res.sendFile(indexPath);
          }
        }

        const routePath = req.path.replace(/\/+$/, '') || '/';
        const meta = SEO_META[routePath];
        const nonce = res.locals.cspNonce as string;

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        const linkHints = ['</images/hero-lounge-optimized.webp>; rel=preload; as=image; type=image/webp'];
        if (mainCssPath) {
          linkHints.push(`<${mainCssPath}>; rel=preload; as=style; crossorigin`);
        }
        linkHints.push('<https://fonts.googleapis.com>; rel=preconnect');
        linkHints.push('<https://fonts.gstatic.com>; rel=preconnect; crossorigin');
        res.setHeader('Link', linkHints.join(', '));

        const injectSsrContent = (html: string, route: string): string => {
          const ssrBlock = SSR_CONTENT[route];
          if (ssrBlock) {
            return html.replace(
              /<noscript>\s*<div role="main">[\s\S]*?<\/div>\s*<\/noscript>/,
              `<noscript>${ssrBlock}</noscript>`
            );
          }
          return html;
        };

        if (meta) {
          const ogUrl = `${siteOrigin}${routePath === '/' ? '' : routePath}`;
          let html = cachedIndexHtml;
          html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
          html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${meta.description}" />`);
          html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${meta.title}" />`);
          html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${meta.description}" />`);
          html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${ogUrl}" />`);
          html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${meta.title}" />`);
          html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${meta.description}" />`);
          html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${ogUrl}" />`);
          html = html.replace('</head>', `${GEO_META_TAGS}\n${getJsonLdScripts(routePath)}\n</head>`);
          html = injectSsrContent(html, routePath);
          return res.send(injectCspNonce(html, nonce));
        }

        let html = cachedIndexHtml;
        const fallbackUrl = `${siteOrigin}${routePath === '/' ? '' : routePath}`;
        html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${fallbackUrl}" />`);
        html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${fallbackUrl}" />`);
        html = html.replace('</head>', `${GEO_META_TAGS}\n${getJsonLdScripts(routePath)}\n</head>`);
        html = injectSsrContent(html, routePath);
        return res.send(injectCspNonce(html, nonce));
      }
      next();
    });
  }

  app.use((err: Error, req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    const appErr = err as unknown as { statusCode?: number; error?: string; details?: Record<string, unknown> };
    if (err.constructor?.name === 'AppError' && typeof appErr.statusCode === 'number' && typeof appErr.error === 'string') {
      logger.warn('[Express] AppError', {
        error: err,
        extra: { method: req.method, url: req.originalUrl, status: appErr.statusCode }
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
        error: err,
        extra: { method: req.method, url: req.originalUrl, table: parsed.table, constraint: parsed.constraintName }
      });
      if (!res.headersSent) {
        res.status(409).json({ error: parsed.message, table: parsed.table, constraint: parsed.constraintName });
      }
      return;
    }

    const status = getErrorStatusCode(err) || 500;
    logger.error('[Express] Unhandled route error', {
      error: err,
      extra: { method: req.method, url: req.originalUrl, status }
    });
    if (!res.headersSent) {
      res.status(status).json({ error: status >= 500 ? 'Internal server error' : getErrorMessage(err) });
    }
  });

  expressApp = app;

  if (isProduction) {
    try {
      const indexPath = path.join(__dirname, '../dist/index.html');
      const fs = await import('fs');
      cachedIndexHtml = fs.readFileSync(indexPath, 'utf8');
      const cssMatch = cachedIndexHtml.match(/href="(\/assets\/[^"]+\.css)"/);
      if (cssMatch) {
        mainCssPath = cssMatch[1];
      }
      logger.info('[Startup] Cached index.html for fast serving', { mainCssPath });
    } catch (err: unknown) {
      logger.error('[Startup] Failed to cache index.html:', { error: err as Error });
    }
  }

  try {
    initWebSocketServer(httpServer!);
    websocketInitialized = true;
  } catch (err: unknown) {
    logger.error('[Startup] WebSocket initialization failed:', { error: err as Error });
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
              logger.error('[Startup] Startup retry failed unexpectedly:', { error: err as Error });
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
          logger.error('[Startup] Scheduler initialization failed:', { error: err as Error });
        }
      })
      .catch((err) => {
        logger.error('[Startup] Startup tasks failed unexpectedly:', { error: err as Error });
        try {
          initSchedulers();
          schedulersInitialized = true;
          logger.warn('[Startup] Schedulers initialized despite startup task failure');
        } catch (schedErr: unknown) {
          logger.error('[Startup] Scheduler initialization also failed:', { error: schedErr as Error });
        }
      });

    if (!isProduction) {
      setTimeout(async () => {
        try {
          await autoSeedResources(db, sql, resources, isProduction);
        } catch (err: unknown) {
          logger.error('[Startup] Auto-seed resources failed:', { error: err as Error });
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

