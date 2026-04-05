import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../core/logger';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSP_PLACEHOLDER = `__CSP_${randomBytes(16).toString('hex')}__`;

const defaultEverclubSubdomains = ['everclub.app', 'www.everclub.app', 'api.everclub.app', 'admin.everclub.app'];
const envSubdomains = (process.env.ALLOWED_EVERCLUB_SUBDOMAINS || '')
  .split(',')
  .map(s => {
    const trimmed = s.trim().toLowerCase();
    if (!trimmed) return '';
    try {
      const urlString = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
      return new URL(urlString).hostname;
    } catch {
      return trimmed;
    }
  })
  .filter(Boolean);
const allowedEverclubSubdomains = new Set([...defaultEverclubSubdomains, ...envSubdomains]);

const cachedAllowedHostnames: string[] = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => {
    const trimmed = o.trim();
    if (!trimmed) return '';
    try {
      const urlString = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
      return new URL(urlString).hostname;
    } catch {
      return '';
    }
  })
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain && hostname === replitDomain) return true;

    if (!isProduction) {
      const allowedDevPorts = ['3000', '3001', '5000', '5173', '443'];
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      if ((hostname === 'localhost' || hostname === '127.0.0.1') && allowedDevPorts.includes(port)) return true;
    }

    if (cachedAllowedHostnames.includes(hostname)) return true;
    if (allowedEverclubSubdomains.has(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/webhooks/') || req.path.startsWith('/api/stripe-webhook') || req.path.startsWith('/api/stripe/webhook')) return next();
  if (req.path.startsWith('/api/hubspot/webhooks')) return next();
  if (req.path === '/api/wallet/v1/log') return next();
  if (req.path.startsWith('/api/wallet/v1/') && req.headers.authorization?.startsWith('ApplePass ')) return next();

  const internalHeaderRaw = req.headers['x-internal-request'];
  const internalHeader = Array.isArray(internalHeaderRaw) ? internalHeaderRaw[0] : internalHeaderRaw;
  if (typeof internalHeader === 'string') {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if (internalSecret) {
      const headerHash = createHash('sha256').update(internalHeader).digest();
      const secretHash = createHash('sha256').update(internalSecret).digest();
      if (timingSafeEqual(headerHash, secretHash)) {
        return next();
      }
    }
    logger.warn('[CSRF] Blocked request with invalid x-internal-request header', { path: req.path, method: req.method });
    res.status(403).json({ error: 'Internal verification failed.' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return next();
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

export function getCspPlaceholder(): string {
  return CSP_PLACEHOLDER;
}

function injectNonceIntoHtml(html: string, nonce: string): string {
  const safeRegex = new RegExp(`(<(?:script|style)\\b[^>]*?\\s)nonce="${CSP_PLACEHOLDER}"`, 'gi');
  return html.replace(safeRegex, `$1nonce="${nonce}"`);
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
const isTestRun = process.env.VITEST === '1' || process.env.NODE_ENV === 'test';
if (isProduction && !isTestRun && !process.env.INTERNAL_API_SECRET) {
  throw new Error('INTERNAL_API_SECRET environment variable is required in production');
}

export function securityMiddleware(req: Request, res: Response, next: NextFunction) {
  const isStaticAsset = !req.path.startsWith('/api/') && (
    req.path.startsWith('/assets/') ||
    /[-\.][a-zA-Z0-9]{6,}\.(js|css)(\?|$)/.test(req.path) ||
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif)(\?|$)/i.test(req.path)
  );

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  if (!isStaticAsset) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const nonce = randomBytes(16).toString('base64');
    res.locals.cspNonce = nonce;

    function shouldInjectNonce(body: string): boolean {
      const contentType = res.getHeader('content-type');
      const isHtml = typeof contentType === 'string' && contentType.includes('text/html');
      const looksLikeHtml = !contentType && body.trimStart().startsWith('<!DOCTYPE');
      return isHtml || looksLikeHtml;
    }

    const originalSend = res.send.bind(res);
    res.send = function nonceInjectedSend(body?: unknown): Response {
      try {
        if (typeof body === 'string' && body.length > 0 && shouldInjectNonce(body)) {
          body = injectNonceIntoHtml(body, nonce);
          res.removeHeader('Content-Length');
        }
      } catch (nonceErr) {
        logger.error('[CSP] Nonce injection failed in res.send — serving original response', { extra: { error: String(nonceErr) } });
      }
      return originalSend(body);
    } as typeof res.send;

    const originalEnd = res.end.bind(res);
    res.end = function nonceInjectedEnd(chunk?: unknown, ...args: unknown[]): Response {
      try {
        if (typeof chunk === 'string' && chunk.length > 0 && shouldInjectNonce(chunk)) {
          chunk = injectNonceIntoHtml(chunk, nonce);
          res.removeHeader('Content-Length');
        } else if (Buffer.isBuffer(chunk) && chunk.length > 0) {
          const str = chunk.toString('utf8');
          if (shouldInjectNonce(str)) {
            chunk = Buffer.from(injectNonceIntoHtml(str, nonce), 'utf8');
            res.removeHeader('Content-Length');
          }
        }
      } catch (nonceErr) {
        logger.error('[CSP] Nonce injection failed in res.end — serving original response', { extra: { error: String(nonceErr) } });
      }
      return (originalEnd as Function)(chunk, ...args);
    } as typeof res.end;

    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');


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
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://accounts.google.com https://appleid.cdn-apple.com https://cdn.apple-mapkit.com`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com https://cdn.apple-mapkit.com https://*.hsforms.net`,
      "img-src 'self' data: blob: https://*.stripe.com https://accounts.google.com https://*.gstatic.com https://*.googleusercontent.com https://appleid.cdn-apple.com https://*.hubspot.com https://*.hsforms.net https://*.hsforms.com https://*.hs-analytics.net https://*.hsadspixel.net https://www.facebook.com https://images.unsplash.com https://api.qrserver.com https://my.matterport.com",
      "connect-src 'self' https://api.stripe.com https://accounts.google.com https://appleid.apple.com https://*.apple-mapkit.com https://*.hubspot.com https://*.hubapi.com https://*.hscollectedforms.net https://*.hsforms.net https://*.hsappstatic.net https://*.hs-analytics.net https://www.facebook.com https://connect.facebook.net wss: ws:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://accounts.google.com https://appleid.apple.com https://www.google.com https://my.matterport.com https://app.hubspot.com",
      "frame-ancestors 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join('; '));
  }

  next();
}
