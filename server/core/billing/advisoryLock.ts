import { pool, safeRelease } from '../db';
import { logger } from '../logger';
import { getErrorMessage, getErrorCode } from '../../utils/errorUtils';

const LOCK_TIMEOUT_MS = 5000;
const SQLSTATE_LOCK_NOT_AVAILABLE = '55P03';

export async function withMemberDayLock<T>(
  memberEmail: string,
  date: string,
  callback: () => Promise<T>
): Promise<{ success: true; result: T } | { success: false; reason: 'timeout' }> {
  const lockKey = `fee_cascade::${memberEmail.toLowerCase()}::${date}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    try {
      const result = await callback();
      await client.query('COMMIT');
      return { success: true, result };
    } catch (callbackErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw callbackErr;
    }
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const code = getErrorCode(err);
    if (code === SQLSTATE_LOCK_NOT_AVAILABLE) {
      logger.warn('[AdvisoryLock] Timed out acquiring member-day lock — skipping cascade', {
        extra: { lockKey, timeoutMs: LOCK_TIMEOUT_MS },
      });
      return { success: false, reason: 'timeout' };
    }
    throw err;
  } finally {
    safeRelease(client);
  }
}
