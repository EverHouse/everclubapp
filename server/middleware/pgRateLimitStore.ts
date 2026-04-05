import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { pool } from '../core/db';
import { db } from '../db';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

let tablePromise: Promise<void> | null = null;
let tableReady = false;
let lastTableAttempt = 0;
const TABLE_RETRY_INTERVAL_MS = 60_000;

function ensureTable(): Promise<void> {
  if (tableReady) return Promise.resolve();
  const now = Date.now();
  if (lastTableAttempt && now - lastTableAttempt < TABLE_RETRY_INTERVAL_MS) {
    return Promise.resolve();
  }
  if (!tablePromise) {
    lastTableAttempt = now;
    tablePromise = (async () => {
      try {
        const exists = await db.execute<{ oid: string | null }>(sql`
          SELECT to_regclass('public.rate_limit_hits') AS oid
        `);
        if (!exists.rows[0]?.oid) {
          await db.execute(sql`
            CREATE TABLE IF NOT EXISTS rate_limit_hits (
              key TEXT NOT NULL,
              window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              hits INTEGER NOT NULL DEFAULT 1,
              PRIMARY KEY (key)
            )
          `);
        }
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_window ON rate_limit_hits (window_start)
        `);
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_prefix ON rate_limit_hits (key text_pattern_ops)
        `);
        await db.execute(sql`
          CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_window ON rate_limit_hits (key text_pattern_ops, window_start)
        `);
        tableReady = true;
      } catch (err) {
        const msg = getErrorMessage(err);
        if (!msg.includes('already exists')) {
          logger.error('[PgRateLimitStore] Failed to ensure table (will retry in 60s)', { extra: { error: msg } });
        } else {
          tableReady = true;
        }
        tablePromise = null;
      }
    })();
  }
  return tablePromise;
}

interface MemEntry {
  hits: number;
  windowStart: number;
}

const MAX_MEM_ENTRIES = 10_000;

export class PgRateLimitStore implements Store {
  private windowMs: number = 60_000;
  prefix: string;
  localKeys = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupRunning = false;
  private mem = new Map<string, MemEntry>();

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private static instanceCount = 0;

  init(options: Options): void {
    this.windowMs = options.windowMs;
    ensureTable();
    const instanceIndex = PgRateLimitStore.instanceCount++;
    const jitter = instanceIndex * 7_000;
    const interval = Math.max(this.windowMs, 60_000);
    const startupTimer = setTimeout(() => {
      this.cleanupInterval = setInterval(() => {
        if (this.cleanupRunning) return;
        this.cleanup().catch((err) => {
          logger.warn('[PgRateLimitStore] Scheduled cleanup failed', { extra: { error: getErrorMessage(err) } });
        });
      }, interval);
      this.cleanupInterval.unref();
      this.cleanup().catch(() => {});
    }, jitter);
    startupTimer.unref();
  }

  async increment(key: string): Promise<IncrementResponse> {
    const prefixed = this.prefixedKey(key);
    const now = Date.now();
    const windowCutoff = now - this.windowMs;

    const existing = this.mem.get(prefixed);
    let hits: number;
    let windowStart: number;

    if (existing && existing.windowStart >= windowCutoff) {
      existing.hits += 1;
      hits = existing.hits;
      windowStart = existing.windowStart;
    } else {
      hits = 1;
      windowStart = now;
      this.mem.set(prefixed, { hits: 1, windowStart: now });
      if (this.mem.size > MAX_MEM_ENTRIES) {
        const iter = this.mem.keys();
        const oldest = iter.next().value;
        if (oldest) this.mem.delete(oldest);
      }
    }

    return {
      totalHits: hits,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const prefixed = this.prefixedKey(key);
    const existing = this.mem.get(prefixed);
    if (existing && existing.hits > 0) {
      existing.hits -= 1;
    }
  }

  async resetKey(key: string): Promise<void> {
    const prefixed = this.prefixedKey(key);
    this.mem.delete(prefixed);
  }

  async resetAll(): Promise<void> {
    const prefix = `${this.prefix}:`;
    for (const k of this.mem.keys()) {
      if (k.startsWith(prefix)) {
        this.mem.delete(k);
      }
    }
  }

  private async cleanup(): Promise<void> {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      const cutoff = Date.now() - this.windowMs * 2;
      for (const [k, v] of this.mem) {
        if (v.windowStart < cutoff) {
          this.mem.delete(k);
        }
      }

      const p = pool as unknown as Pool;
      const activeCount = p.totalCount - p.idleCount;
      const poolMax = (pool as unknown as { options?: { max?: number } }).options?.max || 25;
      if (p.waitingCount > 0 || activeCount >= poolMax * 0.8) {
        return;
      }
      const dbCutoff = new Date(Date.now() - this.windowMs * 2);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '5000'`);
        await client.query(
          `DELETE FROM rate_limit_hits WHERE key LIKE $1 AND window_start < $2`,
          [`${this.prefix}:%`, dbCutoff]
        );
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      logger.warn('[PgRateLimitStore] cleanup failed', { extra: { error: getErrorMessage(err) } });
    } finally {
      this.cleanupRunning = false;
    }
  }
}
