import { db } from '../db';
import { facilityClosures, bookingRequests, availabilityBlocks } from '../../shared/schema';
import { eq, and, or, sql } from 'drizzle-orm';
import { parseAffectedAreasBatch } from './affectedAreas';
import { logger } from './logger';
import { getErrorMessage, getErrorCode } from '../utils/errorUtils';

function validateTimeParams(startTime: string, endTime: string): void {
  if (!startTime || !endTime) {
    throw new Error(`Missing required time parameters: startTime="${startTime}", endTime="${endTime}"`);
  }
}

interface ClosureCacheEntry {
  closures: Record<string, unknown>[];
  expiry: number;
}

const closureCache = new Map<string, ClosureCacheEntry>();
const MAX_CACHE_SIZE = 1000;
const CLOSURE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CLOSURE_CACHE_PRUNE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const pruneInterval = setInterval(() => {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of closureCache) {
    if (entry.expiry <= now) {
      closureCache.delete(key);
      pruned++;
    }
  }
  if (pruned > 0) {
    logger.info(`[Cache] Pruned ${pruned} expired closure cache entries (${closureCache.size} remaining)`);
  }
}, CLOSURE_CACHE_PRUNE_INTERVAL_MS);
pruneInterval.unref();

export function clearClosureCache(): void {
  closureCache.clear();
  logger.info('[Cache] Closure cache cleared');
}

export function parseTimeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const parts = time.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid time format: "${time}" (expected HH:MM)`);
  }
  const nums = parts.map(Number);
  if (nums.some(p => isNaN(p))) {
    throw new Error(`Invalid time format: "${time}" (non-numeric components)`);
  }
  const [hours, minutes] = nums;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time format: "${time}" (out of range)`);
  }
  return hours * 60 + minutes;
}

export function hasTimeOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  const normalizedEnd1 = start1 > end1 ? end1 + 1440 : end1;
  const normalizedEnd2 = start2 > end2 ? end2 + 1440 : end2;

  const overlapsNormal = Math.max(start1, start2) < Math.min(normalizedEnd1, normalizedEnd2);

  if (start1 > end1 && start2 <= end2) {
    return overlapsNormal || (start2 < end1);
  }
  if (start2 > end2 && start1 <= end1) {
    return overlapsNormal || (start1 < end2);
  }

  return overlapsNormal;
}

async function getActiveClosuresForDate(bookingDate: string, txClient?: { select: typeof db.select, execute: typeof db.execute }): Promise<Record<string, unknown>[]> {
  if (txClient) {
    return await txClient
      .select()
      .from(facilityClosures)
      .where(and(
        eq(facilityClosures.isActive, true),
        sql`${facilityClosures.startDate} <= ${bookingDate}`,
        sql`${facilityClosures.endDate} >= ${bookingDate}`
      ));
  }

  const cacheKey = `closures_${bookingDate}`;
  const cached = closureCache.get(cacheKey);
  
  if (cached && cached.expiry > Date.now()) {
    return cached.closures;
  }
  
  const closures = await db
    .select()
    .from(facilityClosures)
    .where(and(
      eq(facilityClosures.isActive, true),
      sql`${facilityClosures.startDate} <= ${bookingDate}`,
      sql`${facilityClosures.endDate} >= ${bookingDate}`
    ));
  
  if (closureCache.size >= MAX_CACHE_SIZE) {
    const firstKey = closureCache.keys().next().value;
    if (firstKey) closureCache.delete(firstKey);
  }

  closureCache.set(cacheKey, {
    closures,
    expiry: Date.now() + CLOSURE_CACHE_TTL_MS
  });
  
  return closures;
}

export async function checkClosureConflict(
  resourceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  txClient?: { select: typeof db.select, execute: typeof db.execute }
): Promise<{ hasConflict: boolean; closureTitle?: string }> {
  try {
    validateTimeParams(startTime, endTime);
    const activeClosures = await getActiveClosuresForDate(bookingDate, txClient);

    const bookingStartMinutes = parseTimeToMinutes(startTime);
    const bookingEndMinutes = parseTimeToMinutes(endTime);

    const allAffectedIds = await parseAffectedAreasBatch(
      activeClosures.map(c => (c.affectedAreas as string | null) ?? null)
    );

    for (let i = 0; i < activeClosures.length; i++) {
      const closure = activeClosures[i];
      const affectedResourceIds = allAffectedIds[i];

      if (!affectedResourceIds.map(Number).includes(resourceId)) continue;

      if (!closure.startTime && !closure.endTime) {
        return { hasConflict: true, closureTitle: (closure.title as string) || 'Facility Closure' };
      }

      let effectiveStartMinutes: number;
      let effectiveEndMinutes: number;

      try {
        const closureStartDate = (closure.startDate as string);
        const closureEndDate = (closure.endDate as string);
        const isStartDate = bookingDate === closureStartDate;
        const isEndDate = bookingDate === closureEndDate;
        const isIntermediateDay = !isStartDate && !isEndDate;

        if (isIntermediateDay) {
          effectiveStartMinutes = 0;
          effectiveEndMinutes = 24 * 60;
        } else if (isStartDate && isEndDate) {
          effectiveStartMinutes = closure.startTime ? parseTimeToMinutes(closure.startTime as string) : 0;
          effectiveEndMinutes = closure.endTime ? parseTimeToMinutes(closure.endTime as string) : 24 * 60;
          if (effectiveEndMinutes === 0 && closure.endTime) {
            effectiveEndMinutes = 24 * 60;
          }
        } else if (isStartDate) {
          effectiveStartMinutes = closure.startTime ? parseTimeToMinutes(closure.startTime as string) : 0;
          effectiveEndMinutes = 24 * 60;
        } else {
          effectiveStartMinutes = 0;
          effectiveEndMinutes = closure.endTime ? parseTimeToMinutes(closure.endTime as string) : 24 * 60;
          if (effectiveEndMinutes === 0 && closure.endTime) {
            effectiveEndMinutes = 24 * 60;
          }
        }
      } catch (parseErr) {
        logger.warn('[checkClosureConflict] Malformed closure time data, treating as full-day closure', {
          closureId: closure.id,
          startTime: closure.startTime,
          endTime: closure.endTime,
          error: getErrorMessage(parseErr)
        });
        effectiveStartMinutes = 0;
        effectiveEndMinutes = 24 * 60;
      }

      if (hasTimeOverlap(bookingStartMinutes, bookingEndMinutes, effectiveStartMinutes, effectiveEndMinutes)) {
        return { hasConflict: true, closureTitle: (closure.title as string) || 'Facility Closure' };
      }
    }

    return { hasConflict: false };
  } catch (error: unknown) {
    logger.error('[checkClosureConflict] Error checking closure conflict:', { error: new Error(getErrorMessage(error)) });
    throw error;
  }
}

export async function checkBookingConflict(
  resourceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: number,
  txClient?: { select: typeof db.select, execute: typeof db.execute }
): Promise<{ hasConflict: boolean; conflictingBooking?: Record<string, unknown>; conflictSource?: string }> {
  try {
    validateTimeParams(startTime, endTime);
    const dbCtx = txClient || db;
    const conditions = [
      eq(bookingRequests.resourceId, resourceId),
      sql`${bookingRequests.requestDate} = ${bookingDate}`,
      or(
        eq(bookingRequests.status, 'pending'),
        eq(bookingRequests.status, 'confirmed'),
        eq(bookingRequests.status, 'approved'),
        eq(bookingRequests.status, 'pending_approval'),
        eq(bookingRequests.status, 'checked_in'),
        eq(bookingRequests.status, 'attended'),
        eq(bookingRequests.status, 'cancellation_pending')
      ),
      sql`(CASE
        WHEN ${bookingRequests.startTime}::time > ${bookingRequests.endTime}::time AND ${startTime}::time > ${endTime}::time THEN true
        WHEN ${bookingRequests.startTime}::time > ${bookingRequests.endTime}::time THEN (${bookingRequests.startTime}::time < ${endTime}::time OR ${bookingRequests.endTime}::time > ${startTime}::time)
        WHEN ${startTime}::time > ${endTime}::time THEN (${startTime}::time < ${bookingRequests.endTime}::time OR ${endTime}::time > ${bookingRequests.startTime}::time)
        ELSE (${bookingRequests.startTime}::time < ${endTime}::time AND ${bookingRequests.endTime}::time > ${startTime}::time)
      END)`
    ];

    if (excludeBookingId) {
      conditions.push(sql`${bookingRequests.id} != ${excludeBookingId}`);
    }

    const existingBookings = await dbCtx
      .select()
      .from(bookingRequests)
      .where(and(...conditions));

    const conflicts = existingBookings;

    if (conflicts.length > 0) {
      return { hasConflict: true, conflictingBooking: conflicts[0], conflictSource: 'booking_request' };
    }

    try {
      const trackmanBayResult = await dbCtx.execute(sql`
        SELECT resource_id, start_time, end_time FROM trackman_bay_slots
        WHERE resource_id = ${resourceId}
        AND slot_date = ${bookingDate}
        AND status = 'booked'
        AND (CASE
          WHEN start_time > end_time AND ${startTime}::time > ${endTime}::time THEN true
          WHEN start_time > end_time THEN (start_time < ${endTime}::time OR end_time > ${startTime}::time)
          WHEN ${startTime}::time > ${endTime}::time THEN (${startTime}::time < end_time OR ${endTime}::time > start_time)
          ELSE (start_time < ${endTime}::time AND end_time > ${startTime}::time)
        END)
        LIMIT 1
      `);
      if (trackmanBayResult.rows.length > 0) {
        return { hasConflict: true, conflictingBooking: trackmanBayResult.rows[0] as Record<string, unknown>, conflictSource: 'trackman_bay_slot' };
      }
    } catch (err: unknown) {
      logger.error('[checkBookingConflict] Failed to check trackman_bay_slots', { error: err instanceof Error ? err : new Error(String(err)) });
      if (getErrorCode(err) !== '42P01') {
        throw err;
      }
      return { hasConflict: true, conflictingBooking: undefined, conflictSource: 'trackman_bay_slot_unavailable' };
    }

    const resourceIdStr = String(resourceId);
    try {
      const unmatchedResult = await dbCtx.execute(sql`
        SELECT tub.bay_number, tub.start_time, tub.end_time FROM trackman_unmatched_bookings tub
        WHERE tub.bay_number = ${resourceIdStr}
        AND tub.booking_date = ${bookingDate}
        AND tub.resolved_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM booking_requests br
          WHERE br.trackman_booking_id = tub.trackman_booking_id::text
        )
        AND (CASE
          WHEN tub.start_time > tub.end_time AND ${startTime}::time > ${endTime}::time THEN true
          WHEN tub.start_time > tub.end_time THEN (tub.start_time < ${endTime}::time OR tub.end_time > ${startTime}::time)
          WHEN ${startTime}::time > ${endTime}::time THEN (${startTime}::time < tub.end_time OR ${endTime}::time > tub.start_time)
          ELSE (tub.start_time < ${endTime}::time AND tub.end_time > ${startTime}::time)
        END)
        LIMIT 1
      `);
      if (unmatchedResult.rows.length > 0) {
        return { hasConflict: true, conflictingBooking: unmatchedResult.rows[0] as Record<string, unknown>, conflictSource: 'trackman_unmatched' };
      }
    } catch (err: unknown) {
      logger.error('[checkBookingConflict] Failed to check trackman_unmatched_bookings', { error: err instanceof Error ? err : new Error(String(err)) });
      if (getErrorCode(err) !== '42P01') {
        throw err;
      }
      return { hasConflict: true, conflictingBooking: undefined, conflictSource: 'trackman_unmatched_unavailable' };
    }

    try {
      const sessionResult = await dbCtx.execute(sql`
        SELECT bs.id, bs.start_time, bs.end_time FROM booking_sessions bs
        WHERE bs.resource_id = ${resourceId}
        AND bs.session_date = ${bookingDate}
        AND (CASE
          WHEN bs.start_time > bs.end_time AND ${startTime}::time > ${endTime}::time THEN true
          WHEN bs.start_time > bs.end_time THEN (bs.start_time < ${endTime}::time OR bs.end_time > ${startTime}::time)
          WHEN ${startTime}::time > ${endTime}::time THEN (${startTime}::time < bs.end_time OR ${endTime}::time > bs.start_time)
          ELSE (bs.start_time < ${endTime}::time AND bs.end_time > ${startTime}::time)
        END)
        AND EXISTS (
          SELECT 1 FROM booking_requests br
          WHERE br.session_id = bs.id
          AND br.status NOT IN ('cancelled', 'deleted', 'declined')
        )
        LIMIT 1
      `);
      if (sessionResult.rows.length > 0) {
        return { hasConflict: true, conflictingBooking: sessionResult.rows[0] as Record<string, unknown>, conflictSource: 'booking_session' };
      }
    } catch (err: unknown) {
      logger.error('[checkBookingConflict] Failed to check booking_sessions', { error: err instanceof Error ? err : new Error(String(err)) });
      if (getErrorCode(err) !== '42P01') {
        throw err;
      }
      return { hasConflict: true, conflictingBooking: undefined, conflictSource: 'booking_session_unavailable' };
    }

    return { hasConflict: false };
  } catch (error: unknown) {
    logger.error('[checkBookingConflict] Error checking booking conflict:', { error: new Error(getErrorMessage(error)) });
    throw error;
  }
}

export async function checkAvailabilityBlockConflict(
  resourceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  txClient?: { select: typeof db.select, execute: typeof db.execute }
): Promise<{ hasConflict: boolean; blockType?: string; blockNotes?: string }> {
  try {
    validateTimeParams(startTime, endTime);
    const dbCtx = txClient || db;
    const blocks = await dbCtx
      .select()
      .from(availabilityBlocks)
      .where(and(
        eq(availabilityBlocks.resourceId, resourceId),
        sql`${availabilityBlocks.blockDate} = ${bookingDate}`,
        sql`(CASE
          WHEN ${availabilityBlocks.startTime}::time > ${availabilityBlocks.endTime}::time AND ${startTime}::time > ${endTime}::time THEN true
          WHEN ${availabilityBlocks.startTime}::time > ${availabilityBlocks.endTime}::time THEN (${availabilityBlocks.startTime}::time < ${endTime}::time OR ${availabilityBlocks.endTime}::time > ${startTime}::time)
          WHEN ${startTime}::time > ${endTime}::time THEN (${startTime}::time < ${availabilityBlocks.endTime}::time OR ${endTime}::time > ${availabilityBlocks.startTime}::time)
          ELSE (${availabilityBlocks.startTime}::time < ${endTime}::time AND ${availabilityBlocks.endTime}::time > ${startTime}::time)
        END)`
      ));

    if (blocks.length > 0) {
      const block = blocks[0];
      return { 
        hasConflict: true, 
        blockType: block.blockType || 'Event Block',
        blockNotes: block.notes || undefined
      };
    }

    return { hasConflict: false };
  } catch (error: unknown) {
    logger.error('[checkAvailabilityBlockConflict] Error checking availability block conflict:', { error: new Error(getErrorMessage(error)) });
    throw error;
  }
}

export async function checkAllConflicts(
  resourceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: number,
  txClient?: { select: typeof db.select, execute: typeof db.execute }
): Promise<{ hasConflict: boolean; conflictType?: 'closure' | 'availability_block' | 'booking'; conflictTitle?: string }> {
  const closureCheck = await checkClosureConflict(resourceId, bookingDate, startTime, endTime, txClient);
  if (closureCheck.hasConflict) {
    return { hasConflict: true, conflictType: 'closure', conflictTitle: closureCheck.closureTitle || 'Facility Closure' };
  }

  const blockCheck = await checkAvailabilityBlockConflict(resourceId, bookingDate, startTime, endTime, txClient);
  if (blockCheck.hasConflict) {
    return { hasConflict: true, conflictType: 'availability_block', conflictTitle: blockCheck.blockType || 'Event Block' };
  }

  const bookingCheck = await checkBookingConflict(resourceId, bookingDate, startTime, endTime, excludeBookingId, txClient);
  if (bookingCheck.hasConflict) {
    return { hasConflict: true, conflictType: 'booking', conflictTitle: 'Existing Booking' };
  }

  return { hasConflict: false };
}
