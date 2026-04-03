import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';
import { getErrorCode, getErrorDetail, getErrorMessage } from '../utils/errorUtils';

interface SessionStatsRow {
  total: string;
  active: string;
  expired: string;
  oldest_active: string | null;
  newest_active: string | null;
}

function isTableMissingError(error: unknown): boolean {
  return getErrorCode(error) === '42P01';
}

async function attemptCleanup(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM sessions 
    WHERE expire < NOW()
    RETURNING sid
  `);
  return result.rowCount || 0;
}

export async function cleanupExpiredSessions(): Promise<number> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const deletedCount = await attemptCleanup();

      if (deletedCount > 0) {
        logger.info(`[SessionCleanup] Removed ${deletedCount} expired sessions`, {
          extra: { event: 'session.cleanup', count: deletedCount }
        });
      }

      return deletedCount;
    } catch (error: unknown) {
      if (isTableMissingError(error)) {
        return 0;
      }
      if (attempt < maxRetries) {
        const delay = (attempt + 1) * 1000;
        logger.warn(`[SessionCleanup] Cleanup attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
          extra: {
            error: getErrorMessage(error),
            code: getErrorCode(error),
            attempt: attempt + 1,
            event: 'session.cleanup_retry',
          },
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      logger.error('[SessionCleanup] Failed to cleanup sessions after retries', {
        extra: {
          error: getErrorMessage(error),
          code: getErrorCode(error),
          detail: getErrorDetail(error),
          attempts: maxRetries + 1,
          event: 'session.cleanup_failed',
        },
      });
      return 0;
    }
  }
  return 0;
}

export async function getSessionStats(): Promise<{
  total: number;
  active: number;
  expired: number;
  oldestActive: Date | null;
  newestActive: Date | null;
}> {
  try {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expire > NOW()) as active,
        COUNT(*) FILTER (WHERE expire <= NOW()) as expired,
        MIN(expire) FILTER (WHERE expire > NOW()) as oldest_active,
        MAX(expire) FILTER (WHERE expire > NOW()) as newest_active
      FROM sessions
    `);
    
    const row = result.rows[0] as unknown as SessionStatsRow;
    
    return {
      total: parseInt(String(row.total), 10) || 0,
      active: parseInt(String(row.active), 10) || 0,
      expired: parseInt(String(row.expired), 10) || 0,
      oldestActive: row.oldest_active ? new Date(String(row.oldest_active)) : null,
      newestActive: row.newest_active ? new Date(String(row.newest_active)) : null,
    };
  } catch (error: unknown) {
    if (isTableMissingError(error)) {
      return { total: 0, active: 0, expired: 0, oldestActive: null, newestActive: null };
    }
    logger.error('[SessionCleanup] Failed to get session stats', {
      extra: {
        error: getErrorMessage(error),
        code: getErrorCode(error),
        detail: getErrorDetail(error),
        event: 'session.stats_failed',
      },
    });
    return { total: 0, active: 0, expired: 0, oldestActive: null, newestActive: null };
  }
}

export async function runSessionCleanup(): Promise<void> {
  logger.info('[SessionCleanup] Starting scheduled session cleanup', {
    extra: { event: 'session.cleanup_start' }
  });
  
  try {
    const beforeStats = await getSessionStats();
    const deleted = await cleanupExpiredSessions();
    const afterStats = await getSessionStats();
    
    logger.info('[SessionCleanup] Session cleanup completed', {
      extra: { 
        event: 'session.cleanup_complete',
        deleted,
        beforeTotal: beforeStats.total,
        afterTotal: afterStats.total,
        activeRemaining: afterStats.active
      }
    });
  } catch (error: unknown) {
    logger.error('[SessionCleanup] Scheduled cleanup failed', {
      extra: {
        error: getErrorMessage(error),
        code: getErrorCode(error),
        detail: getErrorDetail(error),
        event: 'session.cleanup_failed',
      },
    });
  }
}
