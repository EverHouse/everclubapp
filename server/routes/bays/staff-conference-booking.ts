import { Router, Request, Response } from 'express';
import { pool, safeRelease, isConstraintError } from '../../core/db';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { isStaffOrAdmin } from '../../core/middleware';
import { getMemberTierByEmail, getTierLimits, getDailyBookedMinutes } from '../../core/tierService';
import { calculateOverageCents } from '../../core/billing/pricingConfig';
import { normalizeEmail } from '../../core/utils/emailNormalization';
import { logFromRequest } from '../../core/auditLog';
import { logger, logAndRespond } from '../../core/logger';
import { getSessionUser } from '../../types/session';
import { formatTime12Hour, formatDateDisplayWithDay, getTodayPacific, getPacificDateParts } from '../../utils/dateUtils';
import { getCalendarIdByName, getCalendarBusyTimes } from '../../core/calendar';
import { CALENDAR_CONFIG } from '../../core/calendar/config';
import { broadcastAvailabilityUpdate } from '../../core/websocket';
import { getErrorMessage } from '../../utils/errorUtils';
import { notifyMember, isSyntheticEmail } from '../../core/notificationService';
import { ensureSessionForBooking } from '../../core/bookingService/sessionManager';
import { recalculateSessionFees } from '../../core/billing/unifiedFeeService';
import { syncBookingInvoice, finalizeAndPayInvoice, getBookingInvoiceId } from '../../core/billing/bookingInvoiceService';
import { resolveUserByEmail } from '../../core/stripe/customers';
import { checkClosureConflict, checkAvailabilityBlockConflict, checkBookingConflict } from '../../core/bookingValidation';
import { generateSlotsForResource, getBusinessHoursFromSettings } from '../../core/availabilityService';

const router = Router();

router.get('/api/staff/conference-room/available-slots', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { date, duration } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Missing required parameter: date (YYYY-MM-DD)' });
    }

    const durationMinutes = duration ? parseInt(String(duration), 10) : 60;
    if (isNaN(durationMinutes) || durationMinutes < 30 || durationMinutes > 240) {
      return res.status(400).json({ error: 'Invalid duration. Must be between 30 and 240 minutes.' });
    }

    const resourceResult = await db.execute(sql`SELECT id FROM resources WHERE type = 'conference_room' LIMIT 1`);

    if (resourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conference room resource not found' });
    }

    const resourceId = resourceResult.rows[0].id;

    const bookingsResult = await db.execute(sql`SELECT start_time, end_time FROM booking_requests 
       WHERE resource_id = ${resourceId} AND request_date = ${date} AND status IN ('pending', 'approved', 'confirmed', 'pending_approval', 'checked_in', 'attended', 'cancellation_pending')`);

    const blocksResult = await db.execute(sql`SELECT start_time, end_time FROM availability_blocks 
       WHERE resource_id = ${resourceId} AND block_date = ${date}`);

    let calendarBusySlots: { start_time: string; end_time: string }[] = [];
    try {
      const calendarId = await getCalendarIdByName(CALENDAR_CONFIG.conference.name);
      if (calendarId) {
        const busyPeriods = await getCalendarBusyTimes(calendarId, date);
        calendarBusySlots = busyPeriods.map(period => {
          const startStr = period.start.toLocaleTimeString('en-US', { 
            hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles'
          });
          const endStr = period.end.toLocaleTimeString('en-US', { 
            hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles'
          });
          return { start_time: startStr + ':00', end_time: endStr + ':00' };
        });
      }
    } catch (calError: unknown) {
      logger.error('Failed to fetch Google Calendar busy times', { extra: { error: getErrorMessage(calError) } });
    }

    const todayStr = getTodayPacific();
    const isToday = date === todayStr;
    const pacificParts = getPacificDateParts();
    const currentMinutes = isToday ? pacificParts.hour * 60 + pacificParts.minute : 0;

    const hours = await getBusinessHoursFromSettings(date);
    if (!hours) {
      return res.json([]);
    }

    const allBookedSlots = bookingsResult.rows.map(r => ({ start_time: r.start_time as string, end_time: r.end_time as string }));
    const allBlockedSlots = blocksResult.rows.map(r => ({ start_time: r.start_time as string, end_time: r.end_time as string }));

    const slots = generateSlotsForResource({
      durationMinutes,
      hours,
      currentMinutes,
      isToday,
      bookedSlots: allBookedSlots,
      blockedSlots: allBlockedSlots,
      unmatchedSlots: [],
      calendarSlots: calendarBusySlots,
      slotIncrement: 30,
      skipPastBuffer: 30,
    });

    const availableSlots = slots
      .filter(s => s.available)
      .map(s => s.start_time.slice(0, 5));

    res.json(availableSlots);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch available slots', error);
  }
});

router.get('/api/staff/conference-room/fee-estimate', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { email, date, duration } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing required parameter: email' });
    }
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Missing required parameter: date' });
    }
    
    const durationMinutes = duration ? parseInt(String(duration), 10) : 60;
    if (isNaN(durationMinutes) || durationMinutes < 30 || durationMinutes > 240) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    const normalizedEmail = normalizeEmail(email);
    const tierName = await getMemberTierByEmail(normalizedEmail);
    
    if (!tierName) {
      return res.json({
        dailyAllowance: 0,
        usedToday: 0,
        overageMinutes: durationMinutes,
        overageCents: calculateOverageCents(durationMinutes),
        tierName: null,
        message: 'Member not found or inactive membership'
      });
    }

    const tierLimits = await getTierLimits(tierName);
    const dailyAllowance = tierLimits.daily_conf_room_minutes || 0;
    const usedToday = await getDailyBookedMinutes(normalizedEmail, date, 'conference_room');
    const remainingAllowance = Math.max(0, dailyAllowance - usedToday);
    const overageMinutes = Math.max(0, durationMinutes - remainingAllowance);
    const overageCents = calculateOverageCents(overageMinutes);

    res.json({
      dailyAllowance,
      usedToday,
      remainingAllowance,
      overageMinutes,
      overageCents,
      tierName
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to calculate fee estimate', error);
  }
});

router.post('/api/staff/conference-room/booking', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { hostEmail: rawHostEmail, hostName, date, startTime, durationMinutes } = req.body;
    const hostEmail = rawHostEmail?.trim()?.toLowerCase();
    const sessionUser = getSessionUser(req);
    const staffEmail = sessionUser?.email || 'staff';

    if (!hostEmail || !date || !startTime || !durationMinutes) {
      return res.status(400).json({ error: 'Missing required fields: hostEmail, date, startTime, durationMinutes' });
    }

    if (typeof durationMinutes !== 'number' || durationMinutes < 30 || durationMinutes > 240) {
      return res.status(400).json({ error: 'Invalid duration. Must be between 30 and 240 minutes.' });
    }

    let normalizedEmail = normalizeEmail(hostEmail);
    let resolvedUserId: string | null = null;
    const resolved = await resolveUserByEmail(normalizedEmail);
    if (resolved) {
      if (resolved.matchType !== 'direct') {
        logger.info('[StaffConfRoom] Resolved linked email to primary', { extra: { originalEmail: normalizedEmail, resolvedEmail: resolved.primaryEmail, matchType: resolved.matchType } });
        normalizedEmail = resolved.primaryEmail.toLowerCase();
      }
      resolvedUserId = resolved.userId;
    }

    const resourceResult = await db.execute(sql`SELECT id, name FROM resources WHERE type = 'conference_room' LIMIT 1`);

    if (resourceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conference room resource not found' });
    }

    const resource = resourceResult.rows[0];
    const resourceId = resource.id;

    const [hours, mins] = startTime.split(':').map(Number);
    const totalMins = hours * 60 + mins + durationMinutes;
    const endHours = Math.floor(totalMins / 60);
    const endMins = totalMins % 60;
    const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}:00`;
    const startTimeWithSeconds = startTime.length === 5 ? startTime + ':00' : startTime;

    if (endHours >= 24) {
      return res.status(400).json({ error: 'Booking cannot extend past midnight' });
    }

    const bookingConflict = await checkBookingConflict(resourceId as number, date, startTimeWithSeconds, endTime);
    if (bookingConflict.hasConflict) {
      const conflict = bookingConflict.conflictingBooking;
      const rawStart = (conflict?.start_time ?? conflict?.startTime) as string | undefined;
      const rawEnd = (conflict?.end_time ?? conflict?.endTime) as string | undefined;
      const conflictStart = typeof rawStart === 'string' ? rawStart.substring(0, 5) : undefined;
      const conflictEnd = typeof rawEnd === 'string' ? rawEnd.substring(0, 5) : undefined;
      const sourceLabel = bookingConflict.conflictSource === 'trackman_bay_slot' ? 'Trackman booking'
        : bookingConflict.conflictSource === 'trackman_unmatched' ? 'unresolved Trackman booking'
        : bookingConflict.conflictSource === 'booking_session' ? 'active session'
        : 'existing booking';
      const errorMsg = conflictStart && conflictEnd
        ? `This time slot conflicts with a ${sourceLabel} from ${formatTime12Hour(conflictStart)} to ${formatTime12Hour(conflictEnd)}. Please adjust your time or duration.`
        : `This time slot conflicts with a ${sourceLabel}`;
      return res.status(409).json({ error: errorMsg });
    }

    const closureCheck = await checkClosureConflict(resourceId as number, date, startTimeWithSeconds, endTime);
    if (closureCheck.hasConflict) {
      return res.status(409).json({ error: `This time slot conflicts with a facility closure: ${closureCheck.closureTitle || 'Facility Closure'}` });
    }

    const blockCheck = await checkAvailabilityBlockConflict(resourceId as number, date, startTimeWithSeconds, endTime);
    if (blockCheck.hasConflict) {
      return res.status(409).json({ error: `This time slot is blocked: ${blockCheck.blockNotes || blockCheck.blockType || 'Event Block'}` });
    }

    const tierName = await getMemberTierByEmail(normalizedEmail);
    let overageMinutes = 0;
    let overageCents = 0;

    if (tierName) {
      const tierLimits = await getTierLimits(tierName);
      const dailyAllowance = tierLimits.daily_conf_room_minutes || 0;
      const usedToday = await getDailyBookedMinutes(normalizedEmail, date, 'conference_room');
      const remainingAllowance = Math.max(0, dailyAllowance - usedToday);
      overageMinutes = Math.max(0, durationMinutes - remainingAllowance);
      overageCents = calculateOverageCents(overageMinutes);
    } else {
      overageMinutes = durationMinutes;
      overageCents = calculateOverageCents(durationMinutes);
    }

    const client = await pool.connect();
    let bookingId: number;
    
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO booking_requests (
          user_email, user_name, user_id, resource_id,
          request_date, start_time, duration_minutes, end_time,
          status, origin,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id`,
        [
          normalizedEmail,
          hostName || null,
          resolvedUserId || null,
          resourceId,
          date,
          startTimeWithSeconds,
          durationMinutes,
          endTime,
          'approved',
          'staff_manual'
        ]
      );

      bookingId = insertResult.rows[0].id;

      const formattedDate = formatDateDisplayWithDay(date);
      const formattedTime = formatTime12Hour(startTime);

      await client.query('COMMIT');

      if (!isSyntheticEmail(normalizedEmail)) {
        notifyMember({
          userEmail: normalizedEmail,
          title: 'Conference Room Booked',
          message: `A conference room booking was created for you on ${formattedDate} at ${formattedTime} by staff.`,
          type: 'booking',
          relatedId: bookingId,
          relatedType: 'booking_request',
          url: '/sims'
        }, { sendPush: true }).catch(err => logger.error('[ConferenceBooking] Notification failed', { extra: { error: getErrorMessage(err) } }));
      }

      logFromRequest(req, 'create_booking', 'booking', String(bookingId), hostName || normalizedEmail, {
        resourceType: 'conference_room',
        hostEmail: normalizedEmail,
        date,
        startTime,
        durationMinutes,
        overageMinutes,
        overageCents
      });

      broadcastAvailabilityUpdate({
        resourceId: resourceId as number,
        resourceType: 'conference_room',
        date,
        action: 'booked'
      });

      // Create session and invoice for conference room (post-commit, non-blocking for response)
      try {
        const sessionResult = await ensureSessionForBooking({
          bookingId,
          resourceId: resourceId as number,
          sessionDate: date,
          startTime: startTimeWithSeconds,
          endTime,
          ownerEmail: normalizedEmail,
          ownerName: hostName || undefined,
          source: 'staff_manual',
          createdBy: staffEmail
        });
        if (sessionResult.error) {
          logger.error('[Staff Conference Booking] Session creation failed', { extra: { bookingId, error: sessionResult.error } });
        }
        if (sessionResult.sessionId) {
          await recalculateSessionFees(sessionResult.sessionId, 'staff_booking');
          await syncBookingInvoice(bookingId, sessionResult.sessionId);
          
          const invoiceId = await getBookingInvoiceId(bookingId);
          if (invoiceId) {
            try {
              const payResult = await finalizeAndPayInvoice({ bookingId });
              logger.info('[StaffConferenceBooking] Invoice finalized and payment attempted', {
                extra: { bookingId, sessionId: sessionResult.sessionId, paidInFull: payResult.paidInFull, status: payResult.status }
              });
            } catch (payErr: unknown) {
              logger.warn('[StaffConferenceBooking] Invoice finalize/pay failed (will be collected at check-in)', {
                extra: { bookingId, error: getErrorMessage(payErr) }
              });
            }
          } else {
            logger.info('[StaffConferenceBooking] No fees due — skipping invoice finalization', {
              extra: { bookingId, sessionId: sessionResult.sessionId }
            });
          }
          
          logger.info('[StaffConferenceBooking] Session and invoice created', {
            extra: { bookingId, sessionId: sessionResult.sessionId }
          });
        }
      } catch (sessionErr: unknown) {
        logger.warn('[StaffConferenceBooking] Non-blocking: Failed to create session/invoice', {
          extra: { bookingId, error: getErrorMessage(sessionErr) }
        });
      }

      logger.info('[StaffConferenceBooking] Created booking', {
        extra: { bookingId, hostEmail: normalizedEmail, date, startTime, durationMinutes, overageCents }
      });

      res.status(201).json({
        id: bookingId,
        hostEmail: normalizedEmail,
        hostName,
        resourceId,
        resourceName: resource.name,
        date,
        startTime: startTimeWithSeconds,
        endTime,
        durationMinutes,
        status: 'approved',
        overageMinutes,
        overageCents
      });
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      safeRelease(client);
    }
  } catch (error: unknown) {
    const constraint = isConstraintError(error);
    if (constraint.type === 'unique' || constraint.type === 'exclusion') {
      return res.status(409).json({ error: 'This time slot was just booked by someone else. Please refresh and pick a different time.' });
    }
    logAndRespond(req, res, 500, 'Failed to create conference room booking', error);
  }
});

export default router;
