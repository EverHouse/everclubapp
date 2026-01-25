import { pool } from '../../core/db';
import { logger } from '../../core/logger';
import { sendNotificationToUser, broadcastToStaff } from '../../core/websocket';
import { notifyAllStaff } from '../../core/staffNotifications';
import { notifyMember } from '../../core/notificationService';
import { refundGuestPass } from '../guestPasses';
import { calculateFullSessionBilling, recalculateSessionFees } from '../../core/bookingService/usageCalculator';
import { recordUsage } from '../../core/bookingService/sessionManager';
import { getMemberTierByEmail } from '../../core/tierService';
import { linkAndNotifyParticipants } from '../../core/bookingEvents';
import { calculateDurationMinutes, NormalizedBookingFields } from './webhook-helpers';

export async function updateBaySlotCache(
  trackmanBookingId: string,
  resourceId: number,
  slotDate: string,
  startTime: string,
  endTime: string,
  status: 'booked' | 'cancelled' | 'completed',
  customerEmail?: string,
  customerName?: string,
  playerCount?: number
): Promise<void> {
  try {
    if (status === 'cancelled') {
      await pool.query(
        `UPDATE trackman_bay_slots SET status = 'cancelled', updated_at = NOW()
         WHERE trackman_booking_id = $1`,
        [trackmanBookingId]
      );
      return;
    }
    
    await pool.query(
      `INSERT INTO trackman_bay_slots 
       (resource_id, slot_date, start_time, end_time, status, trackman_booking_id, customer_email, customer_name, player_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (trackman_booking_id) 
       DO UPDATE SET 
         resource_id = EXCLUDED.resource_id,
         slot_date = EXCLUDED.slot_date,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         status = EXCLUDED.status,
         customer_email = EXCLUDED.customer_email,
         customer_name = EXCLUDED.customer_name,
         player_count = EXCLUDED.player_count,
         updated_at = NOW()`,
      [resourceId, slotDate, startTime, endTime, status, trackmanBookingId, customerEmail, customerName, playerCount || 1]
    );
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to update bay slot cache', { error: e as Error });
  }
}

export async function createBookingForMember(
  member: { id: number; email: string; firstName?: string; lastName?: string },
  trackmanBookingId: string,
  slotDate: string,
  startTime: string,
  endTime: string,
  resourceId: number,
  playerCount: number,
  customerName?: string
): Promise<{ success: boolean; bookingId?: number; updated?: boolean }> {
  try {
    const existingBooking = await pool.query(
      `SELECT id, duration_minutes, session_id FROM booking_requests WHERE trackman_booking_id = $1`,
      [trackmanBookingId]
    );
    
    if (existingBooking.rows.length > 0) {
      const oldDuration = existingBooking.rows[0].duration_minutes;
      const newDuration = calculateDurationMinutes(startTime, endTime);
      
      if (oldDuration !== newDuration) {
        await pool.query(
          `UPDATE booking_requests 
           SET start_time = $1, end_time = $2, duration_minutes = $3, 
               trackman_player_count = $4, last_trackman_sync_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [startTime, endTime, newDuration, playerCount, existingBooking.rows[0].id]
        );
        
        if (existingBooking.rows[0].session_id) {
          try {
            await pool.query(
              'UPDATE booking_sessions SET start_time = $1, end_time = $2 WHERE id = $3',
              [startTime, endTime, existingBooking.rows[0].session_id]
            );
            await recalculateSessionFees(existingBooking.rows[0].session_id);
            logger.info('[Trackman Webhook] Recalculated fees after duration change', {
              extra: { sessionId: existingBooking.rows[0].session_id }
            });
          } catch (recalcErr) {
            logger.warn('[Trackman Webhook] Failed to recalculate fees', { 
              extra: { sessionId: existingBooking.rows[0].session_id } 
            });
          }
        }
        
        return { success: true, bookingId: existingBooking.rows[0].id, updated: true };
      }
      
      logger.info('[Trackman Webhook] Booking already exists and duration unchanged, skipping', { 
        extra: { trackmanBookingId, existingBookingId: existingBooking.rows[0].id, duration: oldDuration } 
      });
      return { success: true, bookingId: existingBooking.rows[0].id };
    }
    
    const pendingSync = await pool.query(
      `SELECT id, staff_notes, start_time, end_time, status FROM booking_requests 
       WHERE LOWER(user_email) = LOWER($1)
       AND request_date = $2
       AND ABS(EXTRACT(EPOCH FROM (start_time::time - $3::time))) <= 900
       AND status IN ('approved', 'pending')
       AND trackman_booking_id IS NULL
       AND (staff_notes LIKE '%[PENDING_TRACKMAN_SYNC]%' OR status = 'pending')
       ORDER BY 
         CASE WHEN staff_notes LIKE '%[PENDING_TRACKMAN_SYNC]%' THEN 0 ELSE 1 END,
         ABS(EXTRACT(EPOCH FROM (start_time::time - $3::time))),
         created_at DESC
       LIMIT 1`,
      [member.email, slotDate, startTime]
    );
    
    if (pendingSync.rows.length > 0) {
      const pendingBookingId = pendingSync.rows[0].id;
      const originalStartTime = pendingSync.rows[0].start_time;
      const originalEndTime = pendingSync.rows[0].end_time;
      const originalStatus = pendingSync.rows[0].status;
      const wasTimeTolerance = originalStartTime !== startTime;
      const wasPending = originalStatus === 'pending';
      
      if (wasTimeTolerance) {
        logger.info('[Trackman Webhook] Time tolerance match - updating booking times to match Trackman', {
          extra: {
            bookingId: pendingBookingId,
            originalStartTime,
            trackmanStartTime: startTime,
            originalEndTime,
            trackmanEndTime: endTime,
          }
        });
      }
      
      let updatedNotes = (pendingSync.rows[0].staff_notes || '')
        .replace('[PENDING_TRACKMAN_SYNC]', '[Linked via Trackman webhook]')
        .trim();
      
      if (wasTimeTolerance) {
        updatedNotes += ` [Time adjusted: ${originalStartTime} → ${startTime}]`;
      }
      
      if (wasPending) {
        updatedNotes += ' [Auto-approved via Trackman webhook]';
      }
      
      const startParts = startTime.split(':').map(Number);
      const endParts = endTime.split(':').map(Number);
      const startMinutesCalc = startParts[0] * 60 + startParts[1];
      const endMinutesCalc = endParts[0] * 60 + endParts[1];
      const newDurationMinutes = endMinutesCalc > startMinutesCalc ? endMinutesCalc - startMinutesCalc : 60;
      
      await pool.query(
        `UPDATE booking_requests 
         SET trackman_booking_id = $1, 
             trackman_player_count = $2,
             staff_notes = $3,
             start_time = $4,
             end_time = $5,
             duration_minutes = $6,
             status = 'approved',
             was_auto_linked = true,
             reviewed_by = COALESCE(reviewed_by, 'trackman_webhook'),
             reviewed_at = COALESCE(reviewed_at, NOW()),
             last_sync_source = 'trackman_webhook',
             last_trackman_sync_at = NOW(),
             updated_at = NOW()
         WHERE id = $7`,
        [trackmanBookingId, playerCount, updatedNotes, startTime, endTime, newDurationMinutes, pendingBookingId]
      );
      
      if (wasTimeTolerance) {
        const sessionCheck = await pool.query(
          'SELECT session_id FROM booking_requests WHERE id = $1',
          [pendingBookingId]
        );
        if (sessionCheck.rows[0]?.session_id) {
          try {
            await pool.query(
              'UPDATE booking_sessions SET start_time = $1, end_time = $2 WHERE id = $3',
              [startTime, endTime, sessionCheck.rows[0].session_id]
            );
            await recalculateSessionFees(sessionCheck.rows[0].session_id);
          } catch (recalcErr) {
            logger.warn('[Trackman Webhook] Failed to recalculate fees', { extra: { bookingId: pendingBookingId, error: recalcErr } });
          }
        }
      }
      
      const memberName = customerName || 
        [member.firstName, member.lastName].filter(Boolean).join(' ') || 
        member.email;
      
      logger.info('[Trackman Webhook] Auto-linked existing booking', {
        extra: { 
          bookingId: pendingBookingId, 
          trackmanBookingId, 
          email: member.email, 
          date: slotDate, 
          wasTimeTolerance,
          wasPending,
        }
      });
      
      const bayNameForNotification = `Bay ${resourceId}`;
      broadcastToStaff({
        type: 'booking_auto_confirmed',
        title: 'Booking Auto-Confirmed',
        message: `${memberName}'s booking for ${slotDate} at ${startTime} (${bayNameForNotification}) was auto-linked via Trackman.`,
        data: {
          bookingId: pendingBookingId,
          memberName,
          memberEmail: member.email,
          date: slotDate,
          time: startTime,
          bay: bayNameForNotification,
          wasAutoApproved: wasPending
        }
      });
      
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          member.id,
          'Booking Confirmed',
          `Your simulator booking for ${slotDate} at ${startTime} (${bayNameForNotification}) has been confirmed.`,
          'booking',
          '/bookings'
        ]
      );
      
      sendNotificationToUser(member.email, {
        type: 'booking_confirmed',
        title: 'Booking Confirmed',
        message: `Your simulator booking for ${slotDate} at ${startTime} (${bayNameForNotification}) has been confirmed.`,
        data: { bookingId: pendingBookingId },
      });
      
      linkAndNotifyParticipants(pendingBookingId, {
        trackmanBookingId,
        linkedBy: 'trackman_webhook',
        bayName: bayNameForNotification
      }).catch(err => {
        logger.warn('[Trackman Webhook] Failed to link request participants', { extra: { bookingId: pendingBookingId, error: err } });
      });
      
      return { success: true, bookingId: pendingBookingId };
    }
    
    const durationMinutes = calculateDurationMinutes(startTime, endTime);
    
    const memberName = customerName || 
      [member.firstName, member.lastName].filter(Boolean).join(' ') || 
      member.email;
    
    const result = await pool.query(
      `INSERT INTO booking_requests 
       (user_id, user_email, user_name, resource_id, request_date, start_time, end_time, 
        duration_minutes, status, trackman_booking_id, trackman_player_count, 
        reviewed_by, reviewed_at, staff_notes, was_auto_linked, 
        origin, last_sync_source, last_trackman_sync_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, $10, 'trackman_webhook', NOW(), 
               '[Auto-created via Trackman webhook - staff booking]', true,
               'trackman_webhook', 'trackman_webhook', NOW(), NOW(), NOW())
       RETURNING id`,
      [
        member.id,
        member.email,
        memberName,
        resourceId,
        slotDate,
        startTime,
        endTime,
        durationMinutes,
        trackmanBookingId,
        playerCount
      ]
    );
    
    if (result.rows.length > 0) {
      const bookingId = result.rows[0].id;
      
      try {
        const sessionResult = await pool.query(`
          INSERT INTO booking_sessions (resource_id, session_date, start_time, end_time, trackman_booking_id, source, created_by)
          VALUES ($1, $2, $3, $4, $5, 'trackman', 'trackman_webhook')
          RETURNING id
        `, [resourceId, slotDate, startTime, endTime, trackmanBookingId]);
        
        if (sessionResult.rows.length > 0) {
          const sessionId = sessionResult.rows[0].id;
          await pool.query(`UPDATE booking_requests SET session_id = $1 WHERE id = $2`, [sessionId, bookingId]);
          
          try {
            const ownerTier = await getMemberTierByEmail(member.email, { allowInactive: true });
            
            const participants = [
              { email: member.email, participantType: 'owner' as const, displayName: memberName }
            ];
            
            for (let i = 1; i < playerCount; i++) {
              participants.push({
                email: undefined as any,
                participantType: 'guest' as const,
                displayName: `Guest ${i + 1}`
              });
            }
            
            const billingResult = await calculateFullSessionBilling(
              slotDate,
              durationMinutes,
              participants,
              member.email
            );
            
            for (const billing of billingResult.billingBreakdown) {
              if (billing.participantType === 'guest') {
                if (billing.guestFee > 0) {
                  await recordUsage(sessionId, {
                    memberId: member.email,
                    minutesCharged: 0,
                    overageFee: 0,
                    guestFee: billing.guestFee,
                    tierAtBooking: ownerTier || undefined,
                    paymentMethod: 'unpaid'
                  }, 'trackman_webhook');
                }
              } else {
                await recordUsage(sessionId, {
                  memberId: billing.email || member.email,
                  minutesCharged: billing.minutesAllocated,
                  overageFee: billing.overageFee,
                  guestFee: 0,
                  tierAtBooking: billing.tierName || ownerTier || undefined,
                  paymentMethod: 'unpaid'
                }, 'trackman_webhook');
              }
            }
            
            logger.info('[Trackman Webhook] Billing calculated for Trackman booking', {
              extra: {
                bookingId,
                sessionId,
                totalOverageFees: billingResult.totalOverageFees,
                totalGuestFees: billingResult.totalGuestFees,
                playerCount
              }
            });
          } catch (billingErr) {
            logger.warn('[Trackman Webhook] Failed to calculate billing (session created)', { 
              extra: { bookingId, sessionId, error: billingErr } 
            });
          }
        }
      } catch (sessionErr) {
        logger.warn('[Trackman Webhook] Failed to create billing session', { extra: { bookingId, error: sessionErr } });
      }
      
      const bayNameForNotification = `Bay ${resourceId}`;
      const logMethod = resourceId ? logger.info.bind(logger) : logger.warn.bind(logger);
      logMethod(`[Trackman Webhook] Auto-created booking for member${resourceId ? '' : ' (no resource_id - bay unmapped)'}`, {
        extra: { 
          bookingId, 
          email: member.email, 
          date: slotDate, 
          time: startTime,
          resourceId: resourceId || null,
          trackmanBookingId 
        }
      });
      
      broadcastToStaff({
        type: 'booking_auto_confirmed',
        title: 'Booking Auto-Confirmed',
        message: `${memberName}'s booking for ${slotDate} at ${startTime} (${bayNameForNotification}) was auto-created via Trackman.`,
        data: {
          bookingId,
          memberName,
          memberEmail: member.email,
          date: slotDate,
          time: startTime,
          bay: bayNameForNotification
        }
      });
      
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          member.id,
          'Booking Confirmed',
          `Your simulator booking for ${slotDate} at ${startTime} (${bayNameForNotification}) has been confirmed.`,
          'booking',
          '/bookings'
        ]
      );
      
      sendNotificationToUser(member.email, {
        type: 'booking_confirmed',
        title: 'Booking Confirmed',
        message: `Your simulator booking for ${slotDate} at ${startTime} (${bayNameForNotification}) has been confirmed.`,
        data: { bookingId },
      });
      
      return { success: true, bookingId };
    }
    
    return { success: false };
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to create booking for member', { error: e as Error });
    return { success: false };
  }
}

export async function linkByExternalBookingId(
  externalBookingId: string,
  trackmanBookingId: string,
  slotDate: string,
  startTime: string,
  endTime: string,
  resourceId: number | null,
  status: string,
  playerCount: number
): Promise<{ matched: boolean; bookingId?: number; memberEmail?: string; memberName?: string }> {
  try {
    const result = await pool.query(
      `SELECT id, user_email, user_name, user_id, status as current_status, resource_id, session_id, duration_minutes
       FROM booking_requests 
       WHERE calendar_event_id = $1
         OR id::text = $1
       LIMIT 1`,
      [externalBookingId]
    );
    
    if (result.rows.length === 0) {
      const pendingResult = await pool.query(
        `SELECT id, user_email, user_name, user_id, status as current_status, resource_id, session_id, duration_minutes
         FROM booking_requests 
         WHERE staff_notes LIKE $1
           AND trackman_booking_id IS NULL
         LIMIT 1`,
        [`%${externalBookingId}%`]
      );
      
      if (pendingResult.rows.length === 0) {
        logger.info('[Trackman Webhook] No booking found for externalBookingId', {
          extra: { externalBookingId }
        });
        return { matched: false };
      }
      
      result.rows = pendingResult.rows;
    }
    
    const booking = result.rows[0];
    const bookingId = booking.id;
    const memberEmail = booking.user_email;
    const memberName = booking.user_name;
    
    const normalizedStatus = status.toLowerCase();
    let newStatus = booking.current_status;
    if (normalizedStatus === 'attended') {
      newStatus = 'attended';
    } else if (normalizedStatus === 'confirmed' || normalizedStatus === 'booked') {
      newStatus = 'approved';
    } else if (normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') {
      newStatus = 'cancelled';
    }
    
    const durationMinutes = calculateDurationMinutes(startTime, endTime);
    
    const originalDuration = booking.duration_minutes;
    const timeChanged = originalDuration !== durationMinutes;
    
    await pool.query(
      `UPDATE booking_requests 
       SET trackman_booking_id = $1,
           trackman_player_count = $2,
           status = $3,
           start_time = $4,
           end_time = $5,
           duration_minutes = $6,
           resource_id = COALESCE($7, resource_id),
           reviewed_by = COALESCE(reviewed_by, 'trackman_webhook'),
           reviewed_at = COALESCE(reviewed_at, NOW()),
           staff_notes = COALESCE(staff_notes, '') || ' [Linked via Trackman webhook - externalBookingId match]',
           last_sync_source = 'trackman_webhook',
           last_trackman_sync_at = NOW(),
           updated_at = NOW()
       WHERE id = $8`,
      [
        trackmanBookingId,
        playerCount,
        newStatus,
        startTime,
        endTime,
        durationMinutes,
        resourceId,
        bookingId
      ]
    );
    
    if (timeChanged && booking.session_id) {
      try {
        await pool.query(
          'UPDATE booking_sessions SET start_time = $1, end_time = $2 WHERE id = $3',
          [startTime, endTime, booking.session_id]
        );
        await recalculateSessionFees(booking.session_id);
        logger.info('[Trackman Webhook] Recalculated fees after externalBookingId link', {
          extra: { bookingId, sessionId: booking.session_id, originalDuration, newDuration: durationMinutes }
        });
      } catch (recalcErr) {
        logger.warn('[Trackman Webhook] Failed to recalculate fees for externalBookingId link', { 
          extra: { bookingId, error: recalcErr } 
        });
      }
    }
    
    logger.info('[Trackman Webhook] Linked booking via externalBookingId', {
      extra: { 
        bookingId, 
        trackmanBookingId, 
        externalBookingId, 
        memberEmail,
        oldStatus: booking.current_status,
        newStatus
      }
    });
    
    return { matched: true, bookingId, memberEmail, memberName };
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to link by externalBookingId', { error: e as Error });
    return { matched: false };
  }
}

export async function refundGuestPassesForCancelledBooking(bookingId: number, memberEmail: string): Promise<number> {
  try {
    const sessionResult = await pool.query(
      `SELECT session_id FROM booking_requests WHERE id = $1`,
      [bookingId]
    );
    
    if (!sessionResult.rows[0]?.session_id) {
      return 0;
    }
    
    const sessionId = sessionResult.rows[0].session_id;
    
    const guestParticipants = await pool.query(
      `SELECT id, display_name FROM booking_participants 
       WHERE session_id = $1 AND participant_type = 'guest'`,
      [sessionId]
    );
    
    let refundedCount = 0;
    for (const guest of guestParticipants.rows) {
      const result = await refundGuestPass(memberEmail, guest.display_name || undefined, false);
      if (result.success) {
        refundedCount++;
      }
    }
    
    if (refundedCount > 0) {
      logger.info('[Trackman Webhook] Refunded guest passes for cancelled booking', {
        extra: { bookingId, memberEmail, refundedCount }
      });
    }
    
    return refundedCount;
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to refund guest passes for cancelled booking', { error: e as Error });
    return 0;
  }
}
