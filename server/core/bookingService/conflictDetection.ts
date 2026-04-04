import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { ACTIVE_BOOKING_STATUSES } from '../../../shared/constants/statuses';
import { formatDateFromDb } from '../../utils/dateUtils';

interface UserIdRow {
  id: number;
}

interface BookingConflictRow {
  booking_id: number;
  resource_name: string;
  request_date: string;
  start_time: string;
  end_time: string;
  owner_name: string | null;
  owner_email: string;
}

interface ParticipantConflictRow extends BookingConflictRow {
  invite_status: string;
}

const OCCUPIED_STATUSES_LIST = [...ACTIVE_BOOKING_STATUSES, 'checked_in', 'attended', 'cancellation_pending'];
const OCCUPIED_STATUSES_ARRAY = sql`ARRAY[${sql.join(OCCUPIED_STATUSES_LIST.map(s => sql`${s}`), sql`, `)}]::text[]`;

function formatYMD(dateInput: string | Date): string {
  if (dateInput instanceof Date) {
    return formatDateFromDb(dateInput);
  }
  return String(dateInput).substring(0, 10);
}

export interface ConflictingBooking {
  bookingId: number;
  resourceName: string;
  requestDate: string;
  startTime: string;
  endTime: string;
  ownerName: string | null;
  ownerEmail: string;
  conflictType: 'owner' | 'participant';
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflicts: ConflictingBooking[];
}

function timeToMinutes(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours === 24 && minutes === 0) return 1440;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function dayDiffInMinutes(requestedDate: string, existingDate: string): number {
  const rd = new Date(requestedDate + 'T00:00:00Z');
  const ed = new Date(existingDate + 'T00:00:00Z');
  return Math.round((ed.getTime() - rd.getTime()) / 60000);
}

function dateAwareOverlap(
  reqDate: string, reqStartTime: string, reqEndTime: string,
  existDate: string, existStartTime: string, existEndTime: string
): boolean {
  const rs = timeToMinutes(reqStartTime);
  let re = timeToMinutes(reqEndTime);
  const es = timeToMinutes(existStartTime);
  let ee = timeToMinutes(existEndTime);
  if (rs === null || re === null || es === null || ee === null) return false;

  if (re <= rs) re += 1440;

  const offset = dayDiffInMinutes(reqDate, existDate);
  const absEs = es + offset;
  let absEe = ee + offset;
  if (ee <= es) absEe = ee + offset + 1440;

  return rs < absEe && absEs < re;
}

/**
 * Check if two time periods overlap, handling cross-midnight cases.
 * A cross-midnight booking (e.g., 23:00-01:00) has end_time < start_time.
 * We handle this by adding 24 hours (1440 minutes) to the end time.
 */
export function timePeriodsOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = timeToMinutes(start1);
  let e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  let e2 = timeToMinutes(end2);

  if (s1 === null || e1 === null || s2 === null || e2 === null) return false;
  
  if (e1 <= s1) e1 += 1440;
  if (e2 <= s2) e2 += 1440;

  if (s1 < e2 && s2 < e1) return true;

  const s1Next = s1 + 1440;
  const e1Next = e1 + 1440;
  if (s1Next < e2 && s2 < e1Next) return true;

  const s2Next = s2 + 1440;
  const e2Next = e2 + 1440;
  if (s1 < e2Next && s2Next < e1) return true;

  return false;
}

/**
 * Find bookings that conflict with the specified time slot for a member.
 * 
 * Handles cross-midnight bookings (e.g., 11pm-1am) by:
 * 1. Querying the requested date AND the prior day (to catch overhanging late-night bookings)
 * 2. Using timePeriodsOverlap() with circular overlap logic for correct cross-midnight math
 */
export async function findConflictingBookings(
  memberEmail: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: number
): Promise<ConflictCheckResult> {
  if (!memberEmail) {
    return { hasConflict: false, conflicts: [] };
  }
  const conflicts: ConflictingBooking[] = [];
  const normalizedEmail = String(memberEmail).trim().toLowerCase();

  try {
    const [ownerResult, participantResult] = await Promise.all([
      db.execute(sql`
        SELECT 
          br.id as booking_id,
          COALESCE(r.name, 'Unknown Resource') as resource_name,
          br.request_date,
          br.start_time,
          br.end_time,
          br.user_name as owner_name,
          br.user_email as owner_email
        FROM booking_requests br
        LEFT JOIN resources r ON br.resource_id = r.id
        WHERE (
            LOWER(br.user_email) = ${normalizedEmail}
            OR LOWER(br.user_email) IN (SELECT LOWER(ule.linked_email) FROM user_linked_emails ule WHERE LOWER(ule.primary_email) = ${normalizedEmail})
            OR LOWER(br.user_email) IN (SELECT LOWER(ule.primary_email) FROM user_linked_emails ule WHERE LOWER(ule.linked_email) = ${normalizedEmail})
          )
          AND br.request_date IN (${date}, (${date}::date - INTERVAL '1 day')::date, (${date}::date + INTERVAL '1 day')::date)
          AND br.status = ANY(${OCCUPIED_STATUSES_ARRAY})
          ${excludeBookingId ? sql`AND br.id != ${excludeBookingId}` : sql``}
      `),

      db.execute(sql`
        SELECT 
          COALESCE(br.id, -bs.id) as booking_id,
          COALESCE(r.name, 'Unknown Resource') as resource_name,
          bs.session_date as request_date,
          bs.start_time,
          bs.end_time,
          COALESCE(br.user_name, 'Unknown') as owner_name,
          COALESCE(br.user_email, '') as owner_email,
          bp.invite_status
        FROM booking_participants bp
        JOIN booking_sessions bs ON bp.session_id = bs.id
        LEFT JOIN booking_requests br ON br.session_id = bs.id
        LEFT JOIN resources r ON bs.resource_id = r.id
        WHERE bp.user_id IN (
            SELECT u.id FROM users u
            WHERE LOWER(u.email) = ${normalizedEmail}
            UNION
            SELECT u2.id FROM users u2
            JOIN user_linked_emails ule ON LOWER(u2.email) = LOWER(ule.primary_email)
            WHERE LOWER(ule.linked_email) = ${normalizedEmail}
            UNION
            SELECT u3.id FROM users u3
            JOIN user_linked_emails ule2 ON LOWER(u3.email) = LOWER(ule2.linked_email)
            WHERE LOWER(ule2.primary_email) = ${normalizedEmail}
          )
          AND bs.session_date IN (${date}, (${date}::date - INTERVAL '1 day')::date, (${date}::date + INTERVAL '1 day')::date)
          AND bp.invite_status = 'accepted'
          AND (br.id IS NULL OR br.status = ANY(${OCCUPIED_STATUSES_ARRAY}))
          ${excludeBookingId ? sql`AND (br.id IS NULL OR br.id != ${excludeBookingId})` : sql``}
      `),
    ]);

    const reqStart = timeToMinutes(startTime);
    let reqEnd = timeToMinutes(endTime);
    if (reqStart === null || reqEnd === null) {
      return { hasConflict: false, conflicts: [] };
    }
    if (reqEnd <= reqStart) reqEnd += 1440;

    const ownerRows = ownerResult.rows as unknown as BookingConflictRow[];
    for (const row of ownerRows) {
      const safeDate = formatYMD(row.request_date);
      if (!dateAwareOverlap(date, startTime, endTime, safeDate, String(row.start_time), String(row.end_time))) continue;
      conflicts.push({
        bookingId: row.booking_id,
        resourceName: row.resource_name,
        requestDate: safeDate,
        startTime: String(row.start_time),
        endTime: String(row.end_time),
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        conflictType: 'owner'
      });
    }

    const participantRows = participantResult.rows as unknown as ParticipantConflictRow[];
    for (const row of participantRows) {
      const safeDate = formatYMD(row.request_date);
      if (!dateAwareOverlap(date, startTime, endTime, safeDate, String(row.start_time), String(row.end_time))) continue;
      const isDuplicate = conflicts.some(c => c.bookingId === row.booking_id);
      if (!isDuplicate) {
        conflicts.push({
          bookingId: row.booking_id,
          resourceName: row.resource_name,
          requestDate: safeDate,
          startTime: String(row.start_time),
          endTime: String(row.end_time),
          ownerName: row.owner_name,
          ownerEmail: row.owner_email,
          conflictType: 'participant'
        });
      }
    }

    if (conflicts.length > 0) {
      logger.info('[conflictDetection] Conflicts found for member', {
        extra: {
          memberEmail: normalizedEmail,
          date,
          startTime,
          endTime,
          conflictCount: conflicts.length,
          conflictBookingIds: conflicts.map(c => c.bookingId)
        }
      });
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts
    };
  } catch (error: unknown) {
    logger.error('[conflictDetection] Error checking conflicts', {
      extra: { error: getErrorMessage(error), memberEmail, date, startTime, endTime }
    });
    throw error;
  }
}

export async function checkMemberAvailability(
  memberEmail: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: number
): Promise<{ available: boolean; conflicts: ConflictingBooking[] }> {
  const result = await findConflictingBookings(memberEmail, date, startTime, endTime, excludeBookingId);
  return {
    available: !result.hasConflict,
    conflicts: result.conflicts
  };
}
