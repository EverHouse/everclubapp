import session from "express-session";
import type { RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Pool } from "pg";
import { randomBytes } from "crypto";
import { pool, isProduction } from "../../core/db";
import { getSessionUser } from "../../types/session";
import { getErrorMessage, getErrorCode, getErrorDetail } from "../../utils/errorUtils";
import { logger } from "../../core/logger";
import { getAlternateDomainEmail } from "../../core/utils/emailNormalization";
import { stripSslMode } from "../../core/db";

let sessionPool: Pool | null = null;

function appendSearchPath(connString: string | undefined): string | undefined {
  if (!connString) return connString;
  try {
    const u = new URL(connString);
    if (['localhost', '127.0.0.1', 'helium'].includes(u.hostname)) return connString;
    const existing = u.searchParams.get('options') || '';
    if (!existing.includes('search_path')) {
      u.searchParams.set('options', (existing ? existing + ' ' : '') + '-c search_path=public');
    }
    return u.toString();
  } catch {
    return connString;
  }
}

function getOrCreateSessionPool(): Pool {
  if (sessionPool) return sessionPool;

  const rawUrl = appendSearchPath(stripSslMode(process.env.DATABASE_URL));
  const isLocal = rawUrl ? ['localhost', '127.0.0.1', 'helium'].some(h => {
    try { return new URL(rawUrl!).hostname === h; } catch { return false; }
  }) : false;
  const needsSsl = !isLocal;

  sessionPool = new Pool({
    connectionString: rawUrl,
    max: 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

  sessionPool.on('error', (err) => {
    const code = getErrorCode(err);
    const detail = getErrorDetail(err);
    logger.error('[Session Pool] Idle client error (connection will be replaced):', {
      extra: {
        error: getErrorMessage(err),
        code,
        detail,
      },
    });
  });

  logger.info('[Session] Created dedicated session pool (max=5)');
  return sessionPool;
}

export function getAuthPool() {
  return pool;
}

export function getSession() {
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  
  const cookieConfig = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
  
  if (!sessionSecret) {
    if (isProduction) {
      throw new Error('[Session] FATAL: SESSION_SECRET is required in production. Set it in your environment variables.');
    }
    const fallbackSecret = randomBytes(32).toString('hex');
    logger.warn('[Session] SESSION_SECRET is missing - using random fallback (NOT SAFE FOR PRODUCTION, sessions will not persist across restarts)');
    logger.info('[Session] Using MemoryStore');
    return session({
      secret: fallbackSecret,
      resave: false,
      saveUninitialized: false,
      cookie: cookieConfig,
    });
  }
  
  try {
    const sessionTtl = 30 * 24 * 60 * 60; // 30 days in seconds (connect-pg-simple expects seconds)
    const pgStore = connectPg(session);
    const dedicatedPool = getOrCreateSessionPool();
    const sessionStore = new pgStore({
      pool: dedicatedPool as unknown as import("pg").Pool,
      createTableIfMissing: true,
      ttl: sessionTtl,
      tableName: "sessions",
      pruneSessionInterval: 15 * 60,
      errorLog: (err: Error) => {
        const message = getErrorMessage(err);
        const code = getErrorCode(err);
        const detail = getErrorDetail(err);
        const cause = (err as unknown as { cause?: unknown }).cause;
        const causeMessage = cause instanceof Error ? cause.message : undefined;
        const causeCode = cause ? getErrorCode(cause) : undefined;
        const causeDetail = cause ? getErrorDetail(cause) : undefined;
        logger.error('[Session Store] Error:', {
          extra: {
            error: message || '(empty message)',
            code,
            detail,
            causeMessage,
            causeCode,
            causeDetail,
          },
        });
      },
    });
    
    logger.info('[Session] Using Postgres session store');
    return session({
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: cookieConfig,
    });
  } catch (err: unknown) {
    logger.warn('[Session] Postgres store failed, using MemoryStore:', { extra: { errorMessage: getErrorMessage(err) } });
    logger.info('[Session] Using MemoryStore');
    return session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: cookieConfig,
    });
  }
}

export async function queryWithRetry(pool: Pool, query: string, params: unknown[]): Promise<unknown> {
  try {
    return await pool.query(query, params);
  } catch (error: unknown) {
    logger.warn('[Auth] Query failed, retrying once:', { extra: { errorMessage: getErrorMessage(error) } });
    return await pool.query(query, params);
  }
}

const staffRoleCache = new Map<string, { role: 'admin' | 'staff' | null; fetchedAt: number }>();
const STAFF_ROLE_CACHE_TTL_MS = 60_000;
const STAFF_ROLE_CACHE_MAX_SIZE = 100;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of staffRoleCache) {
    if (now - entry.fetchedAt >= STAFF_ROLE_CACHE_TTL_MS) {
      staffRoleCache.delete(key);
    }
  }
}, STAFF_ROLE_CACHE_TTL_MS);

export function clearStaffRoleCache(email?: string) {
  if (email) {
    staffRoleCache.delete(email.toLowerCase());
  } else {
    staffRoleCache.clear();
  }
}

async function getStaffRole(email: string): Promise<'admin' | 'staff' | null> {
  const cacheKey = email.toLowerCase();
  const cached = staffRoleCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < STAFF_ROLE_CACHE_TTL_MS) {
    return cached.role;
  }

  const authPool = getAuthPool();
  if (!authPool) return null;

  try {
    const alternateEmail = getAlternateDomainEmail(email);
    const emailsToCheck = alternateEmail ? [email, alternateEmail] : [email];
    const result = await queryWithRetry(
      authPool,
      `SELECT role FROM staff_users WHERE LOWER(email) = ANY($1::text[]) AND is_active = true ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END LIMIT 1`,
      [emailsToCheck.map(e => e.toLowerCase())]
    );
    const rows = (result as unknown as { rows: { role: string }[] }).rows;
    let role: 'admin' | 'staff' | null = null;
    if (rows.length > 0) {
      const dbRole = rows[0].role;
      if (dbRole === 'admin') role = 'admin';
      else if (dbRole === 'staff') role = 'staff';
    }
    if (staffRoleCache.size >= STAFF_ROLE_CACHE_MAX_SIZE) {
      const oldestKey = staffRoleCache.keys().next().value;
      if (oldestKey) staffRoleCache.delete(oldestKey);
    }
    staffRoleCache.set(cacheKey, { role, fetchedAt: Date.now() });
    return role;
  } catch (error: unknown) {
    logger.error('Error checking staff role:', { extra: { errorMessage: getErrorMessage(error) } });
    return null;
  }
}

export async function isAdminEmail(email: string): Promise<boolean> {
  const role = await getStaffRole(email);
  return role === 'admin';
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at && Date.now() > user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  return next();
};

export const isAdmin: RequestHandler = async (req, res, next) => {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at && Date.now() > user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  const email = user.email?.toLowerCase() || '';
  const adminStatus = await isAdminEmail(email);
  
  if (!adminStatus) {
    return res.status(403).json({ message: "Forbidden: Admin access required" });
  }

  return next();
};

export const isStaffOrAdmin: RequestHandler = async (req, res, next) => {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at && Date.now() > user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  const email = user.email?.toLowerCase() || '';
  const role = await getStaffRole(email);

  if (role === 'admin' || role === 'staff') {
    return next();
  }

  return res.status(403).json({ message: "Forbidden: Staff access required" });
};
