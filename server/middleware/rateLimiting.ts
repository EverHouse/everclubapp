import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../core/logger';
import { db } from '../db';
import { pool, safeRelease } from '../core/db';
import type { PoolClient } from 'pg';
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
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/api')) {
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
  keyGenerator: (req) => `auth-email:${String(req.body?.email || 'unknown').toLowerCase()}`,
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
      return `checkout:session:${String(sessionId)}`;
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
const advisoryLockClients = new Map<string, { client: PoolClient; acquiredAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of advisoryLockClients.entries()) {
    if (now - entry.acquiredAt > LOCK_TIMEOUT_MS) {
      logger.warn('[SubscriptionLock] Releasing stale advisory lock', { extra: { email: key } });
      entry.client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      safeRelease(entry.client);
      advisoryLockClients.delete(key);
    }
  }
}, 60_000).unref();

export async function acquireSubscriptionLock(email: string, _lockedBy?: string): Promise<boolean> {
  const key = email.toLowerCase();

  const existing = advisoryLockClients.get(key);
  if (existing && Date.now() - existing.acquiredAt < LOCK_TIMEOUT_MS) {
    logger.info('[SubscriptionLock] Advisory lock already held', { extra: { email: key } });
    return false;
  }

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query(`SET statement_timeout = '10s'`);
    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [key]);
    const acquired = (result.rows[0] as { acquired: boolean })?.acquired === true;
    if (!acquired) {
      logger.info('[SubscriptionLock] Advisory lock contention', { extra: { email: key } });
      await client.query(`SET statement_timeout = '0'`).catch(() => {});
      safeRelease(client);
      return false;
    }
    advisoryLockClients.set(key, { client, acquiredAt: Date.now() });
    return true;
  } catch (err) {
    logger.error('[SubscriptionLock] Advisory lock acquisition failed', { extra: { error: getErrorMessage(err) } });
    if (client) {
      safeRelease(client);
    }
    return false;
  }
}

export async function releaseSubscriptionLock(email: string): Promise<void> {
  const key = email.toLowerCase();
  const entry = advisoryLockClients.get(key);
  if (!entry) return;
  advisoryLockClients.delete(key);
  try {
    await entry.client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
  } catch (err) {
    logger.warn('[SubscriptionLock] Advisory lock release failed', { extra: { error: getErrorMessage(err) } });
  } finally {
    try {
      await entry.client.query(`SET statement_timeout = '0'`);
    } catch { /* best-effort reset */ }
    safeRelease(entry.client);
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
