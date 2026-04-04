import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getErrorCode, getErrorDetail, getErrorMessage } from '../utils/errorUtils';
import { isRetryableError as _isRetryableError, RETRYABLE_ERRORS } from './retry';

import { logger } from './logger';
import { isPerformanceEnabled, getQuerySlowThreshold, recordQuery } from './performanceCollector';
export const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';

export function stripSslMode(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch { /* intentional: malformed URL — fall back to regex-based sslmode removal */
    return url.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  }
}

const poolerUrl = stripSslMode(process.env.DATABASE_POOLER_URL);
const rawDirectUrl = stripSslMode(process.env.DATABASE_URL);
const supabaseDirectUrl = stripSslMode(process.env.SUPABASE_DIRECT_URL);
const poolerEnabled = process.env.ENABLE_PGBOUNCER === 'true' || (!!poolerUrl && !isLocalDatabase(rawDirectUrl));

function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', 'helium'].includes(u.hostname);
  } catch { /* intentional: malformed URL — treat as non-local */
    return false;
  }
}

const localDbDetected = isLocalDatabase(rawDirectUrl);
const forcePoolerRedirect = localDbDetected && process.env.FORCE_POOLER_REDIRECT === 'true';

if (forcePoolerRedirect && !poolerUrl) {
  const msg = '[Database] FATAL: FORCE_POOLER_REDIRECT=true but no DATABASE_POOLER_URL configured.';
  logger.error(msg);
  throw new Error(msg);
}

if (localDbDetected && !forcePoolerRedirect) {
  logger.info('[Database] Using local database (set FORCE_POOLER_REDIRECT=true to use Supabase pooler instead)');
}

const directUrl = (forcePoolerRedirect && supabaseDirectUrl) ? supabaseDirectUrl : rawDirectUrl;
export const usingPooler = !!poolerUrl && (poolerEnabled || forcePoolerRedirect) && (!localDbDetected || forcePoolerRedirect);

const effectiveConnectionString = usingPooler ? poolerUrl : directUrl;
if (!effectiveConnectionString) {
  const msg = '[Database] FATAL: No database connection string configured. Set DATABASE_URL or DATABASE_POOLER_URL + ENABLE_PGBOUNCER=true';
  logger.error(msg);
  throw new Error(msg);
}

if (forcePoolerRedirect && poolerUrl) {
  logger.info('[Database] FORCE_POOLER_REDIRECT active — using shared Supabase database via pooler');
}

const sslConfig = { rejectUnauthorized: true };
const needsSsl = !isLocalDatabase(effectiveConnectionString);

function appendSearchPath(connString: string | undefined): string | undefined {
  if (!connString || isLocalDatabase(connString)) return connString;
  try {
    const u = new URL(connString);
    const existing = u.searchParams.get('options') || '';
    if (!existing.includes('search_path')) {
      u.searchParams.set('options', (existing ? existing + ' ' : '') + '-c search_path=public');
    }
    return u.toString();
  } catch { /* intentional: malformed URL — fall back to string concatenation */
    const sep = connString.includes('?') ? '&' : '?';
    return connString + sep + 'options=-c%20search_path%3Dpublic';
  }
}

const mainConnString = appendSearchPath(usingPooler ? poolerUrl : directUrl);

const defaultPoolMax = isProduction ? 20 : 15;
const poolMax = parseInt(process.env.DB_POOL_MAX || String(defaultPoolMax), 10);

const defaultIdleTimeout = 20000;
const idleTimeoutMs = parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || String(defaultIdleTimeout), 10);

const defaultConnTimeout = 10000;
const connectionTimeoutMs = parseInt(process.env.DB_POOL_CONN_TIMEOUT_MS || String(defaultConnTimeout), 10);

const defaultStatementTimeout = 30000;
const statementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || String(defaultStatementTimeout), 10);

const basePool = new Pool({
  connectionString: mainConnString,
  connectionTimeoutMillis: connectionTimeoutMs,
  idleTimeoutMillis: idleTimeoutMs,
  max: poolMax,
  ssl: needsSsl ? sslConfig : undefined,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: !isProduction,
  statement_timeout: statementTimeoutMs,
});

logger.info(`[Database] Pool configured: max=${poolMax}, connectionTimeout=${connectionTimeoutMs}ms, idle=${idleTimeoutMs}ms, statementTimeout=${statementTimeoutMs}ms, env=${isProduction ? 'production' : 'development'}`);

let lastPoolWarnTime = 0;
const POOL_PRESSURE_THRESHOLD = 0.7;
basePool.on('connect', () => {
  const { totalCount, idleCount, waitingCount } = basePool;
  const activeCount = totalCount - idleCount;
  const now = Date.now();
  if ((waitingCount > 0 || activeCount >= Math.floor(poolMax * POOL_PRESSURE_THRESHOLD)) && now - lastPoolWarnTime > 5_000) {
    lastPoolWarnTime = now;
    const level = (waitingCount > 3 || activeCount >= poolMax) ? 'error' : 'warn';
    const label = level === 'error' ? '[Database] Pool exhaustion' : '[Database] Pool under pressure';
    logger[level](label, {
      extra: { total: totalCount, idle: idleCount, active: activeCount, waiting: waitingCount, max: poolMax, utilization: `${((activeCount / poolMax) * 100).toFixed(0)}%` },
    });
  }
});

// search_path is set via the connection string's `options` parameter (appendSearchPath).
// A previous `SET search_path` listener here was race-prone: pg doesn't await event
// listeners before returning the client, so business queries could run before the SET completed.

function recordQueryTiming(queryText: string, start: number): void {
  const durationMs = Date.now() - start;
  const pattern = sanitizeQueryPattern(queryText);
  recordQuery({ queryPattern: pattern, durationMs, timestamp: Date.now() });
  const threshold = getQuerySlowThreshold();
  if (durationMs >= threshold) {
    logger.warn(`[Perf] Slow query (${durationMs}ms, threshold: ${threshold}ms): ${pattern}`);
  }
}

function extractQueryText(firstArg: unknown): string {
  if (typeof firstArg === 'string') return firstArg;
  if (firstArg && typeof firstArg === 'object' && 'text' in firstArg) {
    return String((firstArg as { text: unknown }).text);
  }
  return '';
}

const CONNECTION_HOLD_WARN_MS = 10_000;
const CONNECTION_HOLD_ERROR_MS = 25_000;

interface CheckoutInfo {
  checkedOutAt: number;
  stack: string;
  warnedAt: number;
  erroredAt: number;
}

const activeCheckouts = new Map<PoolClient, CheckoutInfo>();
const trackedClients = new WeakMap<PoolClient, PoolClient['release']>();

function trackCheckout(client: PoolClient): void {
  const stack = new Error().stack?.split('\n').slice(2, 6).join('\n') || 'unknown';
  activeCheckouts.set(client, { checkedOutAt: Date.now(), stack, warnedAt: 0, erroredAt: 0 });

  const originalRelease = client.release.bind(client);
  const wrappedRelease: PoolClient['release'] = function trackedRelease(err?: boolean | Error) {
    activeCheckouts.delete(client);
    return originalRelease(err);
  };
  trackedClients.set(client, wrappedRelease);
  client.release = wrappedRelease;
}

const holdTimeWatchdogTimer = setInterval(() => {
  const now = Date.now();

  const poolActiveCount = (basePool.totalCount - basePool.idleCount)
    + (directPoolInstance !== basePool ? (directPoolInstance.totalCount - directPoolInstance.idleCount) : 0);
  if (activeCheckouts.size > poolActiveCount) {
    activeCheckouts.forEach((_info, client) => {
      if (client.release !== trackedClients.get(client)) {
        activeCheckouts.delete(client);
      }
    });
  }

  activeCheckouts.forEach((info) => {
    const holdMs = now - info.checkedOutAt;
    if (holdMs >= CONNECTION_HOLD_ERROR_MS && now - info.erroredAt > 30_000) {
      info.erroredAt = now;
      logger.error('[Database] Connection held too long — possible leak', {
        extra: { holdMs, stack: info.stack, activeCheckouts: activeCheckouts.size },
      });
    } else if (holdMs >= CONNECTION_HOLD_WARN_MS && info.warnedAt === 0) {
      info.warnedAt = now;
      logger.warn('[Database] Long-held connection detected', {
        extra: { holdMs, stack: info.stack, activeCheckouts: activeCheckouts.size },
      });
    }
  });
}, 5_000);
holdTimeWatchdogTimer.unref();

function createInstrumentedPool(targetPool: Pool): Pool {
  const originalConnect = targetPool.connect.bind(targetPool);
  const wrappedConnect: typeof targetPool.connect = function connect(
    callback?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => void
  ) {
    if (callback) {
      return originalConnect((err: Error | undefined, client: PoolClient | undefined, done: (release?: any) => void) => {
        if (!err && client) {
          trackCheckout(client);
          if (isPerformanceEnabled()) instrumentClient(client);
          const trackedDone = (release?: any) => {
            activeCheckouts.delete(client);
            done(release);
          };
          callback(err, client, trackedDone);
          return;
        }
        callback(err, client, done);
      });
    }
    return (originalConnect() as Promise<PoolClient>).then((client: PoolClient) => {
      trackCheckout(client);
      if (isPerformanceEnabled()) instrumentClient(client);
      return client;
    });
  } as typeof targetPool.connect;
  targetPool.connect = wrappedConnect;

  const originalQuery = targetPool.query.bind(targetPool);
  const wrappedQuery: typeof targetPool.query = function query(
    ...args: [unknown, ...unknown[]]
  ): ReturnType<typeof targetPool.query> {
    if (!isPerformanceEnabled()) {
      return (originalQuery as Function)(...args);
    }
    const queryText = extractQueryText(args[0]);
    const start = Date.now();
    const result = (originalQuery as Function)(...args);
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return (result as Promise<QueryResult>).then(
        (res: QueryResult) => {
          recordQueryTiming(queryText, start);
          return res;
        },
        (err: unknown) => {
          recordQueryTiming(queryText, start);
          throw err;
        }
      ) as unknown as ReturnType<typeof targetPool.query>;
    }
    return result;
  } as typeof targetPool.query;
  targetPool.query = wrappedQuery;

  return targetPool;
}

const instrumentedClients = new WeakSet<PoolClient>();

function instrumentClient(client: PoolClient): void {
  if (instrumentedClients.has(client)) return;
  instrumentedClients.add(client);

  const originalQuery = client.query.bind(client);
  const wrappedQuery: typeof client.query = function query(
    ...args: [unknown, ...unknown[]]
  ): ReturnType<typeof client.query> {
    if (!isPerformanceEnabled()) {
      return (originalQuery as Function)(...args);
    }
    const queryText = extractQueryText(args[0]);
    const start = Date.now();
    const result = (originalQuery as Function)(...args);
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return (result as Promise<QueryResult>).then(
        (res: QueryResult) => {
          recordQueryTiming(queryText, start);
          return res;
        },
        (err: unknown) => {
          recordQueryTiming(queryText, start);
          throw err;
        }
      ) as unknown as ReturnType<typeof client.query>;
    }
    return result;
  } as typeof client.query;
  client.query = wrappedQuery;
}

createInstrumentedPool(basePool);

export const pool = basePool;

const directConnectionUrl = (forcePoolerRedirect && poolerUrl) ? poolerUrl : directUrl;
const directConnString = appendSearchPath(directConnectionUrl);

const directPoolInstance = usingPooler
  ? new Pool({
      connectionString: directConnString,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
      max: 5,
      ssl: !isLocalDatabase(directConnectionUrl) ? sslConfig : undefined,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: true,
    })
  : pool;

// Direct pool also uses appendSearchPath in the connection string — no SET listener needed.

if (directPoolInstance !== basePool) {
  createInstrumentedPool(directPoolInstance);
}

export const directPool = directPoolInstance;

pool.on('error', (err) => {
  const errMsg = getErrorMessage(err);
  const isConnectionError = RETRYABLE_ERRORS.some(e => errMsg.includes(e));
  logger.error('[Database] Pool error:', {
    extra: {
      error: errMsg,
      isConnectionError,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
    },
  });
  if (isConnectionError) {
    logger.warn('[Database] Stale connection evicted from pool', {
      extra: { error: errMsg },
    });
  }
});

let poolConnectCount = 0;
pool.on('connect', () => {
  poolConnectCount++;
  if (poolConnectCount <= 5 || poolConnectCount % 100 === 0) {
    logger.info(`[Database] New client connected via ${usingPooler ? 'session pooler' : 'direct connection'} (total: ${poolConnectCount})`);
  }
});

if (usingPooler && directPool !== pool) {
  directPool.on('error', (err) => {
    const errMsg = getErrorMessage(err);
    const isConnError = RETRYABLE_ERRORS.some(e => errMsg.includes(e));
    logger.error('[Database] Direct pool error:', {
      extra: {
        error: errMsg,
        isConnectionError: isConnError,
        poolTotal: directPool.totalCount,
        poolIdle: directPool.idleCount,
        poolWaiting: directPool.waitingCount,
      },
    });
    if (isConnError) {
      logger.warn('[Database] Stale connection evicted from direct pool', {
        extra: { error: errMsg },
      });
    }
  });
}

function isRetryableError(error: unknown): boolean {
  return _isRetryableError(error);
}

export function isConstraintError(error: unknown): { type: 'unique' | 'foreign_key' | 'exclusion' | null, detail?: string } {
  const code = getErrorCode(error);
  const detail = getErrorDetail(error);
  if (code === '23505') return { type: 'unique', detail };
  if (code === '23503') return { type: 'foreign_key', detail };
  if (code === '23P01') return { type: 'exclusion', detail };
  return { type: null };
}

function isConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error);
  const connectionPatterns = [
    'Connection terminated',
    'connection terminated',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'socket hang up',
    'Connection refused',
  ];
  return connectionPatterns.some(p => message.includes(p));
}

function sanitizeQueryPattern(queryText: string): string {
  return queryText
    .replace(/\$\d+/g, '$?')
    .replace(/'[^']*'/g, "'?'")
    .replace(/\$\$[\s\S]*?\$\$/g, "'?'")
    .replace(/\b\d+\.?\d*\b/g, '?')
    .replace(/\b(true|false|null)\b/gi, '?')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export async function queryWithRetry<T extends QueryResultRow = Record<string, unknown>>(
  queryText: string,
  params?: unknown[],
  maxRetries: number = 3
): Promise<QueryResult<T>> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pool.query<T>(queryText, params);
    } catch (error: unknown) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
      logger.warn(`[Database] Retrying query (attempt ${attempt}/${maxRetries}) after ${delay}ms`, {
        extra: {
          errorMessage: getErrorMessage(error),
          isConnectionError: isConnectionError(error),
        },
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export async function queryWithRetryDirect<T extends QueryResultRow = Record<string, unknown>>(
  queryText: string,
  params?: unknown[],
  maxRetries: number = 3
): Promise<QueryResult<T>> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await directPool.query<T>(queryText, params);
    } catch (error: unknown) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
      logger.warn(`[Database] Retrying direct query (attempt ${attempt}/${maxRetries}) after ${delay}ms`, {
        extra: {
          errorMessage: getErrorMessage(error),
          isConnectionError: isConnectionError(error),
        },
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function getPoolStatus() {
  const active = pool.totalCount - pool.idleCount;
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    active,
    max: poolMax,
    checkedOut: activeCheckouts.size,
    utilization: poolMax > 0 ? `${((active / poolMax) * 100).toFixed(0)}%` : '0%',
  };
}

const POOL_MONITOR_INTERVAL_MS = 60_000;
const poolMonitorTimer = setInterval(() => {
  const { totalCount, idleCount, waitingCount } = basePool;
  const active = totalCount - idleCount;
  const utilization = poolMax > 0 ? ((active / poolMax) * 100).toFixed(1) : '0';
  logger.info('[Database] Pool utilization', {
    extra: { total: totalCount, idle: idleCount, active, waiting: waitingCount, max: poolMax, utilization: `${utilization}%`, checkedOut: activeCheckouts.size },
  });
  if (waitingCount > 0) {
    logger.warn('[Database] Clients waiting for connections', {
      extra: { waiting: waitingCount, active, max: poolMax, checkedOut: activeCheckouts.size },
    });
  }
}, POOL_MONITOR_INTERVAL_MS);
poolMonitorTimer.unref();

export function safeRelease(client: PoolClient): void {
  try {
    client.release();
  } catch {
    // Already released or pool destroyed — safe to ignore
  }
}

const DEFAULT_WITH_CONNECTION_TIMEOUT_MS = 15_000;

export async function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: { timeoutMs?: number; targetPool?: Pool }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WITH_CONNECTION_TIMEOUT_MS;
  const targetPool = options?.targetPool ?? pool;
  const client = await targetPool.connect();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let released = false;

  const release = (destroy?: boolean) => {
    if (!released) {
      released = true;
      if (timer) clearTimeout(timer);
      if (destroy) {
        try {
          client.release(new Error('Connection destroyed after timeout'));
        } catch {
          // Already released or pool destroyed — safe to ignore
        }
      } else {
        safeRelease(client);
      }
    }
  };

  try {
    const resultPromise = fn(client);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        release(true);
        reject(new Error(`[Database] withConnection timed out after ${timeoutMs}ms — connection forcibly released`));
      }, timeoutMs);
      timer.unref();
    });

    return await Promise.race([resultPromise, timeoutPromise]);
  } catch (error) {
    release();
    throw error;
  } finally {
    release();
  }
}
