import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { resources, users, bookingRequests, trackmanUnmatchedBookings, userLinkedEmails } from '../../../shared/schema';
import { logger } from '../logger';
import { recalculateSessionFees } from '../billing/unifiedFeeService';
import { ensureSessionForBooking } from '../bookingService/sessionManager';
import { AppError } from '../errors';
import { ensureDateString } from '../../utils/dateTimeUtils';
import { getErrorMessage } from '../../utils/errorUtils';

interface DrizzleExecuteResult<T = Record<string, unknown>> {
  rows?: T[];
  rowCount?: number;
}

interface TrackmanWebhookRow {
  payload: string | Record<string, unknown>;
  trackman_booking_id: string;
}

interface TrackmanPayloadData {
  start?: string;
  end?: string;
  bay?: { ref?: string; name?: string };
  [key: string]: unknown;
}

interface MemberLookupRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface LinkedEmailIdRow {
  id: number;
}

export async function resolveOwnerEmail(ownerEmail: string) {
  let resolvedOwnerEmail = ownerEmail.toLowerCase().trim();
  
  const [linkedEmailRecord] = await db.select({ primaryEmail: userLinkedEmails.primaryEmail })
    .from(userLinkedEmails)
    .where(sql`LOWER(${userLinkedEmails.linkedEmail}) = ${resolvedOwnerEmail}`);
  
  if (linkedEmailRecord?.primaryEmail) {
    resolvedOwnerEmail = linkedEmailRecord.primaryEmail.toLowerCase();
    logger.info('[link-trackman-to-member] Resolved email alias via user_linked_emails', {
      extra: { original: ownerEmail, resolved: resolvedOwnerEmail }
    });
  }
  
  if (resolvedOwnerEmail === ownerEmail.toLowerCase().trim()) {
    const usersWithAlias = await db.select({ email: users.email, manuallyLinkedEmails: users.manuallyLinkedEmails })
      .from(users)
      .where(sql`${users.manuallyLinkedEmails} IS NOT NULL`);
    
    for (const user of usersWithAlias) {
      if (user.manuallyLinkedEmails && user.email) {
        const linkedList = typeof user.manuallyLinkedEmails === 'string' 
          ? user.manuallyLinkedEmails.split(',').map(e => e.trim().toLowerCase())
          : [];
        if (linkedList.includes(ownerEmail.toLowerCase().trim())) {
          resolvedOwnerEmail = user.email.toLowerCase();
          logger.info('[link-trackman-to-member] Resolved email alias via manuallyLinkedEmails', {
            extra: { original: ownerEmail, resolved: resolvedOwnerEmail }
          });
          break;
        }
      }
    }
  }
  
  return resolvedOwnerEmail;
}


export async function getBookingDataForTrackman(trackmanBookingId: string) {
  let bookingData: { resourceId: number | null; requestDate: string; startTime: string; endTime: string | null } | null = null;
  
  const [existingBooking] = await db.select({
    id: bookingRequests.id,
    resourceId: bookingRequests.resourceId,
    requestDate: bookingRequests.requestDate,
    startTime: bookingRequests.startTime,
    endTime: bookingRequests.endTime
  })
    .from(bookingRequests)
    .where(eq(bookingRequests.trackmanBookingId, trackmanBookingId));
  
  if (existingBooking) {
    bookingData = {
      resourceId: existingBooking.resourceId,
      requestDate: existingBooking.requestDate,
      startTime: existingBooking.startTime,
      endTime: existingBooking.endTime
    };
    return { bookingData, existingBooking };
  }
  
  const [unmatchedBooking] = await db.select({
    id: trackmanUnmatchedBookings.id,
    bayNumber: trackmanUnmatchedBookings.bayNumber,
    bookingDate: trackmanUnmatchedBookings.bookingDate,
    startTime: trackmanUnmatchedBookings.startTime,
    endTime: trackmanUnmatchedBookings.endTime
  })
    .from(trackmanUnmatchedBookings)
    .where(eq(trackmanUnmatchedBookings.trackmanBookingId, trackmanBookingId));
  
  if (unmatchedBooking) {
    let resourceId: number | null = null;
    if (unmatchedBooking.bayNumber) {
      const [resource] = await db.select({ id: resources.id })
        .from(resources)
        .where(eq(resources.name, `Bay ${unmatchedBooking.bayNumber}`));
      resourceId = resource?.id ?? null;
    }
    bookingData = {
      resourceId,
      requestDate: unmatchedBooking.bookingDate,
      startTime: unmatchedBooking.startTime,
      endTime: unmatchedBooking.endTime
    };
    return { bookingData, existingBooking: null };
  }
  
  const webhookResult = await db.execute(sql`SELECT payload FROM trackman_webhook_events WHERE trackman_booking_id = ${trackmanBookingId} ORDER BY created_at DESC LIMIT 1`);
  
  if ((webhookResult.rows as unknown as TrackmanWebhookRow[]).length > 0) {
    let payload: TrackmanPayloadData;
    try {
      const webhookRow = (webhookResult.rows as unknown as TrackmanWebhookRow[])[0];
      payload = typeof webhookRow.payload === 'string' 
        ? JSON.parse(webhookRow.payload) 
        : webhookRow.payload as unknown as TrackmanPayloadData;
    } catch (parseErr) {
      logger.error('[resourceService] Failed to parse trackman webhook payload', { extra: { trackmanBookingId, error: getErrorMessage(parseErr) } });
      payload = {};
    }
    const data = ((payload?.data || payload?.booking || {}) as unknown as TrackmanPayloadData);
    
    const startStr = data?.start;
    const endStr = data?.end;
    const bayRef = data?.bay?.ref;
    
    if (startStr && endStr) {
      const startDate = new Date(startStr.includes('T') ? startStr : startStr.replace(' ', 'T') + 'Z');
      const endDate = new Date(endStr.includes('T') ? endStr : endStr.replace(' ', 'T') + 'Z');
      
      const requestDate = startDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const startTime = startDate.toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' 
      }) + ':00';
      const endTime = endDate.toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' 
      }) + ':00';
      
      let resourceId = 1;
      if (bayRef) {
        const bayNum = parseInt(bayRef, 10);
        if (bayNum >= 1 && bayNum <= 4) resourceId = bayNum;
      }
      
      bookingData = { resourceId, requestDate, startTime, endTime };
    }
  }
  
  return { bookingData, existingBooking: null };
}


export async function linkTrackmanToMember(
  trackmanBookingId: string,
  ownerEmail: string,
  ownerName: string,
  ownerId: string | null,
  additionalPlayers: Array<{ type: 'member' | 'guest_placeholder'; member_id?: string | null; email?: string; name?: string; guest_name?: string }>,
  totalPlayerCount: number,
  guestCount: number,
  staffEmail: string
) {
  const memberEmails = [ownerEmail.trim().toLowerCase()];
  for (const p of additionalPlayers) {
    if (p.type !== 'guest_placeholder' && p.email) {
      const normalizedEmail = p.email.trim().toLowerCase();
      if (memberEmails.includes(normalizedEmail)) {
        throw new AppError(400, `Duplicate player: ${p.name || p.email} is already assigned to another slot in this booking`);
      }
      memberEmails.push(normalizedEmail);
    }
  }

  let resolvedOwnerId = ownerId ? String(ownerId) : null;
  if (!resolvedOwnerId && ownerEmail) {
    const [userRow] = await db.select({ id: users.id })
      .from(users)
      .where(sql`LOWER(${users.email}) = ${ownerEmail.toLowerCase()}`)
      .limit(1);
    if (userRow) {
      resolvedOwnerId = userRow.id;
    }
  }

  const result = await db.transaction(async (tx) => {
    const [existingBooking] = await tx.select()
      .from(bookingRequests)
      .where(eq(bookingRequests.trackmanBookingId, trackmanBookingId));
    
    let booking;
    let created = false;
    
    const participantsJson = additionalPlayers.map(p => {
      if (p.type === 'guest_placeholder') {
        return { type: 'guest' as const, name: p.guest_name || 'Guest (info pending)' };
      }
      return { type: 'member' as const, email: p.email, name: p.name, userId: p.member_id };
    });

    if (existingBooking) {
      const staffNoteSuffix = ` [Linked to member via staff: ${ownerName} with ${totalPlayerCount} players]`;
      const newStaffNotes = (existingBooking.staffNotes || '') + staffNoteSuffix;
      const [updated] = await tx.update(bookingRequests)
        .set({
          userEmail: ownerEmail.toLowerCase(),
          userName: ownerName,
          userId: resolvedOwnerId,
          isUnmatched: false,
          status: 'approved',
          declaredPlayerCount: totalPlayerCount,
          guestCount: guestCount,
          requestParticipants: participantsJson.length > 0 ? participantsJson : undefined,
          staffNotes: newStaffNotes,
          updatedAt: new Date()
        })
        .where(eq(bookingRequests.id, existingBooking.id))
        .returning();
      booking = updated;
    } else {
      const webhookResult = await tx.execute(sql`
        SELECT payload, trackman_booking_id 
        FROM trackman_webhook_events 
        WHERE trackman_booking_id = ${trackmanBookingId}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const webhookLog = (webhookResult as unknown as DrizzleExecuteResult<TrackmanWebhookRow>).rows?.[0];
      
      if (!webhookLog) {
        throw new AppError(404, 'Trackman booking not found in webhook logs');
      }
      
      let payload: Record<string, unknown>;
      try {
        payload = typeof webhookLog.payload === 'string' 
          ? JSON.parse(webhookLog.payload) 
          : webhookLog.payload as unknown as TrackmanPayloadData;
      } catch (parseErr) {
        logger.error('[resourceService] Failed to parse trackman webhook payload', { extra: { trackmanBookingId, error: getErrorMessage(parseErr) } });
        throw new AppError(500, 'Failed to parse webhook payload data');
      }
      const bookingData = ((payload?.data || payload?.booking || {}) as unknown as TrackmanPayloadData);
      
      const startStr = bookingData?.start;
      const endStr = bookingData?.end;
      const bayRef = bookingData?.bay?.ref;
      
      if (!startStr || !endStr) {
        throw new AppError(400, 'Cannot extract booking time from webhook data');
      }
      
      const startDate = new Date(startStr.includes('T') ? startStr : startStr.replace(' ', 'T') + 'Z');
      const endDate = new Date(endStr.includes('T') ? endStr : endStr.replace(' ', 'T') + 'Z');
      
      const requestDate = startDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
      const startTime = startDate.toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' 
      }) + ':00';
      const endTime = endDate.toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' 
      }) + ':00';
      
      let resourceId = 1;
      if (bayRef) {
        const bayNum = parseInt(bayRef, 10);
        if (bayNum >= 1 && bayNum <= 4) {
          resourceId = bayNum;
        }
      }
      
      const [newBooking] = await tx.insert(bookingRequests)
        .values({
          userEmail: ownerEmail.toLowerCase(),
          userName: ownerName,
          userId: resolvedOwnerId,
          resourceId,
          requestDate,
          startTime,
          endTime,
          status: 'approved',
          trackmanBookingId: trackmanBookingId,
          isUnmatched: false,
          declaredPlayerCount: totalPlayerCount,
          guestCount: guestCount,
          requestParticipants: participantsJson.length > 0 ? participantsJson : undefined,
          staffNotes: `[Linked from Trackman webhook by staff: ${ownerName} with ${totalPlayerCount} players]`,
          createdAt: new Date(),
          updatedAt: new Date()
        } as typeof bookingRequests.$inferInsert)
        .returning();
      booking = newBooking;
      created = true;
      
      await tx.execute(sql`
        UPDATE trackman_webhook_events 
        SET matched_booking_id = ${booking.id}
        WHERE trackman_booking_id = ${trackmanBookingId}
      `);
    }
    
    const sessionId = existingBooking?.sessionId || null;
    return { booking, created, sessionId };
  });
  
  let finalSessionId: number | null = result.sessionId || null;

  if (result.sessionId) {
    try {
      await db.execute(sql`UPDATE booking_participants
        SET user_id = ${resolvedOwnerId || null},
            display_name = ${ownerName}
        WHERE session_id = ${result.sessionId} AND participant_type = 'owner'`);
    } catch (ownerUpdateErr: unknown) {
      logger.warn('[link-trackman-to-member] Failed to update session owner participant', {
        extra: { bookingId: result.booking.id, sessionId: result.sessionId, error: ownerUpdateErr }
      });
    }
    logger.info('[link-trackman-to-member] Using existing session, updated owner participant', {
      extra: { bookingId: result.booking.id, sessionId: result.sessionId }
    });
  } else {
    try {
      const booking = result.booking;
      const sessionResult = await ensureSessionForBooking({
        bookingId: booking.id,
        resourceId: booking.resourceId!,
        sessionDate: ensureDateString(booking.requestDate),
        startTime: booking.startTime || '',
        endTime: booking.endTime || '',
        ownerEmail: ownerEmail,
        ownerName: ownerName,
        trackmanBookingId: trackmanBookingId,
        source: 'trackman_webhook',
        createdBy: staffEmail
      });
      if (sessionResult.sessionId) {
        finalSessionId = sessionResult.sessionId;
        await db.execute(sql`UPDATE booking_participants SET payment_status = 'waived' WHERE session_id = ${sessionResult.sessionId} AND (payment_status = 'pending' OR payment_status IS NULL) AND user_id IS NULL AND guest_id IS NULL`);
        await db.update(bookingRequests).set({ sessionId: sessionResult.sessionId }).where(eq(bookingRequests.id, booking.id));
        logger.info('[link-trackman-to-member] Created new session after member assignment — real members kept pending, ghosts waived', {
          extra: { bookingId: booking.id, sessionId: sessionResult.sessionId, ownerEmail, ownerName }
        });
      }
    } catch (sessionErr: unknown) {
      logger.warn('[link-trackman-to-member] Failed to create session after member assignment', {
        extra: { bookingId: result.booking.id, error: getErrorMessage(sessionErr) }
      });
    }
  }

  if (finalSessionId && additionalPlayers.length > 0) {
    try {
      const durationMinutes = result.booking.durationMinutes || 60;
      const slotDuration = Math.floor(durationMinutes / Math.max(totalPlayerCount, 1));

      for (const player of additionalPlayers) {
        if (player.type === 'guest_placeholder') {
          await db.execute(sql`INSERT INTO booking_participants (session_id, participant_type, display_name, slot_duration, payment_status, used_guest_pass, created_at)
             VALUES (${finalSessionId}, 'guest', ${player.guest_name || 'Guest (info pending)'}, ${slotDuration}, 'pending', false, NOW())`);
        } else if (player.type === 'member' && player.email) {
          const memberLookup = await db.execute(sql`SELECT id, first_name, last_name FROM users WHERE LOWER(email) = LOWER(${player.email}) LIMIT 1`);
          const memberRow = (memberLookup.rows as unknown as MemberLookupRow[])[0];
          const displayName = memberRow ? [memberRow.first_name, memberRow.last_name].filter(Boolean).join(' ') || player.email : player.email;
          await db.execute(sql`INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, created_at)
             VALUES (${finalSessionId}, ${memberRow?.id || null}, 'member', ${displayName}, ${slotDuration}, 'pending', NOW())`);
        }
      }

      logger.info('[link-trackman-to-member] Added additional player participants', {
        extra: { bookingId: result.booking.id, sessionId: finalSessionId, additionalCount: additionalPlayers.length }
      });
    } catch (partErr: unknown) {
      logger.warn('[link-trackman-to-member] Failed to add additional player participants', {
        extra: { bookingId: result.booking.id, sessionId: finalSessionId, error: getErrorMessage(partErr) }
      });
    }
  }

  if (finalSessionId) {
    try {
      await recalculateSessionFees(finalSessionId, 'approval');
      logger.info('[link-trackman-to-member] Recalculated fees after member assignment', {
        extra: { bookingId: result.booking.id, sessionId: finalSessionId, newOwner: ownerEmail }
      });
    } catch (recalcErr: unknown) {
      logger.warn('[link-trackman-to-member] Failed to recalculate fees after assignment', {
        extra: { bookingId: result.booking.id, sessionId: finalSessionId, error: getErrorMessage(recalcErr) }
      });
    }
  }

  const { broadcastToStaff } = await import('../websocket');
  broadcastToStaff({
    type: 'booking_updated',
    bookingId: result.booking.id,
    action: 'trackman_linked',
    memberEmail: ownerEmail,
    memberName: ownerName,
    totalPlayers: totalPlayerCount
  });
  
  return result;
}

export async function linkEmailToMember(ownerEmail: string, originalEmail: string) {
  try {
    const existingLink = await db.execute(sql`SELECT id FROM user_linked_emails WHERE LOWER(linked_email) = LOWER(${originalEmail})`);
    
    if ((existingLink.rows as unknown as LinkedEmailIdRow[]).length === 0 && ownerEmail.toLowerCase() !== originalEmail.toLowerCase()) {
      const [member] = await db.select().from(users).where(eq(users.email, ownerEmail.toLowerCase())).limit(1);
      if (member) {
        await db.execute(sql`INSERT INTO user_linked_emails (primary_email, linked_email, source, created_at) 
           VALUES (${member.email}, ${originalEmail.toLowerCase()}, ${'staff_assignment'}, NOW())
           ON CONFLICT (linked_email) DO NOTHING`);
        logger.info('[resourceService] Linked email to member', {
          extra: { memberEmail: ownerEmail, linkedEmail: originalEmail, memberId: member.id }
        });
        return true;
      }
    }
  } catch (linkErr: unknown) {
    logger.warn('[resourceService] Failed to link email', { extra: { error: getErrorMessage(linkErr) } });
  }
  return false;
}
