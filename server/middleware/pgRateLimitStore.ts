import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import type { Pool } from 'pg';
import { pool } from '../core/db';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

let tablePromise: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tablePromise) {
    tablePromise = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS rate_limit_hits (
            key TEXT NOT NULL,
            window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            hits INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (key)
          )
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_window ON rate_limit_hits (window_start)
        `);
      } catch (err) {
        const msg = getErrorMessage(err);
        if (!msg.includes('already exists')) {
          logger.error('[PgRateLimitStore] Failed to ensure table', { extra: { error: msg } });
        }
        tablePromise = null;
      }
    })();
  }
  return tablePromise;
}

export class PgRateLimitStore implements Store {
  private windowMs: number = 60_000;
  prefix: string;
  localKeys = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupRunning = false;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    ensureTable();
    this.cleanupInterval = setInterval(() => {
      if (this.cleanupRunning) return;
      this.cleanup().catch((err) => {
        logger.warn('[PgRateLimitStore] Scheduled cleanup failed', { extra: { error: getErrorMessage(err) } });
      });
    }, Math.max(this.windowMs, 60_000));
    this.cleanupInterval.unref();
  }

  async increment(key: string): Promise<IncrementResponse> {
    await ensureTable();
    const prefixed = this.prefixedKey(key);
    const windowStart = new Date(Date.now() - this.windowMs);

    try {
      const result = await pool.query(
        `INSERT INTO rate_limit_hits (key, hits, window_start)
         VALUES ($1, 1, NOW())
         ON CONFLICT (key) DO UPDATE
         SET hits = CASE
           WHEN rate_limit_hits.window_start < $2 THEN 1
           ELSE rate_limit_hits.hits + 1
         END,
         window_start = CASE
           WHEN rate_limit_hits.window_start < $2 THEN NOW()
           ELSE rate_limit_hits.window_start
         END
         RETURNING hits, window_start`,
        [prefixed, windowStart]
      );

      const row = result.rows[0] as { hits: number; window_start: Date };
      return {
        totalHits: row.hits,
        resetTime: new Date((row.window_start as Date).getTime() + this.windowMs),
      };
    } catch (err) {
      logger.error('[PgRateLimitStore] increment failed, blocking as precaution', { extra: { error: getErrorMessage(err) } });
      return { totalHits: Infinity, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    const prefixed = this.prefixedKey(key);
    try {
      await pool.query(
        `UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`,
        [prefixed]
      );
    } catch (err: unknown) {
      logger.warn('[PgRateLimitStore] decrement failed', { extra: { error: getErrorMessage(err) } });
    }
  }

  async resetKey(key: string): Promise<void> {
    const prefixed = this.prefixedKey(key);
    try {
      await pool.query(`DELETE FROM rate_limit_hits WHERE key = $1`, [prefixed]);
    } catch (err: unknown) {
      logger.warn('[PgRateLimitStore] resetKey failed', { extra: { error: getErrorMessage(err) } });
    }
  }

  async resetAll(): Promise<void> {
    try {
      await pool.query(`DELETE FROM rate_limit_hits WHERE key LIKE $1`, [`${this.prefix}:%`]);
    } catch (err: unknown) {
      logger.warn('[PgRateLimitStore] resetAll failed', { extra: { error: getErrorMessage(err) } });
    }
  }

  private async cleanup(): Promise<void> {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    const cutoff = new Date(Date.now() - this.windowMs * 2);
    try {
      const p = pool as unknown as Pool;
      const activeCount = p.totalCount - p.idleCount;
      const poolMax = (pool as unknown as { options?: { max?: number } }).options?.max || 25;
      if (p.waitingCount > 0 || activeCount >= poolMax * 0.8) {
        logger.debug('[PgRateLimitStore] Skipping cleanup — pool under pressure', {
          extra: { waitingCount: p.waitingCount, idle: p.idleCount, active: activeCount, max: poolMax }
        });
        return;
      }
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL statement_timeout = '5000'`);
            await client.query(
              `DELETE FROM rate_limit_hits WHERE key LIKE $1 AND window_start < $2`,
              [`${this.prefix}:%`, cutoff]
            );
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK').catch((rollbackErr) => {
              logger.warn('[PgRateLimitStore] Rollback failed during cleanup', { extra: { error: getErrorMessage(rollbackErr) } });
            });
            throw txErr;
          } finally {
            client.release();
          }
          break;
        } catch (err: unknown) {
          const errMsg = getErrorMessage(err);
          const isRetryable = errMsg.includes('timeout') || errMsg.includes('ECONNRESET') ||
            errMsg.includes('connection') || errMsg.includes('ETIMEDOUT');
          if (!isRetryable || attempt === maxAttempts) {
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
    } catch (err: unknown) {
      logger.warn('[PgRateLimitStore] cleanup failed', { extra: { error: getErrorMessage(err) } });
    } finally {
      this.cleanupRunning = false;
    }
  }
}
