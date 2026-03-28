import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../core/logger';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';
import { PgRateLimitStore } from './pgRateLimitStore';

const getClientKey = (req: Request): string => {
  const userId = req.session?.user?.id;
  if (userId) {
    return `user:${String(userId)}`;
  }
  return String(req.ip || 'unknown').toLowerCase();
};

export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req: Request) => {
    if (req.session?.user?.id) {
      return 2000;
    }
    return 600;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('global'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Global limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
  },
  skip: (req) => {
    if (req.path === '/healthz' || req.path === '/api/health') {
      return true;
    }
    if (req.path === '/api/auth/session') {
      return true;
    }
    if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif)(\?|$)/.test(req.path)) {
      return true;
    }
    return false;
  }
});

export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('payment'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Payment limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many payment requests. Please wait a moment.' });
  }
});

export const bookingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('booking'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Booking limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many booking requests. Please wait a moment.' });
  }
});

export const authRateLimiterByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `auth-ip:${req.ip || 'unknown'}`,
  validate: false,
  store: new PgRateLimitStore('auth-ip'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Auth IP limit exceeded for ${req.ip}`);
    res.status(429).json({ error: 'Too many login attempts from this location. Please try again in 15 minutes.' });
  }
});

export const authRateLimiterByEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const rawEmail = String(req.body?.email || 'unknown').trim().toLowerCase();
    const clientIp = String(req.ip || 'unknown').toLowerCase();
    return `auth-email-ip:${rawEmail}:${clientIp}`;
  },
  validate: false,
  store: new PgRateLimitStore('auth-email'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Auth email limit exceeded for ${req.body?.email || 'unknown'}`);
    res.status(429).json({ error: 'Too many login attempts for this account. Please try again in 15 minutes.' });
  }
});

export const authRateLimiter = [authRateLimiterByIp, authRateLimiterByEmail];

export const sensitiveActionRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('sensitive'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Sensitive action limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many requests for this action. Please wait.' });
  }
});

export const checkoutRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email;
    const sessionId = req.params?.sessionId;
    if (email) {
      return `checkout:${String(email).toLowerCase()}:${String(req.ip || 'unknown')}`;
    }
    if (sessionId) {
      return `checkout:session:${String(sessionId)}:${String(req.ip || 'unknown').toLowerCase()}`;
    }
    return `checkout:${String(req.ip || 'unknown')}`;
  },
  validate: false,
  store: new PgRateLimitStore('checkout'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Checkout limit exceeded for ${req.body?.email || 'unknown'} on ${req.path}`);
    res.status(429).json({ error: 'Too many checkout attempts. Please wait a minute before trying again.' });
  }
});

export const subscriptionCreationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('sub-create'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Subscription creation limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many subscription creation attempts. Please wait a moment before trying again.' });
  }
});

const LOCK_TIMEOUT_MS = 120_000;
const inMemoryLocks = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [key, acquiredAt] of inMemoryLocks.entries()) {
    if (now - acquiredAt > LOCK_TIMEOUT_MS) {
      logger.warn('[SubscriptionLock] Releasing stale in-memory lock', { extra: { email: key, heldMs: now - acquiredAt } });
      inMemoryLocks.delete(key);
      const expirySeconds = Math.floor(LOCK_TIMEOUT_MS / 1000);
      db.execute(sql`DELETE FROM subscription_locks WHERE email = ${key} AND locked_at < NOW() - INTERVAL '1 second' * ${expirySeconds}`).catch(() => {});
    }
  }
}, 30_000).unref();

async function ensureSubscriptionLocksTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS subscription_locks (
        email TEXT PRIMARY KEY,
        locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_by TEXT
      )
    `);
  } catch (err) {
    logger.warn('[SubscriptionLock] Table creation failed (may already exist)', { extra: { error: getErrorMessage(err) } });
  }
}

let tableEnsured = false;

export async function acquireSubscriptionLock(email: string, lockedBy?: string): Promise<boolean> {
  const key = email.toLowerCase();

  const existingTs = inMemoryLocks.get(key);
  if (existingTs && Date.now() - existingTs < LOCK_TIMEOUT_MS) {
    logger.info('[SubscriptionLock] Lock already held (in-memory)', { extra: { email: key } });
    return false;
  }

  if (!tableEnsured) {
    try {
      await ensureSubscriptionLocksTable();
      tableEnsured = true;
    } catch (err) {
      logger.error('[SubscriptionLock] Failed to ensure lock table', { extra: { error: getErrorMessage(err) } });
      return false;
    }
  }

  try {
    const expirySeconds = Math.floor(LOCK_TIMEOUT_MS / 1000);
    const result = await db.execute(sql`
      INSERT INTO subscription_locks (email, locked_at, locked_by)
      VALUES (${key}, NOW(), ${lockedBy || 'system'})
      ON CONFLICT (email) DO UPDATE
        SET locked_at = NOW(), locked_by = ${lockedBy || 'system'}
        WHERE subscription_locks.locked_at < NOW() - INTERVAL '1 second' * ${expirySeconds}
      RETURNING email
    `);

    const acquired = result.rows.length > 0;
    if (acquired) {
      inMemoryLocks.set(key, Date.now());
      return true;
    }

    logger.info('[SubscriptionLock] Lock contention', { extra: { email: key } });
    return false;
  } catch (err) {
    logger.error('[SubscriptionLock] Lock acquisition failed', { extra: { error: getErrorMessage(err) } });
    return false;
  }
}

export async function releaseSubscriptionLock(email: string): Promise<void> {
  const key = email.toLowerCase();
  inMemoryLocks.delete(key);
  try {
    await db.execute(sql`DELETE FROM subscription_locks WHERE email = ${key}`);
  } catch (err) {
    logger.warn('[SubscriptionLock] Lock release failed', { extra: { error: getErrorMessage(err) } });
  }
}

export const memberLookupRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
  validate: false,
  store: new PgRateLimitStore('member-lookup'),
  handler: (req: Request, res: Response) => {
    logger.warn(`[RateLimit] Member lookup limit exceeded for ${getClientKey(req)} on ${req.path}`);
    res.status(429).json({ error: 'Too many member lookup requests. Please wait a moment.' });
  }
});
