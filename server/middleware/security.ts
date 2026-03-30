import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../core/logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const cachedAllowedHostnames: string[] = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => {
    const trimmed = o.trim();
    if (!trimmed) return '';
    try {
      return new URL(trimmed).hostname;
    } catch { /* intentional: malformed URL — extract hostname with regex fallback */
      return trimmed.replace(/^https?:\/\//, '');
    }
  })
  .filter(Boolean);

function isReplitDomain(hostname: string): boolean {
  return hostname.endsWith('.replit.dev') || hostname.endsWith('.replit.app') ||
         hostname.endsWith('.repl.co') || hostname.endsWith('.replit.com');
}

function isAllowedOrigin(origin: string): boolean {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (!isProduction) {
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      if (isReplitDomain(hostname)) return true;
    }
    if (cachedAllowedHostnames.includes(hostname)) return true;
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain && hostname === replitDomain) return true;
    if (hostname === 'everclub.app' || hostname.endsWith('.everclub.app')) return true;
    return false;
  } catch { /* intentional: malformed origin URL — reject as not allowed */
    return false;
  }
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/stripe-webhook') || req.path.startsWith('/api/stripe/webhook')) return next();
  if (req.path.startsWith('/api/hubspot/webhooks')) return next();
  if (req.path.startsWith('/api/wallet/v1/')) return next();

  const internalHeader = req.headers['x-internal-request'] as string | undefined;
  if (internalHeader) {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (internalSecret) {
      const headerBuf = Buffer.from(internalHeader, 'utf8');
      const secretBuf = Buffer.from(internalSecret, 'utf8');
      if (headerBuf.length === secretBuf.length && timingSafeEqual(headerBuf, secretBuf)) {
        return next();
      }
    }
    logger.warn('[CSRF] Blocked request with invalid x-internal-request header', { path: req.path, method: req.method });
    res.status(403).json({ error: 'Internal verification failed.' });
    return;
  }

  const origin = req.headers['origin'] as string | undefined;
  const referer = req.headers['referer'] as string | undefined;

  if (!origin && !referer) {
    logger.warn('[CSRF] Blocked mutative API request with missing Origin and Referer headers', { path: req.path, method: req.method });
    res.status(403).json({ error: 'Origin verification failed. Please try again.' });
    return;
  }

  let source = origin;
  if (!source && referer) {
    try {
      source = new URL(referer).origin;
    } catch {
      logger.warn('[CSRF] Blocked request with malformed referer', { referer, path: req.path });
      res.status(403).json({ error: 'Origin verification failed. Invalid Referer.' });
      return;
    }
  }
  if (source && !isAllowedOrigin(source)) {
    logger.warn('[CSRF] Blocked mutative request from disallowed origin', { origin: source, path: req.path });
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  next();
}

export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  const isStaticAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif)(\?|$)/.test(req.path);
  if (!isStaticAsset) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
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
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com https://cdn.apple-mapkit.com https://*.hsforms.net`,
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
}
