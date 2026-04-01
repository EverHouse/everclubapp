import { db } from '../../db';
import { pool, safeRelease } from '../db';
import { bookingRequests, resources, notifications, users, bookingParticipants, stripePaymentIntents } from '../../../shared/schema';
import { eq, and, or, gt, lt, lte, gte, ne, sql, isNull, isNotNull } from 'drizzle-orm';
import { sendPushNotification } from '../pushService';
import { formatNotificationDateTime, formatDateDisplayWithDay, formatTime12Hour, formatDateFromDb } from '../../utils/dateUtils';
import { logger } from '../logger';
import { notifyAllStaff, notifyMember, isSyntheticEmail } from '../notificationService';
import { checkClosureConflict, checkAvailabilityBlockConflict } from '../bookingValidation';
import { bookingEvents } from '../bookingEvents';
import { sendNotificationToUser, broadcastAvailabilityUpdate, broadcastMemberStatsUpdated, broadcastBillingUpdate } from '../websocket';
import { refundGuestPass } from '../billing/guestPassService';
import { updateHubSpotContactVisitCount } from '../memberSync';
import { createSessionWithUsageTracking, ensureSessionForBooking, createOrFindGuest } from './sessionManager';
import { recalculateSessionFees } from '../billing/unifiedFeeService';
import type { DevConfirmBookingRow } from './approvalCheckin';
import { PaymentStatusService } from '../billing/PaymentStatusService';
import { cancelPaymentIntent, getStripeClient } from '../stripe';
import { cancelPendingPaymentIntentsForBooking } from '../billing/paymentIntentCleanup';
import Stripe from 'stripe';
import { getCalendarNameForBayAsync } from '../calendar/calendarHelpers';
import { getCalendarIdByName, createCalendarEventOnCalendar, deleteCalendarEvent } from '../calendar/index';
import { releaseGuestPassHold } from '../billing/guestPassHoldService';
import { createPrepaymentIntent } from '../billing/prepaymentService';
import { voidBookingInvoice, finalizeAndPayInvoice, syncBookingInvoice, getBookingInvoiceId } from '../billing/bookingInvoiceService';
import { getErrorMessage } from '../../utils/errorUtils';
import { DeferredSideEffects } from '../deferredSideEffects';
import { upsertVisitor } from '../visitors/matchingService';
import { AppError } from '../errors';
import { logPaymentAudit } from '../auditLog';
import { voidBookingPass, refreshBookingPass } from '../../walletPass/bookingPassService';
import { BookingUpdateResult, CancelBookingData, CancelPushInfo } from './approvalTypes';

interface DevConfirmParams {
  bookingId: number;
  staffEmail: string;
}

export async function devConfirmBooking(params: DevConfirmParams) {
  const { bookingId, staffEmail: _staffEmail } = params;

  const bookingResult = await db.execute(sql`
    SELECT br.*, u.id as user_id, u.stripe_customer_id, u.tier
     FROM booking_requests br
     LEFT JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
     WHERE br.id = ${bookingId}
  `);

  if (bookingResult.rows.length === 0) {
    return { error: 'Booking not found', statusCode: 404 };
  }

  const booking = bookingResult.rows[0] as unknown as DevConfirmBookingRow;

  if (booking.status !== 'pending' && booking.status !== 'pending_approval') {
    return { error: `Booking is already ${booking.status}`, statusCode: 400 };
  }

  // eslint-disable-next-line no-useless-assignment
  let resolvedTotalFeeCents = 0;
  let transactionResult: { sessionId: number | null; totalFeeCents: number; dateStr: string; timeStr: string; participantEmails: string[] };
  try {
  transactionResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('approve_booking_' || ${String(bookingId)}))`);

    if (booking.resource_id && booking.request_date) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${String(booking.resource_id)} || '::' || ${booking.request_date as string}))`);
    }

    let sessionId = booking.session_id;
    const totalFeeCents = 0;

    if (!sessionId && booking.resource_id) {
      const sessionResult = await ensureSessionForBooking({
        bookingId,
        resourceId: booking.resource_id as number,
        sessionDate: booking.request_date as string,
        startTime: booking.start_time as string,
        endTime: booking.end_time as string,
        ownerEmail: (booking.user_email || booking.owner_email || '') as string,
        ownerName: (booking.user_name || undefined) as string | undefined,
        ownerUserId: booking.user_id?.toString() || undefined,
        source: 'staff_manual',
        createdBy: 'dev_confirm'
      });
      sessionId = sessionResult.sessionId || null;

      if (!sessionId) {
        logger.error('[Dev Confirm] Session creation failed — cannot approve without billing session', {
          extra: { bookingId, resourceId: booking.resource_id }
        });
        throw new AppError(500, 'Failed to create billing session. Cannot approve booking without billing.');
      }
    }

    if (sessionId) {
      const requestParticipants = booking.request_participants as Array<{
        email?: string;
        type: 'member' | 'guest';
        userId?: string;
        name?: string;
      }> | null;

      const existingParticipants = await tx.execute(sql`
        SELECT user_id, display_name, participant_type FROM booking_participants
         WHERE session_id = ${sessionId} AND participant_type != 'owner'
      `);
      const typedParticipantRows = existingParticipants.rows as unknown as Array<{ user_id: string | null; display_name: string | null; participant_type: string }>;
      const existingUserIds = new Set(
        typedParticipantRows
          .filter(p => p.user_id)
          .map(p => String(p.user_id))
      );
      const existingGuestNames = new Set(
        typedParticipantRows
          .filter(p => !p.user_id && p.participant_type === 'guest')
          .map(p => (p.display_name || '').toLowerCase())
      );

      let participantsCreated = 0;
      if (requestParticipants && Array.isArray(requestParticipants)) {
        for (const rp of requestParticipants) {
          if (!rp || typeof rp !== 'object') continue;

          let resolvedUserId = rp.userId || null;
          let resolvedName = rp.name || '';
          let participantType = rp.type === 'member' ? 'member' : 'guest';

          if (resolvedUserId && !resolvedName) {
            const userResult = await tx.execute(sql`
              SELECT first_name, last_name, email FROM users WHERE id = ${resolvedUserId}
            `);
            if (userResult.rows.length > 0) {
              interface UserNameRow { first_name: string | null; last_name: string | null; email: string }
              const u = userResult.rows[0] as unknown as UserNameRow;
              resolvedName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Member';
            }
          }

          if (!resolvedUserId && rp.email) {
            const userResult = await tx.execute(sql`
              SELECT id, first_name, last_name FROM users WHERE LOWER(email) = LOWER(${rp.email})
            `);
            if (userResult.rows.length > 0) {
              interface UserNameLookupRow { id: string; first_name: string | null; last_name: string | null }
              resolvedUserId = (userResult.rows[0] as unknown as UserNameLookupRow).id;
              participantType = 'member';
              if (!resolvedName) {
                const u = userResult.rows[0] as unknown as UserNameLookupRow;
                resolvedName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
              }
            }
          }

          let resolvedGuestId: number | null = null;
          if (participantType === 'guest' && rp.email) {
            try {
              resolvedGuestId = await createOrFindGuest(
                rp.name || resolvedName || 'Guest',
                rp.email,
                undefined,
                (booking.user_email || '') as string
              );
            } catch (guestErr) {
              logger.error('[Dev Confirm] Non-blocking guest record creation failed', {
                extra: { email: rp.email, error: getErrorMessage(guestErr) }
              });
            }
          }

          if (!resolvedName) {
            resolvedName = rp.name || rp.email || (participantType === 'guest' ? 'Guest' : 'Member');
          }

          if (resolvedUserId && existingUserIds.has(String(resolvedUserId))) {
            continue;
          }
          if (!resolvedUserId && participantType === 'guest' && existingGuestNames.has(resolvedName.toLowerCase())) {
            continue;
          }

          try {
            if (participantType !== 'guest' && !resolvedUserId) {
              logger.warn('[Dev Confirm] Cannot create owner/member participant without user_id, downgrading to guest', {
                extra: { sessionId, email: rp.email, originalType: participantType }
              });
              participantType = 'guest' as typeof participantType;
            }
            const insertUserId = participantType === 'guest' ? null : resolvedUserId;
            await tx.execute(sql`
              INSERT INTO booking_participants (session_id, user_id, guest_id, participant_type, display_name, created_at)
               VALUES (${sessionId}, ${insertUserId}, ${resolvedGuestId}, ${participantType}, ${resolvedName}, NOW())
            `);
            participantsCreated++;
            if (resolvedUserId) existingUserIds.add(String(resolvedUserId));
            if (!resolvedUserId && participantType === 'guest') existingGuestNames.add(resolvedName.toLowerCase());
          } catch (partErr: unknown) {
            logger.error('[Dev Confirm] Failed to create participant', { extra: { error: getErrorMessage(partErr) } });
          }

        }
      }

      logger.info('[Dev Confirm] Participants transferred from request', {
        extra: { bookingId, sessionId, participantsCreated, totalRequested: requestParticipants?.length || 0 }
      });
    }

    const devConfirmResult = await tx.execute(sql`
      UPDATE booking_requests 
       SET status = 'approved', 
           session_id = COALESCE(session_id, ${sessionId}),
           notes = COALESCE(notes, '') || E'\n[Dev confirmed]',
           updated_at = NOW(),
           version = COALESCE(version, 1) + 1
       WHERE id = ${bookingId} AND status IN ('pending', 'pending_approval')
    `);

    if (!devConfirmResult.rowCount || devConfirmResult.rowCount === 0) {
      return { success: false, error: 'Booking status changed while processing — please refresh and try again' };
    }

    const dateStr = formatDateFromDb(booking.request_date as Date | string);
    const timeStr = typeof booking.start_time === 'string'
      ? booking.start_time.substring(0, 5)
      : String(booking.start_time);

    let participantEmails: string[] = [];
    if (booking.user_email) {
      try {
        const participantsResult = await tx.execute(sql`
          SELECT u.email as user_email
           FROM booking_participants bp
           JOIN booking_sessions bs ON bp.session_id = bs.id
           JOIN booking_requests br2 ON br2.session_id = bs.id
           LEFT JOIN users u ON bp.user_id = u.id
           WHERE br2.id = ${bookingId} 
             AND bp.participant_type != 'owner'
             AND u.email IS NOT NULL 
             AND u.email != ''
             AND LOWER(u.email) != LOWER(${booking.user_email})
        `);
        participantEmails = (participantsResult.rows as unknown as Array<{ user_email: string }>)
          .map(p => p.user_email?.toLowerCase())
          .filter(Boolean);
      } catch (notifyErr: unknown) {
        logger.error('[Dev Confirm] Failed to query participants (non-blocking)', { extra: { error: getErrorMessage(notifyErr) } });
      }
    }

    return { sessionId, totalFeeCents, dateStr, timeStr, participantEmails };
  });
  } catch (txError: unknown) {
    const errMsg = getErrorMessage(txError);
    const cause = (txError as { cause?: { code?: string } })?.cause;
    const isOverlap = cause?.code === '23P01' || errMsg.includes('booking_requests_no_overlap') || errMsg.includes('23P01');
    if (isOverlap) {
      logger.warn('[Dev Confirm] Overlap constraint violation — querying conflicting booking', {
        extra: { bookingId, resourceId: booking.resource_id, date: booking.request_date }
      });
      try {
        const conflicting = await db.execute(sql`
          SELECT br.id, br.user_email, br.user_name, br.start_time, br.end_time, br.status, r.name as resource_name
          FROM booking_requests br
          LEFT JOIN resources r ON r.id = br.resource_id
          WHERE br.resource_id = ${booking.resource_id}
            AND br.request_date = ${booking.request_date}
            AND br.status IN ('approved', 'confirmed')
            AND br.id != ${bookingId}
            AND br.start_time < ${booking.end_time}
            AND br.end_time > ${booking.start_time}
          LIMIT 1
        `);
        if (conflicting.rows.length > 0) {
          const conflict = conflicting.rows[0] as { id: number; user_email: string; user_name: string | null; start_time: string; end_time: string; status: string; resource_name: string | null };
          const bayName = conflict.resource_name || `Bay ${booking.resource_id}`;
          const conflictTime = `${String(conflict.start_time).substring(0, 5)}–${String(conflict.end_time).substring(0, 5)}`;
          const conflictMember = conflict.user_name || conflict.user_email || 'Unknown';
          return {
            error: `Cannot confirm: overlaps with booking #${conflict.id} (${conflictMember}, ${bayName}, ${conflictTime}). Cancel or reschedule the conflicting booking first.`,
            statusCode: 409,
            conflictDetails: {
              conflictingBookingId: conflict.id,
              memberName: conflictMember,
              bayName,
              time: conflictTime,
              status: conflict.status
            }
          };
        }
      } catch (queryErr: unknown) {
        logger.error('[Dev Confirm] Failed to query conflicting booking', { extra: { error: getErrorMessage(queryErr) } });
      }
      return {
        error: 'Cannot confirm: this booking overlaps with another approved booking on the same bay and time.',
        statusCode: 409
      };
    }
    throw txError;
  }

  const { sessionId, totalFeeCents, dateStr, timeStr, participantEmails } = transactionResult;
  resolvedTotalFeeCents = totalFeeCents ?? 0;
  if (sessionId) {
    try {
      const feeResult = await recalculateSessionFees(sessionId as number, 'approval');
      if (feeResult?.totals?.totalCents != null) {
        resolvedTotalFeeCents = feeResult.totals.totalCents;
      }
    } catch (feeError: unknown) {
      logger.warn('[Dev Confirm] Failed to calculate fees', { extra: { error: getErrorMessage(feeError) } });
    }
  }

  const sideEffects = new DeferredSideEffects(bookingId, 'dev_confirm');

  if (booking.user_email && !isSyntheticEmail(booking.user_email as string)) {
    const ownerNotifMsg = `Your simulator booking for ${dateStr} at ${timeStr} has been confirmed.`;
    sideEffects.add('notification', async () => {
      await notifyMember({
        userEmail: booking.user_email as string,
        title: 'Booking Confirmed',
        message: ownerNotifMsg,
        type: 'booking_confirmed',
        relatedType: 'booking',
        url: '/sims'
      }, { sendPush: true });
    }, {
      context: {
        userEmail: booking.user_email,
        title: 'Booking Confirmed',
        message: ownerNotifMsg,
        notificationType: 'booking_confirmed',
      },
    });
  }

  if (participantEmails && participantEmails.length > 0) {
    const ownerName = booking.user_name || (booking.user_email as string)?.split('@')[0] || 'A member';
    const formattedDate = formatDateDisplayWithDay(dateStr);
    const formattedTime = formatTime12Hour(timeStr as string);
    for (const participantEmail of participantEmails) {
      if (isSyntheticEmail(participantEmail)) continue;
      const notificationMsg = `${ownerName} has added you to their simulator booking on ${formattedDate} at ${formattedTime}.`;
      sideEffects.add('notification', async () => {
        await notifyMember({
          userEmail: participantEmail,
          title: 'Added to Booking',
          message: notificationMsg,
          type: 'booking',
          relatedType: 'booking',
          relatedId: bookingId,
          url: '/sims'
        }, { sendPush: true });
      }, {
        context: {
          userEmail: participantEmail,
          title: 'Added to Booking',
          message: notificationMsg,
          notificationType: 'booking',
        },
      });
    }
  }

  sideEffects.add('wallet_pass_refresh', async () => {
    await refreshBookingPass(bookingId);
  });

  await sideEffects.executeAll();

  sendNotificationToUser(booking.user_email as string, {
    type: 'notification',
    title: 'Booking Confirmed',
    message: `Your simulator booking for ${dateStr} at ${timeStr} has been confirmed.`,
    data: { bookingId: bookingId.toString(), eventType: 'booking_confirmed' }
  }, { action: 'booking_confirmed', bookingId, triggerSource: 'approval.ts' });

  if (participantEmails && participantEmails.length > 0) {
    const ownerName = booking.user_name || (booking.user_email as string)?.split('@')[0] || 'A member';
    const formattedDate = formatDateDisplayWithDay(dateStr);
    const formattedTime = formatTime12Hour(timeStr as string);
    for (const participantEmail of participantEmails) {
      if (isSyntheticEmail(participantEmail)) continue;
      const notificationMsg = `${ownerName} has added you to their simulator booking on ${formattedDate} at ${formattedTime}.`;
      sendNotificationToUser(participantEmail, {
        type: 'notification',
        title: 'Added to Booking',
        message: notificationMsg,
        data: { bookingId: bookingId.toString(), eventType: 'booking_participant_added' }
      }, { action: 'booking_participant_added', bookingId, triggerSource: 'approval.ts' });
      logger.info('[Dev Confirm] Sent Added to Booking notification', { extra: { participantEmail, bookingId } });
    }
  }

  const devConfirmRequestParticipants = booking.request_participants as Array<{
    email?: string; type: 'member' | 'guest'; name?: string;
  }> | null;
  if (devConfirmRequestParticipants && Array.isArray(devConfirmRequestParticipants)) {
    for (const rp of devConfirmRequestParticipants) {
      if (rp?.type === 'guest' && rp.email) {
        const nameParts = (rp.name || '').trim().split(/\s+/);
        const firstName = nameParts[0] || undefined;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
        upsertVisitor({ email: rp.email.toLowerCase().trim(), firstName, lastName }, false)
          .then(v => logger.info('[Dev Confirm] Visitor record ensured for guest', { extra: { email: rp.email, visitorUserId: v.id, bookingId } }))
          .catch(err => logger.error('[Dev Confirm] Non-blocking visitor upsert failed', { extra: { email: rp.email, error: getErrorMessage(err) } }));
      }
    }
  }

  return { success: true, bookingId, sessionId, totalFeeCents: resolvedTotalFeeCents, booking, dateStr, timeStr };
}


