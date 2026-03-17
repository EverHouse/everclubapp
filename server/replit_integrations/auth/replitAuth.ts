import session from "express-session";
import type { RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import type { Pool } from "pg";
import { Pool as PgPool } from "pg";
import { randomBytes } from "crypto";
import { pool, isProduction } from "../../core/db";
import { getSessionUser } from "../../types/session";
import { getErrorMessage } from "../../utils/errorUtils";
import { logger } from "../../core/logger";

function stripSslMode(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  }
}

const sessionPool = new PgPool({
  connectionString: stripSslMode(process.env.DATABASE_URL),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 60000,
  max: 3,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  allowExitOnIdle: true,
});

sessionPool.on('error', (err) => {
  logger.error('[Session Pool] Idle client error:', { extra: { detail: err.message } });
});

export function getAuthPool() {
  return pool;
}

export function getSession() {
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  
  const cookieConfig = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' as const : 'lax' as const,
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
    const sessionStore = new pgStore({
      pool: sessionPool as unknown as import("pg").Pool,
      createTableIfMissing: true,
      ttl: sessionTtl,
      tableName: "sessions",
      errorLog: (err: Error) => {
        logger.error('[Session Store] Error:', { extra: { message: getErrorMessage(err), stack: err?.stack } });
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

export async function isAdminEmail(email: string): Promise<boolean> {
  const pool = getAuthPool();
  if (!pool) return false;
  
  try {
    const result = await queryWithRetry(
      pool,
      'SELECT id FROM staff_users WHERE LOWER(email) = LOWER($1) AND role = $2 AND is_active = true',
      [email, 'admin']
    );
    return (result as unknown as { rows: unknown[] }).rows.length > 0;
  } catch (error: unknown) {
    logger.error('Error checking admin status:', { extra: { errorMessage: getErrorMessage(error) } });
    return false;
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
};

export const isAdmin: RequestHandler = async (req, res, next) => {
  const user = getSessionUser(req);

  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
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

  const email = user.email?.toLowerCase() || '';
  
  const adminStatus = await isAdminEmail(email);
  if (adminStatus) {
    return next();
  }

  const pool = getAuthPool();
  if (!pool) {
    return res.status(403).json({ message: "Forbidden: Staff access required" });
  }

  try {
    const result = await queryWithRetry(
      pool,
      'SELECT id FROM staff_users WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [email]
    );
    if ((result as unknown as { rows: unknown[] }).rows.length > 0) {
      return next();
    }
  } catch (error: unknown) {
    logger.error('Error checking staff status:', { extra: { errorMessage: getErrorMessage(error) } });
  }

  return res.status(403).json({ message: "Forbidden: Staff access required" });
};
