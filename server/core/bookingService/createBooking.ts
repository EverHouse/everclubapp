import { resources, users } from '../../../shared/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { getTodayPacific, formatTime12Hour } from '../../utils/dateUtils';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import type { SanitizedParticipant } from './bookingTypes';
import { BookingValidationError } from './bookingTypes';
import { checkDailyBookingLimit } from '../tierService';
import { resolveUserByEmail } from '../stripe/customers';
import { checkClosureConflict, checkAvailabilityBlockConflict } from '../bookingValidation';
import { acquireBookingLocks, checkResourceOverlap } from './bookingCreationGuard';

export interface ValidatedDateResult {
  year: number;
  month: number;
  day: number;
}

export function validateBookingDate(requestDate: string, opts?: { allowPastDate?: boolean }): ValidatedDateResult {
  if (!requestDate || typeof requestDate !== 'string') {
    throw new BookingValidationError(400, { error: 'Missing or invalid date' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestDate)) {
    throw new BookingValidationError(400, { error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  const [year, month, day] = requestDate.split('-').map((n: string) => parseInt(n, 10));
  const validatedDate = new Date(year, month - 1, day);
  if (validatedDate.getFullYear() !== year ||
      validatedDate.getMonth() !== month - 1 ||
      validatedDate.getDate() !== day) {
    throw new BookingValidationError(400, { error: 'Invalid date - date does not exist (e.g., Feb 30)' });
  }

  if (!opts?.allowPastDate) {
    const todayPacific = getTodayPacific();
    if (requestDate < todayPacific) {
      throw new BookingValidationError(400, { error: 'Cannot create bookings in the past' });
    }
  }

  return { year, month, day };
}

export interface ComputedEndTime {
  endTime: string;
  endHours: number;
  endMins: number;
}

export function computeEndTime(startTime: string, durationMinutes: number, opts?: { strictMidnight?: boolean }): ComputedEndTime {
  if (!startTime || typeof startTime !== 'string') {
    throw new BookingValidationError(400, { error: 'Missing or invalid start time' });
  }
  const [hoursStr, minsStr] = startTime.split(':');
  const hours = Number(hoursStr);
  const mins = Number(minsStr);
  if (isNaN(hours) || isNaN(mins) || hours < 0 || hours > 23 || mins < 0 || mins > 59) {
    throw new BookingValidationError(400, { error: 'Invalid start time format. Use HH:MM in 24-hour format.' });
  }
  const parsedDuration = Number(durationMinutes);
  if (isNaN(parsedDuration) || parsedDuration <= 0) {
    throw new BookingValidationError(400, { error: 'Invalid or missing duration' });
  }
  const totalMins = hours * 60 + mins + parsedDuration;
  const endHours = Math.floor(totalMins / 60);
  const endMins = totalMins % 60;
  const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}:00`;

  if (opts?.strictMidnight) {
    if (endHours >= 24) {
      throw new BookingValidationError(400, { error: 'Booking cannot extend past midnight. Please choose an earlier start time or shorter duration.' });
    }
  } else {
    if (endHours > 24 || (endHours === 24 && endMins > 0)) {
      throw new BookingValidationError(400, { error: 'Booking cannot extend past midnight. Please choose an earlier start time or shorter duration.' });
    }
  }

  return { endTime, endHours, endMins };
}

interface TxLike {
  select: (...args: unknown[]) => unknown;
  execute: (query: unknown) => Promise<{ rows: unknown[] }>;
}

export async function sanitizeAndResolveParticipants(
  rawParticipants: Array<{ email?: string; type?: string; userId?: string; name?: string }>,
  ownerEmail: string,
  tx: TxLike,
  opts?: { isStaff?: boolean; maxGuests?: number }
): Promise<SanitizedParticipant[]> {
  const maxGuests = opts?.maxGuests ?? 3;
  const isStaff = opts?.isStaff ?? false;

  if (rawParticipants.length > maxGuests) {
    throw new BookingValidationError(400, { error: `Maximum of ${maxGuests} guests allowed per booking` });
  }

  let sanitizedParticipants: SanitizedParticipant[] = rawParticipants
    .map(p => ({
      email: typeof p.email === 'string' ? p.email.toLowerCase().trim() : '',
      type: (p.type === 'member' ? 'member' : 'guest') as 'member' | 'guest',
      userId: typeof p.userId === 'string' ? p.userId : undefined,
      name: typeof p.name === 'string' ? p.name.trim() : undefined,
    }))
    .filter(p => p.email || p.userId);

  const emailsToLookup = sanitizedParticipants
    .filter(p => p.email && !p.userId)
    .map(p => p.email.toLowerCase());
  const userIdsToLookup = sanitizedParticipants
    .filter(p => p.userId && !p.email)
    .map(p => p.userId as string);

  if (emailsToLookup.length > 0) {
    try {
      const dbLike = tx as unknown as { select: typeof import('../../db').db.select };
      const emailUsers = await dbLike.select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName
      }).from(users)
        .where(inArray(sql`LOWER(${users.email})`, emailsToLookup));
      const emailMap = new Map(emailUsers.map((u: { id: string; email: string | null; firstName: string | null; lastName: string | null }) => [u.email?.toLowerCase() || '', u]));
      for (const participant of sanitizedParticipants) {
        if (participant.email && !participant.userId) {
          const found = emailMap.get(participant.email.toLowerCase());
          if (found) {
            participant.userId = found.id;
            participant.type = 'member';
            if (isStaff && (!participant.name || participant.name.includes('@'))) {
              const fullName = [found.firstName, found.lastName].filter(Boolean).join(' ').trim();
              if (fullName) participant.name = fullName;
            }
          }
        }
      }
    } catch (err: unknown) {
      logger.error('[Booking] Failed to batch lookup users by email', { extra: { error: getErrorMessage(err) } });
      throw new Error('Failed to look up participant emails. Please try again.');
    }
  }

  if (userIdsToLookup.length > 0) {
    try {
      const dbLike = tx as unknown as { select: typeof import('../../db').db.select };
      const idUsers = await dbLike.select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName
      }).from(users)
        .where(inArray(users.id, userIdsToLookup));
      const idMap = new Map(idUsers.map((u: { id: string; email: string | null; firstName: string | null; lastName: string | null }) => [u.id, u]));
      for (const participant of sanitizedParticipants) {
        if (participant.userId && !participant.email) {
          const found = idMap.get(participant.userId);
          if (found) {
            participant.email = found.email?.toLowerCase() || '';
            participant.type = 'member';
            if (isStaff && !participant.name) {
              const fullName = [found.firstName, found.lastName].filter(Boolean).join(' ').trim();
              participant.name = fullName || found.email || undefined;
            }
            logger.info('[Booking] Resolved email for directory-selected participant', { extra: { participantEmail: participant.email } });
          }
        }
      }
    } catch (err: unknown) {
      logger.error('[Booking] Failed to batch lookup users by userId', { extra: { error: getErrorMessage(err) } });
      throw new Error('Failed to look up participant user IDs. Please try again.');
    }
  }

  const allParticipantUserIds = sanitizedParticipants
    .filter(p => p.userId)
    .map(p => p.userId as string);
  if (allParticipantUserIds.length > 0) {
    try {
      const dbLike = tx as unknown as { select: typeof import('../../db').db.select };
      const statusResults = await dbLike.select({
        id: users.id,
        membershipStatus: users.membershipStatus,
        email: users.email,
        name: sql<string>`COALESCE(TRIM(CONCAT(${users.firstName}, ' ', ${users.lastName})), '')`.as('name')
      }).from(users)
        .where(inArray(users.id, allParticipantUserIds));
      for (const statusRow of statusResults) {
        if (statusRow.membershipStatus === 'inactive' || statusRow.membershipStatus === 'cancelled') {
          throw new BookingValidationError(400, {
            error: `${statusRow.name || statusRow.email || 'A participant'} has an inactive membership and cannot be added to bookings.`
          });
        }
      }
    } catch (err: unknown) {
      if (err instanceof BookingValidationError) throw err;
      logger.error('[Booking] Failed to batch lookup membership status', { extra: { error: getErrorMessage(err) } });
      throw new Error('Failed to verify membership status. Please try again.');
    }
  }

  const seenEmails = new Set<string>();
  const seenUserIds = new Set<string>();
  seenEmails.add(ownerEmail.toLowerCase());
  sanitizedParticipants = sanitizedParticipants.filter(p => {
    if (p.userId && seenUserIds.has(p.userId)) return false;
    if (p.email && seenEmails.has(p.email.toLowerCase())) return false;
    if (p.userId) seenUserIds.add(p.userId);
    if (p.email) seenEmails.add(p.email.toLowerCase());
    return true;
  });

  return sanitizedParticipants;
}

export async function checkParticipantOverlaps(
  participants: SanitizedParticipant[],
  requestDate: string,
  startTime: string,
  endTime: string,
  tx: TxLike
): Promise<void> {
  for (const participant of participants) {
    if (participant.type === 'member' && participant.email) {
      const pOverlap = await tx.execute(sql`
        SELECT br.id, COALESCE(r.name, 'Unknown') AS resource_name, br.start_time, br.end_time
        FROM booking_requests br
        LEFT JOIN resources r ON r.id = br.resource_id
        WHERE br.request_date = ${requestDate}
        AND br.status IN ('pending', 'pending_approval', 'approved', 'confirmed', 'checked_in', 'attended', 'cancellation_pending')
        AND br.start_time < ${endTime} AND br.end_time > ${startTime}
        AND (
          LOWER(br.user_email) = LOWER(${participant.email})
          OR LOWER(br.user_email) IN (SELECT LOWER(ule.linked_email) FROM user_linked_emails ule WHERE LOWER(ule.primary_email) = LOWER(${participant.email}))
          OR LOWER(br.user_email) IN (SELECT LOWER(ule.primary_email) FROM user_linked_emails ule WHERE LOWER(ule.linked_email) = LOWER(${participant.email}))
          OR br.session_id IN (
            SELECT bp.session_id FROM booking_participants bp
            JOIN users u ON bp.user_id = u.id
            WHERE LOWER(u.email) = LOWER(${participant.email})
          )
        )
        LIMIT 1
      `);
      if (pOverlap.rows.length > 0) {
        const conflict = pOverlap.rows[0] as { id: number; resource_name: string; start_time: string; end_time: string };
        const cStart = conflict.start_time?.substring(0, 5);
        const cEnd = conflict.end_time?.substring(0, 5);
        throw new BookingValidationError(409, {
          error: `${participant.name || participant.email} already has a booking at ${conflict.resource_name} from ${formatTime12Hour(cStart)} to ${formatTime12Hour(cEnd)}. They cannot be added to an overlapping time slot.`
        });
      }
    }
  }
}

export async function checkParticipantDailyLimits(
  participants: SanitizedParticipant[],
  requestDate: string,
  durationMinutes: number,
  resourceType: string
): Promise<void> {
  for (const participant of participants) {
    if (participant.type === 'member' && participant.email) {
      const pLimitCheck = await checkDailyBookingLimit(participant.email, requestDate, durationMinutes, undefined, resourceType);
      if (!pLimitCheck.allowed) {
        throw new BookingValidationError(403, {
          error: `Participant ${participant.name || participant.email} has exceeded their daily booking limit.`,
          remainingMinutes: pLimitCheck.remainingMinutes
        });
      }
    }
  }
}

export interface BookingCreationContext {
  isStaff: boolean;
  allowPastDate?: boolean;
  strictMidnight?: boolean;
  skipDailyLimit?: boolean;
  skipOwnerOverlapCheck?: boolean;
}

export interface BookingCreationInput {
  userEmail: string;
  startTime: string;
  requestDate: string;
  durationMinutes: number;
  resourceId?: number | null;
  participantEmails?: string[];
}

export interface PreparedBookingData {
  resolvedEmail: string;
  resolvedUserId: string | null;
  endTime: string;
  resourceType: string;
}

export async function prepareBookingCreation(
  input: BookingCreationInput,
  context: BookingCreationContext
): Promise<PreparedBookingData> {
  if (!input || typeof input.userEmail !== 'string' || !input.userEmail.trim()) {
    throw new BookingValidationError(400, { error: 'Missing or invalid userEmail' });
  }
  let resolvedEmail = input.userEmail.trim().toLowerCase();
  let resolvedUserId: string | null = null;

  const resolved = await resolveUserByEmail(resolvedEmail);
  if (resolved) {
    if (resolved.matchType !== 'direct') {
      logger.info('[Booking] Resolved linked email to primary', { extra: { originalEmail: resolvedEmail, resolvedEmail: resolved.primaryEmail, matchType: resolved.matchType } });
      resolvedEmail = resolved.primaryEmail.toLowerCase();
    }
    resolvedUserId = resolved.userId;
  }

  validateBookingDate(input.requestDate, { allowPastDate: context.allowPastDate });
  const { endTime } = computeEndTime(input.startTime, input.durationMinutes, { strictMidnight: context.strictMidnight });

  let resourceType = 'simulator';
  if (input.resourceId) {
    const [resource] = await db.select({ type: resources.type }).from(resources).where(eq(resources.id, input.resourceId));
    if (resource?.type) {
      resourceType = resource.type;
    }
  }

  return { resolvedEmail, resolvedUserId, endTime, resourceType };
}

export async function acquireLocksAndCheckConflicts(
  tx: Parameters<typeof acquireBookingLocks>[0],
  input: {
    resourceId: number | null;
    requestDate: string;
    startTime: string;
    endTime: string;
    requestEmail: string;
    isStaffRequest: boolean;
    isViewAsMode: boolean;
    resourceType: string;
    participantEmails: string[];
    txClient?: { select: typeof db.select; execute: typeof db.execute };
  }
): Promise<void> {
  await acquireBookingLocks(tx, {
    resourceId: input.resourceId,
    requestDate: input.requestDate,
    startTime: input.startTime,
    endTime: input.endTime,
    requestEmail: input.requestEmail,
    isStaffRequest: input.isStaffRequest,
    isViewAsMode: input.isViewAsMode,
    resourceType: input.resourceType,
    participantEmails: input.participantEmails,
  });

  if (input.resourceId) {
    await checkResourceOverlap(tx, {
      resourceId: input.resourceId,
      requestDate: input.requestDate,
      startTime: input.startTime,
      endTime: input.endTime,
    });

    const closureCheck = await checkClosureConflict(input.resourceId, input.requestDate, input.startTime, input.endTime, input.txClient);
    if (closureCheck.hasConflict) {
      throw new BookingValidationError(409, {
        error: `This time slot conflicts with a facility closure: ${closureCheck.closureTitle || 'Facility Closure'}. Please choose a different time.`
      });
    }

    const blockCheck = await checkAvailabilityBlockConflict(input.resourceId, input.requestDate, input.startTime, input.endTime, input.txClient);
    if (blockCheck.hasConflict) {
      throw new BookingValidationError(409, {
        error: `This time slot is blocked for: ${blockCheck.blockType || 'Event Block'}. Please choose a different time.`
      });
    }
  }
}
