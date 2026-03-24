import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { formatTime12Hour } from '../../utils/dateUtils';
import { getErrorMessage, getErrorCode } from '../../utils/errorUtils';
import { ACTIVE_BOOKING_STATUSES } from '../../../shared/constants/statuses';

function isUndefinedTableError(err: unknown): boolean {
  return getErrorCode(err) === '42P01';
}

type TxLike = { execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Record<string, unknown>[] }> };

async function queryWithSavepoint(
  tx: TxLike,
  savepointName: string,
  query: ReturnType<typeof sql>,
  logLabel: string,
): Promise<{ rows: Record<string, unknown>[] }> {
  try {
    await tx.execute(sql.raw(`SAVEPOINT ${savepointName}`));
    return await tx.execute(query);
  } catch (err: unknown) {
    try {
      await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`));
    } catch (rollbackErr: unknown) {
      logger.error(`[BookingGuard] ${logLabel}: ROLLBACK TO SAVEPOINT failed — transaction may be unrecoverable`, {
        extra: { rollbackError: getErrorMessage(rollbackErr), originalError: getErrorMessage(err) }
      });
      throw new BookingConflictError(503, { error: 'Unable to verify slot availability. Please try again.' });
    }
    if (isUndefinedTableError(err) && process.env.NODE_ENV !== 'production') {
      logger.warn(`[BookingGuard] ${logLabel}: table does not exist (42P01) — returning empty result (dev only)`);
      return { rows: [] };
    }
    logger.error(`[BookingGuard] Failed to check ${logLabel}`, { extra: { error: getErrorMessage(err) } });
    throw new BookingConflictError(503, { error: 'Unable to verify slot availability. Please try again.' });
  }
}

function formatTimeField(value: unknown): string | null {
  if (typeof value === 'string') return value.substring(0, 5);
  if (value instanceof Date) {
    const h = String(value.getHours()).padStart(2, '0');
    const m = String(value.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  return null;
}

function throwConflictError(conflict: Record<string, unknown>, contextMessage: string): never {
  const start = formatTimeField(conflict.start_time);
  const end = formatTimeField(conflict.end_time);

  if (start && end) {
    throw new BookingConflictError(409, {
      error: `This time slot conflicts with ${contextMessage} from ${formatTime12Hour(start)} to ${formatTime12Hour(end)}. Please choose a different time.`
    });
  }
  throw new BookingConflictError(409, { error: `This time slot conflicts with ${contextMessage}.` });
}

export class BookingConflictError extends Error {
  constructor(public statusCode: number, public errorBody: Record<string, unknown>) {
    super(typeof errorBody.error === 'string' ? errorBody.error : 'Booking conflict');
    this.name = 'BookingConflictError';
  }
}

interface BookingCreationGuardParams {
  resourceId: number | null;
  requestDate: string;
  startTime: string;
  endTime: string;
  requestEmail: string;
  isStaffRequest: boolean;
  isViewAsMode: boolean;
  resourceType: string;
}

const OCCUPIED_STATUSES = [...ACTIVE_BOOKING_STATUSES, 'checked_in', 'attended', 'cancellation_pending'];
const OCCUPIED_STATUS_ARRAY = `{${OCCUPIED_STATUSES.map(s => `"${s}"`).join(',')}}`;


export async function acquireBookingLocks(
  tx: { execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }> },
  params: BookingCreationGuardParams
): Promise<void> {
  const { resourceId, requestDate, requestEmail, isStaffRequest, isViewAsMode, resourceType } = params;

  const normalizedEmail = requestEmail.trim().toLowerCase();
  const needsUserLock = !isStaffRequest || isViewAsMode;

  if (resourceId) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('resource' || ${String(resourceId)}), hashtext(${requestDate}))`);
    logger.debug('[BookingGuard] Acquired resource lock', { extra: { resourceId, requestDate } });
  }

  if (needsUserLock) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('user'), hashtext(${normalizedEmail}))`);
    logger.debug('[BookingGuard] Acquired user lock', { extra: { email: normalizedEmail } });
  }

  const pendingLimit = resourceType === 'conference_room' ? 5 : 1;
  if (needsUserLock) {
    const pendingCheck = await tx.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM booking_requests
      WHERE LOWER(user_email) = ${normalizedEmail} AND status IN ('pending', 'pending_approval')
    `);
    if ((pendingCheck.rows[0] as Record<string, unknown>).cnt as number >= pendingLimit) {
      throw new BookingConflictError(409, {
        error: resourceType === 'conference_room'
          ? 'You have too many pending conference room requests. Please wait for some to be processed before submitting more.'
          : 'You already have a pending request. Please wait for it to be approved or denied before requesting another slot.'
      });
    }
  }
}

export async function checkResourceOverlap(
  tx: { execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }> },
  params: Pick<BookingCreationGuardParams, 'resourceId' | 'requestDate' | 'startTime' | 'endTime'>
): Promise<void> {
  const { resourceId, requestDate, startTime, endTime } = params;

  if (!resourceId) return;

  try {
    const overlapCheck = await tx.execute(sql`
      SELECT id, start_time, end_time FROM booking_requests 
      WHERE resource_id = ${resourceId} 
      AND request_date = ${requestDate} 
      AND status = ANY(${OCCUPIED_STATUS_ARRAY}::text[])
      AND start_time < ${endTime} AND end_time > ${startTime}
      ORDER BY id ASC
      FOR UPDATE
    `);

    if (overlapCheck.rows.length > 0) {
      throwConflictError(overlapCheck.rows[0] as Record<string, unknown>, 'an existing booking');
    }
  } catch (err: unknown) {
    if (err instanceof BookingConflictError) throw err;
    logger.error('[BookingGuard] Failed to check booking_requests overlap', { extra: { error: getErrorMessage(err) } });
    throw new BookingConflictError(503, { error: 'Unable to verify slot availability. Please try again.' });
  }

  const trackmanBayCheck = await queryWithSavepoint(
    tx as unknown as TxLike,
    'trackman_bay_check',
    sql`SELECT resource_id, start_time, end_time FROM trackman_bay_slots
      WHERE resource_id = ${resourceId}
      AND slot_date = ${requestDate}
      AND status = 'booked'
      AND start_time < ${endTime} AND end_time > ${startTime}
      ORDER BY start_time ASC
      LIMIT 1`,
    'trackman_bay_slots',
  );

  if (trackmanBayCheck.rows.length > 0) {
    throwConflictError(trackmanBayCheck.rows[0] as Record<string, unknown>, 'a Trackman booking');
  }

  const resourceIdStr = String(resourceId);
  const unmatchedCheck = await queryWithSavepoint(
    tx as unknown as TxLike,
    'trackman_unmatched_check',
    sql`SELECT tub.bay_number, tub.start_time, tub.end_time FROM trackman_unmatched_bookings tub
      WHERE tub.bay_number = ${resourceIdStr}
      AND tub.booking_date = ${requestDate}
      AND tub.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM booking_requests br
        WHERE br.trackman_booking_id = tub.trackman_booking_id::text
      )
      AND tub.start_time < ${endTime} AND tub.end_time > ${startTime}
      ORDER BY tub.start_time ASC
      LIMIT 1`,
    'trackman_unmatched_bookings',
  );

  if (unmatchedCheck.rows.length > 0) {
    throwConflictError(unmatchedCheck.rows[0] as Record<string, unknown>, 'an unresolved Trackman booking');
  }

  const sessionCheck = await queryWithSavepoint(
    tx as unknown as TxLike,
    'session_check',
    sql`SELECT bs.id, bs.start_time, bs.end_time FROM booking_sessions bs
      WHERE bs.resource_id = ${resourceId}
      AND bs.session_date = ${requestDate}
      AND bs.start_time < ${endTime} AND bs.end_time > ${startTime}
      AND EXISTS (
        SELECT 1 FROM booking_requests br
        WHERE br.session_id = bs.id
        AND br.status NOT IN ('cancelled', 'deleted', 'declined')
      )
      ORDER BY bs.start_time ASC
      LIMIT 1`,
    'booking_sessions',
  );

  if (sessionCheck.rows.length > 0) {
    throwConflictError(sessionCheck.rows[0] as Record<string, unknown>, 'an active session');
  }
}
