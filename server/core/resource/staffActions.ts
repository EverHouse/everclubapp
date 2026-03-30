import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { resources, users, bookingRequests, failedSideEffects } from '../../../shared/schema';
import { logger } from '../logger';
import { notifyMember, notifyAllStaff } from '../notificationService';
import { checkAllConflicts } from '../bookingValidation';
import { bookingEvents } from '../bookingEvents';
import { recalculateSessionFees } from '../billing/unifiedFeeService';
import { createPrepaymentIntent } from '../billing/prepaymentService';
import { ensureSessionForBooking, createTxQueryClient } from '../bookingService/sessionManager';
import { acquireBookingLocks, BookingConflictError } from '../bookingService/bookingCreationGuard';
import { computeEndTime, prepareBookingCreation, acquireLocksAndCheckConflicts, sanitizeAndResolveParticipants } from '../bookingService/createBooking';
import { BookingValidationError } from '../bookingService/bookingTypes';
import { createCalendarEventOnCalendar, getCalendarIdByName, CALENDAR_CONFIG } from '../calendar/index';
import { AppError, StaleBookingVersionError } from '../errors';
import { resolveUserByEmail } from '../stripe/customers';
import { broadcastAvailabilityUpdate } from '../websocket';
import { formatDateDisplayWithDay, formatTime12Hour } from '../../utils/dateUtils';
import { getErrorMessage } from '../../utils/errorUtils';
import { refreshBookingPass } from '../../walletPass/bookingPassService';
import type { StaffManualBookingInput } from '../../../shared/validators/manualBooking';

const TERMINAL_STATUSES = ['cancelled', 'attended', 'completed', 'no_show', 'declined', 'expired'];
const ASSIGNABLE_STATUSES = ['pending', 'pending_approval', 'approved', 'confirmed'];

async function persistFailedSideEffect(bookingId: number, actionType: string, errorMessage: string, context?: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(failedSideEffects).values({
      bookingId,
      actionType,
      errorMessage,
      context: context || null,
    });
    logger.warn(`[Failed Side Effect] Persisted ${actionType} failure for booking ${bookingId}`, {
      extra: { bookingId, actionType }
    });
  } catch (persistErr: unknown) {
    logger.error('[Failed Side Effect] CRITICAL: Failed to persist side effect failure', {
      extra: { bookingId, actionType, errorMessage, persistError: getErrorMessage(persistErr) }
    });
  }
}

interface MemberLookupRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface FeeSumRow {
  total_cents: string | null;
  overage_cents?: string | null;
  guest_cents?: string | null;
}

export async function assignMemberToBooking(bookingId: number, memberEmail: string, memberName: string, memberId?: string | null, expectedVersion?: number) {
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(bookingRequests).where(eq(bookingRequests.id, bookingId));
    
    if (!existing) {
      throw new AppError(404, 'Booking not found');
    }

    if (TERMINAL_STATUSES.includes(existing.status || '')) {
      throw new AppError(400, `Cannot assign a member to a booking with status "${existing.status}". Only active bookings can be modified.`);
    }

    if (!ASSIGNABLE_STATUSES.includes(existing.status || '')) {
      throw new AppError(400, `Booking is in status "${existing.status}" and cannot be assigned. Expected a booking in one of these statuses: ${ASSIGNABLE_STATUSES.join(', ')}.`);
    }
    
    if (!existing.isUnmatched) {
      throw new AppError(400, 'Booking is not an unmatched booking');
    }
    
    if (expectedVersion != null && existing.version !== expectedVersion) {
      throw new StaleBookingVersionError();
    }

    const [updated] = await tx.update(bookingRequests)
      .set({
        userEmail: memberEmail.toLowerCase(),
        userName: memberName,
        userId: memberId || null,
        isUnmatched: false,
        status: 'approved',
        staffNotes: sql`COALESCE(${bookingRequests.staffNotes}, '') || ' [Member assigned by staff: ' || ${memberName} || ']'`,
        updatedAt: new Date(),
        version: sql`COALESCE(${bookingRequests.version}, 1) + 1`
      })
      .where(and(
        eq(bookingRequests.id, bookingId),
        sql`${bookingRequests.status} IN ('pending', 'pending_approval', 'approved', 'confirmed')`
      ))
      .returning();

    if (!updated) {
      throw new AppError(409, 'Booking was modified by another staff member. Please refresh and try again.');
    }

    if (existing.sessionId) {
      await tx.execute(sql`UPDATE booking_participants
        SET user_id = ${memberId || null},
            display_name = ${memberName}
        WHERE session_id = ${existing.sessionId} AND participant_type = 'owner'`);
    }
    
    return updated;
  });
  
  const { broadcastToStaff } = await import('../websocket');
  broadcastToStaff({
    type: 'booking_updated',
    bookingId,
    action: 'member_assigned',
    memberEmail: memberEmail,
    memberName: memberName,
    version: result.version
  });
  
  const formattedDate = result.requestDate ? new Date(result.requestDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '';
  const formattedTime = result.startTime || '';
  
  if (memberEmail) {
    try {
      await notifyMember({
        userEmail: memberEmail,
        title: 'Booking Confirmed',
        message: `Your simulator booking for ${formattedDate} at ${formattedTime} has been confirmed.`,
        type: 'booking_confirmed',
        relatedId: bookingId,
        relatedType: 'booking'
      });
    } catch (notifyErr: unknown) {
      await persistFailedSideEffect(bookingId, 'notification', getErrorMessage(notifyErr), { flow: 'assign_member', memberEmail });
    }
  }
  
  return result;
}

export async function assignWithPlayers(
  bookingId: number,
  owner: { email: string; name: string; member_id?: string | null },
  additionalPlayers: Array<{ type: 'member' | 'guest_placeholder'; member_id?: string | null; email?: string; name?: string; guest_name?: string }>,
  staffEmail: string,
  expectedVersion?: number
) {
  const totalPlayerCount = 1 + additionalPlayers.filter(p => p.type === 'member' || p.type === 'guest_placeholder').length;
  const guestCount = additionalPlayers.filter(p => p.type === 'guest_placeholder').length;

  const memberEmails = [owner.email.trim().toLowerCase()];
  for (const p of additionalPlayers) {
    if (p.type !== 'guest_placeholder' && p.email) {
      const normalizedEmail = p.email.trim().toLowerCase();
      if (memberEmails.includes(normalizedEmail)) {
        throw new AppError(400, `Duplicate player: ${p.name || p.email} is already assigned to another slot in this booking`);
      }
      memberEmails.push(normalizedEmail);
    }
  }

  let resolvedOwnerId = owner.member_id || null;
  if (!resolvedOwnerId && owner.email) {
    const [userRow] = await db.select({ id: users.id })
      .from(users)
      .where(sql`LOWER(${users.email}) = ${owner.email.toLowerCase()}`)
      .limit(1);
    if (userRow) {
      resolvedOwnerId = userRow.id;
    }
  }
  
  const result = await db.transaction(async (tx) => {
    const [existingBooking] = await tx.select()
      .from(bookingRequests)
      .where(eq(bookingRequests.id, bookingId));
    
    if (!existingBooking) {
      throw new AppError(404, 'Booking not found');
    }

    if (TERMINAL_STATUSES.includes(existingBooking.status || '')) {
      throw new AppError(400, `Cannot assign players to a booking with status "${existingBooking.status}". Only active bookings can be modified.`);
    }

    if (expectedVersion !== undefined && expectedVersion !== (existingBooking.version ?? 1)) {
      throw new StaleBookingVersionError();
    }
    
    const newNote = ` [Assigned by staff: ${owner.name} with ${totalPlayerCount} players]`;
    
    const participantsJson = additionalPlayers.map(p => {
      if (p.type === 'guest_placeholder') {
        return { type: 'guest' as const, name: p.guest_name || 'Guest (info pending)' };
      }
      return { type: 'member' as const, email: p.email, name: p.name, userId: p.member_id };
    });

    const statusesAllowingKeep = ['approved', 'confirmed', 'checked_in'];
    const keepCurrentStatus = statusesAllowingKeep.includes(existingBooking.status);
    const targetStatus = keepCurrentStatus ? existingBooking.status : 'approved';

    const [updated] = await tx.update(bookingRequests)
      .set({
        userEmail: owner.email.toLowerCase(),
        userName: owner.name,
        userId: resolvedOwnerId,
        isUnmatched: false,
        status: targetStatus,
        declaredPlayerCount: totalPlayerCount,
        guestCount: guestCount,
        requestParticipants: participantsJson.length > 0 ? participantsJson : undefined,
        staffNotes: sql`COALESCE(${bookingRequests.staffNotes}, '') || ${newNote}`,
        updatedAt: new Date(),
        version: sql`COALESCE(${bookingRequests.version}, 1) + 1`
      })
      .where(and(
        eq(bookingRequests.id, bookingId),
        sql`${bookingRequests.status} NOT IN ('cancelled', 'attended', 'completed', 'no_show', 'declined', 'expired')`
      ))
      .returning();

    if (!updated) {
      throw new AppError(409, 'Booking was modified by another staff member or is no longer in a modifiable status. Please refresh and try again.');
    }

    let sessionId = existingBooking.sessionId;

    if (sessionId) {
      await tx.execute(sql`UPDATE booking_participants
        SET user_id = ${resolvedOwnerId || null},
            display_name = ${owner.name}
        WHERE session_id = ${sessionId} AND participant_type = 'owner'`);
    }

    if (!sessionId && updated.resourceId && updated.requestDate && updated.startTime && updated.endTime) {
      const txClient = createTxQueryClient(tx);
      const sessionResult = await ensureSessionForBooking({
        bookingId,
        resourceId: updated.resourceId,
        sessionDate: String(updated.requestDate),
        startTime: String(updated.startTime),
        endTime: String(updated.endTime),
        ownerEmail: owner.email,
        ownerName: owner.name,
        ownerUserId: resolvedOwnerId || undefined,
        trackmanBookingId: updated.trackmanBookingId || undefined,
        source: 'staff_manual',
        createdBy: staffEmail
      }, txClient);
      if (sessionResult.sessionId) {
        sessionId = sessionResult.sessionId;
        logger.info('[assign-with-players] Created session for booking within transaction', {
          extra: { bookingId, sessionId, newOwner: owner.email }
        });
      } else {
        throw new AppError(500, `Failed to create session for booking: ${sessionResult.error || 'unknown error'}`);
      }
    }

    if (sessionId && additionalPlayers.length > 0) {
      const durationMinutes = Number(updated.durationMinutes) || 60;
      const slotDuration = Math.floor(durationMinutes / Math.max(totalPlayerCount, 1));
      for (const player of additionalPlayers) {
        if (player.type === 'guest_placeholder') {
          await tx.execute(sql`INSERT INTO booking_participants (session_id, participant_type, display_name, slot_duration, payment_status, used_guest_pass, created_at)
             VALUES (${sessionId}, 'guest', ${player.guest_name || 'Guest (info pending)'}, ${slotDuration}, 'pending', false, NOW())`);
        } else if (player.type === 'member' && player.email) {
          const memberLookup = await tx.execute(sql`SELECT id, first_name, last_name FROM users WHERE LOWER(email) = LOWER(${player.email}) LIMIT 1`);
          const memberRow = (memberLookup.rows as unknown as MemberLookupRow[])[0];
          const displayName = memberRow
            ? `${memberRow.first_name || ''} ${memberRow.last_name || ''}`.trim() || player.name || player.email
            : player.name || player.email;
          if (memberRow?.id) {
            await tx.execute(sql`INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, created_at)
               VALUES (${sessionId}, ${memberRow.id}, 'member', ${displayName}, ${slotDuration}, 'pending', NOW())`);
          } else {
            await tx.execute(sql`INSERT INTO booking_participants (session_id, participant_type, display_name, slot_duration, payment_status, created_at)
               VALUES (${sessionId}, 'guest', ${displayName}, ${slotDuration}, 'pending', NOW())`);
            logger.warn('[assign-with-players] Member not found in system, added as guest instead', {
              extra: { email: player.email, sessionId }
            });
          }
        }
      }
    }
    
    return { booking: updated, sessionId };
  });

  const sessionId = result.sessionId;

  if (sessionId) {
    try {
      await recalculateSessionFees(sessionId, 'approval');
      logger.info('[assign-with-players] Recalculated fees after member assignment', {
        extra: { bookingId, sessionId, newOwner: owner.email }
      });
    } catch (recalcErr: unknown) {
      logger.warn('[assign-with-players] Failed to recalculate fees after assignment', {
        extra: { bookingId, sessionId, error: getErrorMessage(recalcErr) }
      });
    }
  }
  
  if (sessionId) {
    try {
      const feeResult = await db.execute(sql`
        SELECT SUM(COALESCE(cached_fee_cents, 0)) as total_cents,
               SUM(CASE WHEN participant_type = 'owner' THEN COALESCE(cached_fee_cents, 0) ELSE 0 END) as overage_cents,
               SUM(CASE WHEN participant_type = 'guest' THEN COALESCE(cached_fee_cents, 0) ELSE 0 END) as guest_cents
        FROM booking_participants
        WHERE session_id = ${sessionId}
      `);
      
      const feeRow = (feeResult.rows as unknown as FeeSumRow[])[0];
      const totalCents = parseInt(feeRow?.total_cents || '0', 10);
      const overageCents = parseInt(feeRow?.overage_cents || '0', 10);
      const guestCents = parseInt(feeRow?.guest_cents || '0', 10);
      
      if (totalCents > 0) {
        const prepayResult = await createPrepaymentIntent({
          sessionId,
          bookingId: bookingId,
          userId: owner.member_id || null,
          userEmail: owner.email,
          userName: owner.name,
          totalFeeCents: totalCents,
          feeBreakdown: { overageCents, guestCents }
        });
        
        if (prepayResult?.paidInFull) {
          await db.execute(sql`UPDATE booking_participants SET payment_status = 'paid' WHERE session_id = ${sessionId} AND payment_status IN ('pending', 'refunded')`);
          logger.info('[assign-with-players] Prepayment fully covered by credit', {
            extra: { bookingId, sessionId, totalCents }
          });
        } else {
          logger.info('[assign-with-players] Created prepayment intent', {
            extra: { bookingId, sessionId, totalCents }
          });
        }
      }
    } catch (prepayErr: unknown) {
      logger.warn('[assign-with-players] Failed to create prepayment intent', {
        extra: { bookingId, sessionId, error: prepayErr }
      });
      await persistFailedSideEffect(bookingId, 'prepayment_creation', getErrorMessage(prepayErr), { flow: 'assign_with_players', sessionId });
    }
  }
  
  const { broadcastToStaff } = await import('../websocket');
  broadcastToStaff({
    type: 'booking_updated',
    bookingId: result.booking.id,
    action: 'players_assigned',
    memberEmail: owner.email,
    memberName: owner.name,
    totalPlayers: totalPlayerCount,
    version: result.booking.version
  });
  
  if (owner.member_id) {
    try {
      const feeResult = await db.execute(sql`
        SELECT SUM(COALESCE(cached_fee_cents, 0)) as total_cents
        FROM booking_participants
        WHERE session_id = ${sessionId}
      `);
      
      const totalCents = parseInt((feeResult.rows as unknown as FeeSumRow[])[0]?.total_cents || '0', 10);
      const feeMessage = totalCents > 0 
        ? ` Estimated fees: $${(totalCents / 100).toFixed(2)}. You can pay now from your dashboard.`
        : '';
      
      const dateStr = result.booking.requestDate 
        ? new Date(result.booking.requestDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })
        : '';
      const timeStr = result.booking.startTime || '';
      
      await notifyMember({
        userEmail: owner.email,
        title: 'Booking Confirmed',
        message: `Your simulator booking for ${dateStr} at ${timeStr} has been confirmed.${feeMessage}`,
        type: 'booking_confirmed',
        relatedId: bookingId,
        relatedType: 'booking'
      });
    } catch (notifyErr: unknown) {
      logger.warn('[assign-with-players] Failed to notify member', {
        extra: { bookingId, error: getErrorMessage(notifyErr) }
      });
      await persistFailedSideEffect(bookingId, 'notification', getErrorMessage(notifyErr), { flow: 'assign_with_players', ownerEmail: owner.email });
    }
  }
  
  return { booking: result.booking, totalPlayerCount, guestCount, sessionId };
}

export async function changeBookingOwner(bookingId: number, newEmail: string, newName: string, memberId?: string | null, expectedVersion?: number) {
  const result = await db.transaction(async (tx) => {
    const [existingBooking] = await tx.select()
      .from(bookingRequests)
      .where(eq(bookingRequests.id, bookingId));
    
    if (!existingBooking) {
      throw new AppError(404, 'Booking not found');
    }

    if (TERMINAL_STATUSES.includes(existingBooking.status || '')) {
      throw new AppError(400, `Cannot change owner of a booking with status "${existingBooking.status}". Only active bookings can be reassigned.`);
    }

    if (expectedVersion !== undefined && expectedVersion !== (existingBooking.version ?? 1)) {
      throw new StaleBookingVersionError();
    }
    
    const previousOwner = existingBooking.userName || existingBooking.userEmail;
    
    const [updated] = await tx.update(bookingRequests)
      .set({
        userEmail: newEmail.toLowerCase(),
        userName: newName,
        userId: memberId || null,
        isUnmatched: false,
        status: 'approved',
        staffNotes: sql`COALESCE(${bookingRequests.staffNotes}, '') || ' [Owner changed from ' || ${previousOwner} || ' to ' || ${newName} || ' by staff]'`,
        updatedAt: new Date(),
        version: sql`COALESCE(${bookingRequests.version}, 1) + 1`
      })
      .where(and(
        eq(bookingRequests.id, bookingId),
        sql`${bookingRequests.status} IN ('pending', 'pending_approval', 'approved', 'confirmed')`
      ))
      .returning();

    if (!updated) {
      throw new AppError(409, 'Booking was modified by another staff member or is no longer in a modifiable status. Please refresh and try again.');
    }
    
    if (existingBooking.sessionId) {
      const resolvedUserId = memberId || null;
      let resolvedName = newName;
      let resolvedMemberId = resolvedUserId;

      if (!resolvedMemberId) {
        const userResult = await tx.execute(sql`SELECT id, first_name, last_name FROM users WHERE LOWER(email) = LOWER(${newEmail}) LIMIT 1`);
        const userRow = (userResult.rows as Array<{ id: string; first_name: string | null; last_name: string | null }>)[0];
        if (userRow) {
          resolvedMemberId = userRow.id;
          const fullName = [userRow.first_name, userRow.last_name].filter(Boolean).join(' ');
          if (fullName) resolvedName = fullName;
        }
      }

      await tx.execute(sql`
        UPDATE booking_participants
        SET user_id = ${resolvedMemberId},
            display_name = ${resolvedName}
        WHERE session_id = ${existingBooking.sessionId} AND participant_type = 'owner'
      `);
    }

    return { booking: updated, previousOwner };
  });
  
  const { broadcastToStaff } = await import('../websocket');
  broadcastToStaff({
    type: 'booking_updated',
    bookingId: result.booking.id,
    action: 'owner_changed',
    previousOwner: result.previousOwner,
    newOwnerEmail: newEmail,
    newOwnerName: newName,
    version: result.booking.version
  });
  
  return result;
}

export async function createManualBooking(params: {
  memberEmail: string;
  resourceId: number;
  bookingDate: string;
  startTime: string;
  durationMinutes: number;
  guestCount: number;
  bookingSource: string;
  notes?: string;
  staffNotes?: string;
  trackmanBookingId?: string;
  staffEmail: string;
}) {
  const validSources = ['Trackman', 'YGB', 'Mindbody', 'Texted Concierge', 'Called', 'Other'];
  if (!validSources.includes(params.bookingSource)) {
    throw new AppError(400, 'Invalid booking source');
  }

  const validDurations = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
  if (!validDurations.includes(params.durationMinutes)) {
    throw new AppError(400, 'Invalid duration. Must be between 30 and 360 minutes in 30-minute increments.');
  }

  let resolvedMemberEmail = params.memberEmail.toLowerCase();
  let resolvedUserId: string | null = null;
  const resolved = await resolveUserByEmail(resolvedMemberEmail);
  if (resolved) {
    if (resolved.matchType !== 'direct') {
      logger.info('[StaffActions] Resolved linked email to primary', { extra: { originalEmail: resolvedMemberEmail, resolvedEmail: resolved.primaryEmail, matchType: resolved.matchType } });
      resolvedMemberEmail = resolved.primaryEmail.toLowerCase();
    }
    resolvedUserId = resolved.userId;
  }

  const [member] = await db.select()
    .from(users)
    .where(eq(users.email, resolvedMemberEmail));

  if (!member) {
    throw new AppError(404, 'Member not found with that email');
  }

  const [resource] = await db.select()
    .from(resources)
    .where(eq(resources.id, params.resourceId));

  if (!resource) {
    throw new AppError(404, 'Resource not found');
  }

  const { endTime } = computeEndTime(params.startTime, params.durationMinutes);

  const conflictCheck = await checkAllConflicts(params.resourceId, params.bookingDate, params.startTime, endTime);
  if (conflictCheck.hasConflict) {
    if (conflictCheck.conflictType === 'closure') {
      throw new AppError(409, 'Time slot conflicts with a facility closure', {
        message: `This time slot conflicts with "${conflictCheck.conflictTitle}".`
      });
    } else if (conflictCheck.conflictType === 'availability_block') {
      throw new AppError(409, 'Time slot is blocked for an event', {
        message: `This time slot is blocked: ${conflictCheck.conflictTitle || 'Event block'}.`
      });
    } else {
      throw new AppError(409, 'Time slot already booked', {
        message: 'Another booking already exists for this time slot.'
      });
    }
  }

  let calendarEventId: string | null = null;
  if (resource.type === 'conference_room') {
    try {
      const calendarId = await getCalendarIdByName(CALENDAR_CONFIG.conference.name);
      
      if (calendarId) {
        const memberName = member.firstName && member.lastName 
          ? `${member.firstName} ${member.lastName}` 
          : resolvedMemberEmail;
        
        const summary = `Booking: ${memberName}`;
        const descriptionLines = [
          `Area: ${resource.name}`,
          `Member: ${resolvedMemberEmail}`,
          `Guests: ${params.guestCount}`,
          `Source: ${params.bookingSource}`,
          `Created by: ${params.staffEmail}`
        ];
        if (params.notes) {
          descriptionLines.push(`Notes: ${params.notes}`);
        }
        const description = descriptionLines.join('\n');
        
        calendarEventId = await createCalendarEventOnCalendar(
          calendarId,
          summary,
          description,
          params.bookingDate,
          params.startTime,
          endTime
        );
      }
    } catch (calErr: unknown) {
      logger.error('Calendar event creation error', { extra: { error: getErrorMessage(calErr) } });
    }
  }

  const memberName = member.firstName && member.lastName 
    ? `${member.firstName} ${member.lastName}` 
    : resolvedMemberEmail;
  
  const bookingNotes = params.notes 
    ? `${params.notes}\n[Source: ${params.bookingSource}]` 
    : `[Source: ${params.bookingSource}]`;
  
  const [newBooking] = await db.insert(bookingRequests)
    .values({
      resourceId: params.resourceId,
      userEmail: resolvedMemberEmail,
      userId: resolvedUserId,
      userName: memberName,
      resourcePreference: resource.name,
      requestDate: params.bookingDate,
      startTime: params.startTime,
      endTime: endTime,
      durationMinutes: params.durationMinutes,
      notes: bookingNotes,
      staffNotes: params.staffNotes || null,
      status: 'approved',
      guestCount: params.guestCount,
      reviewedBy: params.staffEmail,
      reviewedAt: new Date(),
      calendarEventId: calendarEventId,
      trackmanBookingId: params.trackmanBookingId || null
    })
    .returning();

  try {
    const formattedDate = new Date(params.bookingDate + 'T00:00:00').toLocaleDateString('en-US', { 
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles'
    });
    const formatTime = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour12 = h % 12 || 12;
      return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
    };
    const notifTitle = 'Booking Confirmed';
    const notifMessage = `Your ${resource.type === 'simulator' ? 'golf simulator' : 'conference room'} booking for ${formattedDate} at ${formatTime(params.startTime)} has been confirmed.`;
    
    await notifyMember({
      userEmail: resolvedMemberEmail,
      title: notifTitle,
      message: notifMessage,
      type: 'booking_approved',
      relatedId: newBooking.id,
      relatedType: 'booking'
    });
  } catch (notifErr: unknown) {
    logger.error('Failed to send manual booking notification', { extra: { error: getErrorMessage(notifErr) } });
  }

  bookingEvents.publish('booking_approved', {
    bookingId: newBooking.id,
    memberEmail: resolvedMemberEmail,
    memberName: memberName,
    resourceId: params.resourceId,
    resourceName: resource.name,
    resourceType: resource.type,
    bookingDate: params.bookingDate,
    startTime: params.startTime,
    endTime: endTime,
    status: 'approved',
    actionBy: 'staff',
    staffEmail: params.staffEmail,
    isManualBooking: true
  }, { notifyMember: true, notifyStaff: true }).catch(err => logger.error('Booking event publish failed', { extra: { error: getErrorMessage(err) } }));

  return {
    booking: {
      ...newBooking,
      resource_name: resource.name,
      resource_type: resource.type,
      member_name: member.firstName && member.lastName 
        ? `${member.firstName} ${member.lastName}` 
        : null
    }
  };
}

class ManualBookingValidationError extends Error {
  constructor(public statusCode: number, public errorBody: Record<string, unknown>) {
    super(typeof errorBody.error === 'string' ? errorBody.error : 'Booking validation error');
    this.name = 'ManualBookingValidationError';
  }
}

export { ManualBookingValidationError };

interface StaffManualBookingResult {
  row: Record<string, unknown>;
  dayPassRedeemed: boolean;
}

export async function createStaffManualBooking(
  input: StaffManualBookingInput,
  staffEmail: string
): Promise<StaffManualBookingResult> {
  const trackman_id = input.trackman_booking_id || input.trackman_external_id;

  let resolvedEmail: string;
  let resolvedUserId: string | null = null;
  let end_time: string;
  let resolvedResourceType: string;

  const participantEmails = (input.request_participants || [])
    .map((p: Record<string, unknown>) => typeof p.email === 'string' ? p.email.trim().toLowerCase() : '')
    .filter(Boolean);

  try {
    const prepared = await prepareBookingCreation(
      { userEmail: input.user_email || '', startTime: input.start_time, requestDate: input.request_date, durationMinutes: input.duration_minutes, resourceId: input.resource_id, participantEmails },
      { isStaff: true, allowPastDate: true, strictMidnight: true }
    );
    resolvedEmail = prepared.resolvedEmail;
    resolvedUserId = prepared.resolvedUserId;
    end_time = prepared.endTime;
    resolvedResourceType = prepared.resourceType;
  } catch (e: unknown) {
    if (e instanceof BookingValidationError) {
      throw new ManualBookingValidationError(e.statusCode, e.errorBody);
    }
    throw e;
  }

  if (trackman_id) {
    const [duplicate] = await db.select({ id: bookingRequests.id, status: bookingRequests.status, userEmail: bookingRequests.userEmail })
      .from(bookingRequests)
      .where(eq(bookingRequests.trackmanBookingId, trackman_id))
      .limit(1);

    if (duplicate) {
      const terminalStatuses = ['cancelled', 'cancellation_pending', 'declined', 'no_show'];
      const sameEmail = input.user_email && duplicate.userEmail &&
        resolvedEmail === duplicate.userEmail?.toLowerCase();

      if (terminalStatuses.includes(duplicate.status || '')) {
        await db.update(bookingRequests)
          .set({ trackmanBookingId: null })
          .where(eq(bookingRequests.id, duplicate.id));
      } else if (sameEmail) {
        const duplicateId = duplicate.id as number;
        const updateResult = await db.update(bookingRequests)
          .set({
            trackmanBookingId: null,
            status: 'declined',
            staffNotes: sql`COALESCE(staff_notes, '') || ' [Auto-declined: Trackman ID re-linked via manual booking for the same member]'`,
            reviewedBy: 'system_relink',
            reviewedAt: sql`NOW()`,
            updatedAt: sql`NOW()`
          })
          .where(and(
            eq(bookingRequests.id, duplicateId),
            sql`${bookingRequests.status} NOT IN ('cancelled', 'cancellation_pending', 'declined', 'no_show')`
          ))
          .returning({ id: bookingRequests.id });

        if (updateResult.length > 0) {
          const orphanedSession = await db.execute(sql`
            SELECT id FROM booking_sessions WHERE id = (
              SELECT session_id FROM booking_requests WHERE id = ${duplicateId}
            )
          `).then(r => (r.rows as Array<Record<string, unknown>>)[0]);

          if (orphanedSession?.id) {
            await db.execute(sql`DELETE FROM booking_sessions WHERE id = ${orphanedSession.id}`);
          }
        }

        logger.info('[ManualBooking] Declined orphaned same-member booking during Trackman re-link', {
          extra: { declinedBookingId: duplicateId, trackmanId: trackman_id, updated: updateResult.length > 0 }
        });
      } else {
        throw new ManualBookingValidationError(409, {
          error: `Trackman Booking ID ${trackman_id} is already linked to another booking (#${duplicate.id}). Each Trackman booking can only be linked once.`
        });
      }
    }
  }

  const rawParticipants = Array.isArray(input.request_participants)
    ? input.request_participants.slice(0, 3)
    : [];

  const isDayPassPayment = input.paymentStatus === 'Paid (Day Pass)' && input.dayPassPurchaseId;

  let row: Record<string, unknown>;
  let dayPassRedeemed = false;

  const txResult = await db.transaction(async (tx) => {
    let sanitizedParticipants: Array<{ email: string; type: 'member' | 'guest'; userId?: string; name?: string }>;
    try {
      sanitizedParticipants = await sanitizeAndResolveParticipants(
        rawParticipants as Array<{ email?: string; type?: string; userId?: string; name?: string }>,
        resolvedEmail,
        tx,
        { isStaff: true, maxGuests: 3 }
      );
    } catch (e: unknown) {
      if (e instanceof BookingValidationError) {
        throw new ManualBookingValidationError(e.statusCode, e.errorBody);
      }
      throw e;
    }

    const staffParticipantEmails = sanitizedParticipants
      .map(p => p.email?.trim().toLowerCase())
      .filter(Boolean) as string[];

    const txClient = tx as unknown as { select: typeof db.select; execute: typeof db.execute };

    try {
      await acquireLocksAndCheckConflicts(tx as unknown as Parameters<typeof acquireBookingLocks>[0], {
        resourceId: input.resource_id || null,
        requestDate: input.request_date,
        startTime: input.start_time,
        endTime: end_time,
        requestEmail: resolvedEmail,
        isStaffRequest: true,
        isViewAsMode: false,
        resourceType: resolvedResourceType,
        participantEmails: staffParticipantEmails,
        txClient,
      });
    } catch (err: unknown) {
      if (err instanceof BookingValidationError) {
        throw new ManualBookingValidationError(err.statusCode, err.errorBody);
      }
      if (err instanceof BookingConflictError) {
        throw new ManualBookingValidationError(err.statusCode, err.errorBody);
      }
      throw err;
    }

    if (isDayPassPayment) {
      const dayPassResult = await tx.execute(sql`
        SELECT id, purchaser_email, redeemed_at, status, remaining_uses, booking_id
        FROM day_pass_purchases 
        WHERE id = ${input.dayPassPurchaseId}
        FOR UPDATE
      `);

      if (dayPassResult.rows.length === 0) {
        throw new ManualBookingValidationError(404, { error: 'Day pass not found' });
      }

      const dayPass = dayPassResult.rows[0] as Record<string, unknown>;

      if ((dayPass.purchaser_email as string).toLowerCase() !== resolvedEmail) {
        throw new ManualBookingValidationError(403, { error: 'Day pass belongs to a different user' });
      }

      if (dayPass.redeemed_at !== null || dayPass.booking_id !== null) {
        throw new ManualBookingValidationError(400, { error: 'Day pass has already been redeemed' });
      }

      if (dayPass.status === 'redeemed' || (dayPass.remaining_uses !== null && (dayPass.remaining_uses as number) <= 0)) {
        throw new ManualBookingValidationError(400, { error: 'Day pass has already been used' });
      }
    }

    await tx.execute(sql`
      SELECT id FROM booking_requests 
      WHERE LOWER(user_email) = LOWER(${resolvedEmail}) 
      AND request_date = ${input.request_date} 
      AND status IN ('pending', 'approved', 'confirmed')
      ORDER BY id ASC
      FOR UPDATE
    `);

    const bookingStatus = isDayPassPayment ? 'approved' : 'pending';

    const trackmanBookingIdVal = input.trackman_booking_id || input.trackman_external_id;
    const insertResult = await tx.execute(sql`
      INSERT INTO booking_requests (
        user_email, user_name, user_id, resource_id, 
        request_date, start_time, duration_minutes, end_time,
        declared_player_count, request_participants,
        trackman_booking_id, trackman_external_id, origin,
        status, created_at, updated_at
      ) VALUES (
        ${resolvedEmail},
        ${input.user_name || null},
        ${resolvedUserId || null},
        ${input.resource_id || null},
        ${input.request_date},
        ${input.start_time},
        ${input.duration_minutes},
        ${end_time},
        ${input.declared_player_count && input.declared_player_count >= 1 && input.declared_player_count <= 4 ? input.declared_player_count : null},
        ${sanitizedParticipants.length > 0 ? JSON.stringify(sanitizedParticipants) : '[]'},
        ${trackmanBookingIdVal ?? null},
        ${input.trackman_external_id || null},
        ${'staff_manual'},
        ${bookingStatus},
        NOW(), NOW()
      )
      RETURNING *
    `);

    const dbRow = insertResult.rows[0] as Record<string, unknown>;
    const bookingId = dbRow.id as number;

    let txDayPassRedeemed = false;
    if (isDayPassPayment) {
      await tx.execute(sql`
        UPDATE day_pass_purchases 
        SET redeemed_at = NOW(),
            booking_id = ${bookingId},
            status = 'redeemed',
            remaining_uses = 0,
            updated_at = NOW()
        WHERE id = ${input.dayPassPurchaseId}
      `);

      await tx.execute(sql`
        INSERT INTO pass_redemption_logs (purchase_id, redeemed_by, location, notes)
        VALUES (${input.dayPassPurchaseId}, ${staffEmail}, ${'staff_manual_booking'}, ${'Redeemed via manual booking #' + bookingId})
      `);

      txDayPassRedeemed = true;
      logger.info('[StaffManualBooking] Day pass redeemed for booking', { extra: { dayPassPurchaseId: input.dayPassPurchaseId, bookingId } });
    }

    if (isDayPassPayment && dbRow.resource_id) {
      const sessionResult = await ensureSessionForBooking({
        bookingId: bookingId,
        resourceId: dbRow.resource_id as number,
        sessionDate: input.request_date,
        startTime: input.start_time,
        endTime: (dbRow.end_time as string) || end_time,
        ownerEmail: resolvedEmail,
        ownerName: input.user_name || (dbRow.user_name as string) || undefined,
        source: 'staff_manual',
        createdBy: 'staff_manual_day_pass'
      }, createTxQueryClient(tx));
      if (sessionResult.error) {
        throw new Error(`Session creation failed for day pass booking: ${sessionResult.error}`);
      }
    }

    return {
      row: {
        id: dbRow.id as number,
        userEmail: dbRow.user_email as string,
        userName: dbRow.user_name as string,
        resourceId: dbRow.resource_id as number,
        requestDate: dbRow.request_date as string,
        startTime: dbRow.start_time as string,
        durationMinutes: dbRow.duration_minutes as number,
        endTime: dbRow.end_time as string,
        status: dbRow.status as string,
        declaredPlayerCount: dbRow.declared_player_count as number,
        requestParticipants: (dbRow.request_participants as unknown as unknown[]) || [],
        trackmanExternalId: dbRow.trackman_external_id as string,
        origin: dbRow.origin as string,
        createdAt: dbRow.created_at,
        updatedAt: dbRow.updated_at
      },
      dayPassRedeemed: txDayPassRedeemed
    };
  });

  row = txResult.row;
  dayPassRedeemed = txResult.dayPassRedeemed;

  return { row, dayPassRedeemed };
}

export function fireManualBookingPostCommitEffects(
  row: Record<string, unknown>,
  dayPassRedeemed: boolean,
  input: StaffManualBookingInput,
  auditLogFn: (action: string, entityType: string, entityId: string, entityName: string, metadata: Record<string, unknown>) => void
): void {
  const trackman_id = input.trackman_booking_id || input.trackman_external_id;
  const isDayPassPayment = input.paymentStatus === 'Paid (Day Pass)' && input.dayPassPurchaseId;

  try {
    if (row.status === 'approved') {
      refreshBookingPass(row.id as number).catch(err =>
        logger.error('[StaffManualBooking] Wallet pass refresh failed', { extra: { bookingId: row.id, error: getErrorMessage(err) } })
      );
    }

    let resourceName = 'Bay';
    let resourceType = 'simulator';
    if (row.resourceId) {
      db.select({ name: resources.name, type: resources.type }).from(resources).where(eq(resources.id, row.resourceId as number))
        .then(([resource]) => {
          if (resource?.name) resourceName = resource.name;
          if (resource?.type) resourceType = resource.type;
        })
        .catch((e: unknown) => logger.error('[ManualBooking] Failed to fetch resource name', { extra: { error: getErrorMessage(e) } }))
        .finally(() => {
          sendNotificationAndBroadcast(row, resourceName, resourceType, input, dayPassRedeemed, trackman_id!, auditLogFn, isDayPassPayment);
        });
    } else {
      sendNotificationAndBroadcast(row, resourceName, resourceType, input, dayPassRedeemed, trackman_id!, auditLogFn, isDayPassPayment);
    }
  } catch (postCommitError: unknown) {
    logger.error('[StaffManualBooking] Post-commit operations failed', { extra: { error: getErrorMessage(postCommitError) } });
  }
}

function sendNotificationAndBroadcast(
  row: Record<string, unknown>,
  resourceName: string,
  resolvedResourceType: string,
  input: StaffManualBookingInput,
  dayPassRedeemed: boolean,
  trackman_id: string,
  auditLogFn: (action: string, entityType: string, entityId: string, entityName: string, metadata: Record<string, unknown>) => void,
  isDayPassPayment: unknown
): void {
  const dateStr = typeof row.requestDate === 'string'
    ? row.requestDate
    : input.request_date;
  const formattedDate = formatDateDisplayWithDay(dateStr);
  const formattedTime12h = formatTime12Hour(String(row.startTime || '').substring(0, 5) || input.start_time.substring(0, 5));

  const durationMins = row.durationMinutes || input.duration_minutes;
  let durationDisplay = '';
  if (durationMins) {
    if (Number(durationMins) < 60) {
      durationDisplay = `${durationMins} min`;
    } else {
      const hrs = Number(durationMins) / 60;
      durationDisplay = hrs === Math.floor(hrs) ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${hrs.toFixed(1)} hrs`;
    }
  }

  const playerCount = input.declared_player_count && input.declared_player_count > 1 ? ` (${input.declared_player_count} players)` : '';
  const dayPassNote = dayPassRedeemed ? ' [Day Pass]' : '';

  const staffTitle = 'Staff Manual Booking Created';
  const staffMessage = `${row.userName || row.userEmail}${playerCount} - ${resourceName} on ${formattedDate} at ${formattedTime12h} for ${durationDisplay}${dayPassNote} (Trackman: ${trackman_id})`;

  notifyAllStaff(
    staffTitle,
    staffMessage,
    'booking',
    {
      relatedId: row.id as number,
      relatedType: 'booking_request'
    }
  ).catch(err => logger.error('Staff notification failed:', { extra: { error: getErrorMessage(err) } }));

  broadcastAvailabilityUpdate({
    resourceId: (row.resourceId as number) || undefined,
    resourceType: resolvedResourceType,
    date: row.requestDate as string,
    action: 'booked'
  });

  auditLogFn('create_booking', 'booking', String(row.id), (row.userName || row.userEmail) as string, {
    trackman_booking_id: trackman_id,
    origin: 'staff_manual',
    resource_id: row.resourceId,
    request_date: row.requestDate,
    start_time: row.startTime,
    day_pass_id: dayPassRedeemed ? input.dayPassPurchaseId : undefined,
    payment_status: isDayPassPayment ? 'paid_day_pass' : undefined
  });
}
