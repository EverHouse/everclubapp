import { Router } from 'express';
import { db } from '../../db';
import { resources, users } from '../../../shared/schema';
import { eq, sql, inArray } from 'drizzle-orm';
import { BookingValidationError, SanitizedParticipant, BookingInsertRow } from './booking-shared';
import { checkDailyBookingLimit } from '../../core/tierService';
import { notifyAllStaff } from '../../core/notificationService';
import { formatDateDisplayWithDay, formatTime12Hour, getTodayPacific } from '../../utils/dateUtils';
import { sanitizeAndResolveParticipants, checkParticipantOverlaps, checkParticipantDailyLimits, prepareBookingCreation, acquireLocksAndCheckConflicts } from '../../core/bookingService/createBooking';
import { logAndRespond, logger } from '../../core/logger';
import { bookingEvents } from '../../core/bookingEvents';
import { broadcastAvailabilityUpdate } from '../../core/websocket';
import { getSessionUser } from '../../types/session';
import { isStaffOrAdminCheck } from './helpers';
import { isAuthenticated } from '../../core/middleware';
import { syncBookingInvoice, finalizeAndPayInvoice, getBookingInvoiceId } from '../../core/billing/bookingInvoiceService';
import { createGuestPassHold } from '../../core/billing/guestPassHoldService';
import { ensureSessionForBooking, createSessionWithUsageTracking, createTxQueryClient } from '../../core/bookingService/sessionManager';
import { tryConferenceAutoConfirm } from '../../core/bookingService/conferenceAutoConfirm';
import { getErrorMessage } from '../../utils/errorUtils';
import { ensureTimeString } from '../../utils/dateTimeUtils';
import { resolveUserByEmail } from '../../core/stripe/customers';
import { bookingRateLimiter } from '../../middleware/rateLimiting';
import { validateBody } from '../../middleware/validate';
import { createBookingRequestSchema } from '../../../shared/validators/booking';
import { acquireBookingLocks, BookingConflictError } from '../../core/bookingService/bookingCreationGuard';
import { recalculateSessionFees } from '../../core/billing/unifiedFeeService';
import { GuestPassHoldError } from '../../core/errors';
import { isConstraintError } from '../../core/db';
import { alertOnDeferredActionFailure, recordDeferredActionOutcome } from '../../core/dataAlerts';

interface BookingOverlapRow {
  id: number;
  resource_name: string;
  start_time: string;
  end_time: string;
}

const router = Router();

router.post('/api/booking-requests', isAuthenticated, bookingRateLimiter, validateBody(createBookingRequestSchema), async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { 
      user_email, user_name, resource_id, resource_preference, request_date, start_time, 
      duration_minutes, notes, declared_player_count, member_notes,
      guardian_name, guardian_relationship, guardian_phone, guardian_consent, request_participants
    } = req.body;
    
    const earlyParticipantEmails = (Array.isArray(request_participants) ? request_participants : [])
      .map((p: { email?: string }) => typeof p.email === 'string' ? p.email.trim().toLowerCase() : '')
      .filter(Boolean);

    const prepared = await prepareBookingCreation(
      { userEmail: user_email, startTime: start_time, requestDate: request_date, durationMinutes: duration_minutes, resourceId: resource_id, participantEmails: earlyParticipantEmails },
      { isStaff: false }
    );
    let requestEmail = prepared.resolvedEmail;
    let resolvedUserId = prepared.resolvedUserId;
    
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    
    const needsNameLookup = !user_name || user_name.includes('@');
    const needsAuthCheck = sessionEmail !== requestEmail;

    const [sessionResolved, isStaffRequest, dbUserResult] = await Promise.all([
      needsAuthCheck ? resolveUserByEmail(sessionEmail) : Promise.resolve(null),
      isStaffOrAdminCheck(sessionEmail),
      needsNameLookup
        ? db.select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(sql`LOWER(${users.email}) = ${requestEmail}`)
            .limit(1)
        : Promise.resolve(null)
    ]);

    if (needsAuthCheck) {
      const sessionPrimary = sessionResolved?.primaryEmail?.toLowerCase() || sessionEmail;
      if (sessionPrimary !== requestEmail && !isStaffRequest) {
        return res.status(403).json({ error: 'You can only create booking requests for yourself' });
      }
    }

    let resolvedUserName = user_name;
    if (needsNameLookup && dbUserResult && dbUserResult.length > 0) {
      const fullName = [dbUserResult[0].firstName, dbUserResult[0].lastName].filter(Boolean).join(' ').trim();
      if (fullName) resolvedUserName = fullName;
    }
    const isViewAsMode = isStaffRequest && sessionEmail !== requestEmail;
    
    if (typeof duration_minutes !== 'number' || !Number.isInteger(duration_minutes) || duration_minutes <= 0 || duration_minutes > 480) {
      return res.status(400).json({ error: 'Invalid duration. Must be a whole number between 1 and 480 minutes.' });
    }
    
    const end_time = prepared.endTime;
    let resourceType = prepared.resourceType;
    
    let row: BookingInsertRow;
    try {
      const txResult = await db.transaction(async (tx) => {
        await acquireLocksAndCheckConflicts(tx as unknown as Parameters<typeof acquireBookingLocks>[0], {
          resourceId: resource_id,
          requestDate: request_date,
          startTime: start_time,
          endTime: end_time,
          requestEmail,
          isStaffRequest,
          isViewAsMode,
          resourceType,
          participantEmails: earlyParticipantEmails,
        });

        const forceOverride = !!(req.body.force_override && isStaffRequest);
        if (!forceOverride) {
          const memberOverlapCheck = await tx.execute(sql`
            SELECT br.id, br.start_time, br.end_time, r.name AS resource_name
            FROM booking_requests br
            LEFT JOIN resources r ON r.id = br.resource_id
            WHERE br.request_date = ${request_date}
            AND br.status IN ('pending', 'pending_approval', 'approved', 'confirmed', 'checked_in', 'attended', 'cancellation_pending')
            AND br.start_time < ${end_time} AND br.end_time > ${start_time}
            AND (
              LOWER(br.user_email) = LOWER(${requestEmail})
              OR LOWER(br.user_email) IN (SELECT LOWER(ule.linked_email) FROM user_linked_emails ule WHERE LOWER(ule.primary_email) = LOWER(${requestEmail}))
              OR LOWER(br.user_email) IN (SELECT LOWER(ule.primary_email) FROM user_linked_emails ule WHERE LOWER(ule.linked_email) = LOWER(${requestEmail}))
              OR br.session_id IN (
                SELECT bp.session_id FROM booking_participants bp
                JOIN users u ON bp.user_id = u.id
                WHERE LOWER(u.email) = LOWER(${requestEmail})
              )
            )
          `);
          
          if (memberOverlapCheck.rows.length > 0) {
            const conflict = memberOverlapCheck.rows[0] as Record<string, unknown>;
            const conflictStart = (conflict.start_time as string)?.substring(0, 5);
            const conflictEnd = (conflict.end_time as string)?.substring(0, 5);
            const conflictResource = (conflict.resource_name as string) || 'another booking';
            
            throw new BookingValidationError(409, {
              error: `You already have a booking at ${conflictResource} from ${formatTime12Hour(conflictStart)} to ${formatTime12Hour(conflictEnd)}. You cannot book overlapping time slots.`
            });
          }
        }
        
        const limitCheck = await checkDailyBookingLimit(requestEmail, request_date, duration_minutes, undefined, resourceType, tx as unknown as { execute: typeof db.execute });
        if (!limitCheck.allowed) {
          throw new BookingValidationError(403, { 
            error: limitCheck.reason,
            remainingMinutes: limitCheck.remainingMinutes
          });
        }
        
        logger.info('[Booking] Received request_participants', { extra: { declaredPlayerCount: declared_player_count, participantCount: Array.isArray(request_participants) ? request_participants.length : 0, participantTypes: Array.isArray(request_participants) ? request_participants.map((p: { type?: string; userId?: string }) => ({ type: p.type, hasUserId: !!p.userId })) : [] } });
        let sanitizedParticipants: SanitizedParticipant[] = [];
        if (request_participants && Array.isArray(request_participants)) {
          sanitizedParticipants = await sanitizeAndResolveParticipants(
            request_participants,
            requestEmail,
            tx as unknown as Parameters<typeof sanitizeAndResolveParticipants>[2],
            { isStaff: isStaffRequest }
          );
        }
        
        await checkParticipantOverlaps(sanitizedParticipants, request_date, start_time, end_time, tx as unknown as Parameters<typeof checkParticipantOverlaps>[4]);
        await checkParticipantDailyLimits(sanitizedParticipants, request_date, duration_minutes, resourceType, tx as unknown as { execute: typeof db.execute });

        const initialStatus: 'pending' | 'confirmed' = 'pending';
        
        if (guardian_consent) {
          const gName = typeof guardian_name === 'string' ? guardian_name.trim() : '';
          const gRelationship = typeof guardian_relationship === 'string' ? guardian_relationship.trim() : '';
          const gPhone = typeof guardian_phone === 'string' ? guardian_phone.trim() : '';
          if (!gName || gName.length < 2) {
            throw new BookingValidationError(400, { error: 'Guardian full name is required for minor consent.' });
          }
          if (!gRelationship) {
            throw new BookingValidationError(400, { error: 'Guardian relationship is required for minor consent.' });
          }
          if (!gPhone || gPhone.length < 7) {
            throw new BookingValidationError(400, { error: 'A valid guardian phone number is required for minor consent.' });
          }
        }
        const guardianConsentAt = (guardian_consent && guardian_name && guardian_relationship) ? new Date() : null;
        const insertResult = await tx.execute(sql`
          INSERT INTO booking_requests (
            user_email, user_name, user_id, resource_id, resource_preference, 
            request_date, start_time, duration_minutes, end_time, notes,
            declared_player_count, member_notes,
            guardian_name, guardian_relationship, guardian_phone, guardian_consent_at,
            request_participants, status, created_at, updated_at
          ) VALUES (
            ${requestEmail},
            ${resolvedUserName},
            ${resolvedUserId || null},
            ${resource_id || null},
            ${resource_preference || null},
            ${request_date},
            ${start_time},
            ${duration_minutes},
            ${end_time},
            ${notes ? String(notes).slice(0, 1000) : null},
            ${(declared_player_count && declared_player_count >= 1 && declared_player_count <= 4 ? declared_player_count : null) ?? null},
            ${(member_notes ? String(member_notes).slice(0, 280) : null) ?? null},
            ${(guardian_consent && guardian_name ? String(guardian_name).slice(0, 100) : null) ?? null},
            ${(guardian_consent && guardian_relationship ? String(guardian_relationship).slice(0, 50) : null) ?? null},
            ${(guardian_consent && guardian_phone ? String(guardian_phone).slice(0, 20) : null) ?? null},
            ${guardianConsentAt},
            ${sanitizedParticipants.length > 0 ? JSON.stringify(sanitizedParticipants) : '[]'},
            ${initialStatus},
            NOW(), NOW()
          )
          RETURNING *
        `);
        
        const guestCount = sanitizedParticipants.filter((p: SanitizedParticipant) => p.type === 'guest').length;
        if (guestCount > 0) {
          const bookingId = (insertResult.rows[0] as Record<string, unknown>).id as number;
          const holdResult = await createGuestPassHold(
            requestEmail,
            bookingId,
            guestCount,
            tx
          );
          if (!holdResult.success) {
            throw new GuestPassHoldError(holdResult.error || 'Insufficient guest passes available');
          }
        }
        
        const dbRow = insertResult.rows[0] as Record<string, unknown>;
        logger.info('[Booking] Persisted booking with participants', { extra: { bookingId: dbRow.id, participantsSaved: sanitizedParticipants.length, participantTypes: sanitizedParticipants.map((p: SanitizedParticipant) => ({ type: p.type, hasUserId: !!p.userId, hasEmail: !!p.email })) } });
        
        let confSessionId: number | null = null;
        let finalStatus = dbRow.status as string;

        if (resourceType === 'conference_room' && dbRow.resource_id) {
          const confEndTime = (dbRow.end_time as string) || end_time;
          const [startH, startM] = start_time.split(':').map(Number);
          const [endH, endM] = confEndTime.split(':').map(Number);
          const confDurationMinutes = (endH * 60 + endM) - (startH * 60 + startM);

          const confirmResult = await tryConferenceAutoConfirm({
            bookingId: dbRow.id as number,
            resourceId: dbRow.resource_id as number,
            sessionDate: request_date,
            startTime: start_time,
            endTime: confEndTime,
            ownerEmail: requestEmail,
            durationMinutes: confDurationMinutes > 0 ? confDurationMinutes : duration_minutes,
            displayName: resolvedUserName || requestEmail,
            userId: resolvedUserId || sessionUser?.id || undefined,
          }, tx);

          if (confirmResult.confirmed) {
            confSessionId = confirmResult.sessionId;
            finalStatus = 'confirmed';
          }
        }

        return {
          id: dbRow.id,
          userEmail: dbRow.user_email,
          userName: dbRow.user_name,
          resourceId: dbRow.resource_id,
          resourcePreference: dbRow.resource_preference,
          requestDate: dbRow.request_date,
          startTime: dbRow.start_time,
          durationMinutes: dbRow.duration_minutes,
          endTime: dbRow.end_time,
          notes: dbRow.notes,
          status: finalStatus,
          declaredPlayerCount: dbRow.declared_player_count,
          memberNotes: dbRow.member_notes,
          guardianName: dbRow.guardian_name,
          guardianRelationship: dbRow.guardian_relationship,
          guardianPhone: dbRow.guardian_phone,
          guardianConsentAt: dbRow.guardian_consent_at,
          requestParticipants: dbRow.request_participants || [],
          createdAt: dbRow.created_at,
          updatedAt: dbRow.updated_at,
          _confSessionId: confSessionId
        } as BookingInsertRow & { _confSessionId?: number | null };
      });
      row = txResult;
    } catch (error: unknown) {
      if (error instanceof BookingValidationError) {
        return res.status(error.statusCode).json(error.errorBody);
      }
      if (error instanceof BookingConflictError) {
        return res.status(error.statusCode).json(error.errorBody);
      }
      if (error instanceof GuestPassHoldError) {
        return res.status(402).json({ error: 'Guest pass hold failed. Please check guest pass availability and try again.' });
      }
      throw error;
    }
    
    let resourceName = 'Bay';
    if (row.resourceId) {
      try {
        const [resource] = await db.select({ name: resources.name }).from(resources).where(eq(resources.id, row.resourceId));
        if (resource?.name) {
          resourceName = resource.name;
        }
      } catch (error: unknown) {
        logger.error('[Bookings] Failed to fetch resource name', { extra: { error: getErrorMessage(error) } });
      }
    }
    
    const dateStr = typeof row.requestDate === 'string' 
      ? row.requestDate 
      : request_date;
    const formattedDate = formatDateDisplayWithDay(dateStr);
    const timeStr = ensureTimeString(row.startTime ?? start_time);
    const formattedTime12h = formatTime12Hour(timeStr);
    
    const durationMins = row.durationMinutes || duration_minutes;
    let durationDisplay = '';
    if (durationMins) {
      if (durationMins < 60) {
        durationDisplay = `${durationMins} min`;
      } else {
        const hours = durationMins / 60;
        durationDisplay = hours === Math.floor(hours) ? `${hours} hr${hours > 1 ? 's' : ''}` : `${hours.toFixed(1)} hrs`;
      }
    }
    
    const playerCount = declared_player_count && declared_player_count > 1 ? ` (${declared_player_count} players)` : '';
    
    const isConfRoom = resourceType === 'conference_room';
    const staffTitle = isConfRoom ? 'New Conference Room Booking' : 'New Golf Booking Request';
    const staffMessage = `${row.userName || row.userEmail}${playerCount} - ${resourceName} on ${formattedDate} at ${formattedTime12h} for ${durationDisplay}`;
    
    db.execute(sql`UPDATE users SET first_booking_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER(${row.userEmail}) AND first_booking_at IS NULL`).catch((err) => logger.warn('[Booking] Non-critical first_booking_at update failed:', { extra: { error: getErrorMessage(err) } }));

    db.execute(sql`UPDATE users SET onboarding_completed_at = NOW(), updated_at = NOW() 
      WHERE LOWER(email) = LOWER(${row.userEmail}) 
      AND onboarding_completed_at IS NULL 
      AND first_name IS NOT NULL AND last_name IS NOT NULL AND phone IS NOT NULL
      AND waiver_signed_at IS NOT NULL AND app_installed_at IS NOT NULL`).catch((err) => logger.warn('[Booking] Non-critical onboarding update failed:', { extra: { error: getErrorMessage(err) } }));

    res.status(201).json({
      id: row.id,
      user_email: row.userEmail,
      user_name: row.userName,
      resource_id: row.resourceId,
      resource_preference: row.resourcePreference,
      request_date: row.requestDate,
      start_time: row.startTime,
      duration_minutes: row.durationMinutes,
      end_time: row.endTime,
      notes: row.notes,
      status: row.status,
      staff_notes: row.staffNotes,
      suggested_time: row.suggestedTime,
      reviewed_by: row.reviewedBy,
      reviewed_at: row.reviewedAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      calendar_event_id: row.calendarEventId,
    });

    const confSessionId = (row as BookingInsertRow & { _confSessionId?: number | null })._confSessionId;
    if (resourceType === 'conference_room' && row.status === 'confirmed' && confSessionId) {
      const bookingId = row.id;
      setImmediate(async () => {
        try {
          await recalculateSessionFees(confSessionId, 'approval');
          const syncResult = await syncBookingInvoice(bookingId, confSessionId);

          if (!syncResult.success) {
            logger.warn(`[DeferredAction] Conference room invoice sync failed for booking #${bookingId}`, {
              extra: { bookingId, sessionId: confSessionId, error: syncResult.error }
            });
            await db.execute(sql`UPDATE booking_requests SET billing_sync_pending = TRUE, staff_notes = COALESCE(staff_notes, '') || CASE WHEN staff_notes IS NOT NULL AND staff_notes != '' THEN E'\n' ELSE '' END || '[Auto] Invoice creation failed after booking confirmation. Manual invoice review needed. Error: ' || ${syncResult.error || 'Unknown'}, updated_at = NOW() WHERE id = ${bookingId}`);
            recordDeferredActionOutcome('conference_room_billing', 0, 1);
            alertOnDeferredActionFailure('conference_room_billing', `booking:${bookingId}`, 'Invoice sync failed', syncResult.error || 'Unknown error', true).catch((alertErr: unknown) => logger.warn('[DeferredAction] Failed to record conference room billing alert', { extra: { bookingId, error: getErrorMessage(alertErr) } }));
          } else {
            const invoiceId = await getBookingInvoiceId(bookingId);
            if (invoiceId) {
              try {
                const payResult = await finalizeAndPayInvoice({ bookingId });
                logger.info(`[DeferredAction] Conference room invoice finalized and payment attempted for booking #${bookingId}`, {
                  extra: { bookingId, sessionId: confSessionId, paidInFull: payResult.paidInFull, status: payResult.status }
                });
                recordDeferredActionOutcome('conference_room_billing', 1, 0);
              } catch (payErr: unknown) {
                logger.warn(`[DeferredAction] Conference room invoice finalize/pay failed for booking #${bookingId} — member can pay via dashboard`, {
                  extra: { bookingId, error: getErrorMessage(payErr) }
                });
                await db.execute(sql`UPDATE booking_requests SET billing_sync_pending = TRUE, staff_notes = COALESCE(staff_notes, '') || CASE WHEN staff_notes IS NOT NULL AND staff_notes != '' THEN E'\n' ELSE '' END || '[Auto] Invoice finalization/payment failed. Member can pay via dashboard. Error: ' || ${getErrorMessage(payErr)}, updated_at = NOW() WHERE id = ${bookingId}`);
                recordDeferredActionOutcome('conference_room_billing', 0, 1);
                alertOnDeferredActionFailure('conference_room_billing', `booking:${bookingId}`, 'Invoice finalize/pay failed', payErr instanceof Error ? payErr : String(payErr), true).catch((alertErr: unknown) => logger.warn('[DeferredAction] Failed to record conference room billing alert', { extra: { bookingId, error: getErrorMessage(alertErr) } }));
              }
            } else {
              logger.info(`[DeferredAction] Conference room booking #${bookingId} — no fees due, skipping invoice finalization`, {
                extra: { bookingId, sessionId: confSessionId }
              });
              recordDeferredActionOutcome('conference_room_billing', 1, 0);
            }
          }
        } catch (invoiceErr: unknown) {
          logger.error(`[DeferredAction] Conference room async billing failed for booking #${bookingId}`, {
            extra: { bookingId, sessionId: confSessionId, error: getErrorMessage(invoiceErr) }
          });
          recordDeferredActionOutcome('conference_room_billing', 0, 1);
          alertOnDeferredActionFailure('conference_room_billing', `booking:${bookingId}`, 'Async billing failed completely', invoiceErr instanceof Error ? invoiceErr : String(invoiceErr), true).catch((alertErr: unknown) => logger.warn('[DeferredAction] Failed to record conference room billing alert', { extra: { bookingId, error: getErrorMessage(alertErr) } }));
          try {
            await db.execute(sql`UPDATE booking_requests SET billing_sync_pending = TRUE, staff_notes = COALESCE(staff_notes, '') || CASE WHEN staff_notes IS NOT NULL AND staff_notes != '' THEN E'\n' ELSE '' END || '[Auto] Invoice creation failed after booking confirmation. Manual invoice review needed. Error: ' || ${getErrorMessage(invoiceErr)}, updated_at = NOW() WHERE id = ${bookingId}`);
          } catch (flagErr: unknown) {
            logger.error('[ConferenceRoom] Failed to flag booking as billing_sync_pending', {
              extra: { bookingId, error: getErrorMessage(flagErr) }
            });
          }
        }
      });
    }

    try {
      notifyAllStaff(
        staffTitle,
        staffMessage,
        'booking',
        {
          relatedId: row.id,
          relatedType: 'booking_request',
          url: '/admin/bookings',
          sendPush: true
        }
      ).catch((err: unknown) => logger.error(`[BookingCreate] Staff notification failed for bookingId=${row.id}`, { extra: { bookingId: row.id, error: getErrorMessage(err) } }));
      
      bookingEvents.publish('booking_created', {
        bookingId: row.id,
        memberEmail: row.userEmail,
        memberName: row.userName || undefined,
        resourceId: row.resourceId || undefined,
        resourceName: resourceName,
        bookingDate: row.requestDate,
        startTime: row.startTime,
        durationMinutes: durationMins,
        playerCount: declared_player_count || undefined,
        status: row.status || 'pending',
        actionBy: 'member'
      }, { notifyMember: false, notifyStaff: true }).catch((err: unknown) => logger.error(`[BookingCreate] Booking event publish failed for bookingId=${row.id}`, { extra: { bookingId: row.id, error: getErrorMessage(err) } }));
      
      broadcastAvailabilityUpdate({
        resourceId: row.resourceId || undefined,
        resourceType: resourceType === 'conference_room' ? 'conference_room' : 'simulator',
        date: row.requestDate,
        action: 'booked'
      });
    } catch (postCommitError: unknown) {
      logger.error(`[BookingCreate] Post-commit operations failed for bookingId=${row.id}`, { extra: { bookingId: row.id, error: getErrorMessage(postCommitError) } });
    }
  } catch (error: unknown) {
    if (error instanceof BookingValidationError) {
      return res.status(error.statusCode).json(error.errorBody);
    }
    const constraint = isConstraintError(error);
    if (constraint.type === 'unique' || constraint.type === 'exclusion') {
      return res.status(409).json({ error: 'This time slot was just booked by someone else. Please refresh and pick a different time.' });
    }
    if (constraint.type === 'foreign_key') {
      return res.status(400).json({ error: 'Referenced record not found. Please refresh and try again.' });
    }
    logAndRespond(req, res, 500, 'Failed to create booking request', error);
  }
});

export default router;
