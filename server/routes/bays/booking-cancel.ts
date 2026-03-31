import { Router } from 'express';
import { db } from '../../db';
import { bookingRequests, resources } from '../../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { logAndRespond, logger } from '../../core/logger';
import { isSyntheticEmail } from '../../core/notificationService';
import { createPacificDate, formatTime12Hour } from '../../utils/dateUtils';
import { getSessionUser } from '../../types/session';
import { logFromRequest, logMemberAction } from '../../core/auditLog';
import { isAuthenticated } from '../../core/middleware';
import { getErrorMessage } from '../../utils/errorUtils';
import { ensureDateString, ensureTimeString } from '../../utils/dateTimeUtils';
import { voidBookingPass } from '../../walletPass/bookingPassService';
import { BookingStateService } from '../../core/bookingService/bookingStateService';

const router = Router();

router.put('/api/booking-requests/:id/member-cancel', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const rawSessionEmail = getSessionUser(req)?.email;
    const sessionUserRole = getSessionUser(req)?.role;
    const userEmail = rawSessionEmail?.toLowerCase();
    
    const actingAsEmail = req.body?.acting_as_email?.toLowerCase();
    const isAdminViewingAs = (sessionUserRole === 'admin' || sessionUserRole === 'staff') && actingAsEmail;
    
    if (!userEmail) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const idStr = String(id);
    const bookingId = parseInt(idStr, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }
    
    const [existing] = await db.select({
      id: bookingRequests.id,
      userEmail: bookingRequests.userEmail,
      userName: bookingRequests.userName,
      requestDate: bookingRequests.requestDate,
      startTime: bookingRequests.startTime,
      status: bookingRequests.status,
      calendarEventId: bookingRequests.calendarEventId,
      resourceId: bookingRequests.resourceId,
      trackmanBookingId: bookingRequests.trackmanBookingId,
      staffNotes: bookingRequests.staffNotes,
      sessionId: bookingRequests.sessionId
    })
      .from(bookingRequests)
      .where(eq(bookingRequests.id, bookingId));
    
    if (!existing) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingEmail = existing.userEmail?.toLowerCase();
    
    const isOwnBooking = bookingEmail === userEmail;
    const isValidViewAs = isAdminViewingAs && bookingEmail === actingAsEmail;
    
    let isLinkedEmail = false;
    if (!isOwnBooking && !isValidViewAs && bookingEmail && userEmail) {
      const linkedCheck = await db.execute(sql`SELECT 1 FROM users 
         WHERE LOWER(email) = ${userEmail} 
         AND (
           LOWER(trackman_email) = ${bookingEmail}
           OR COALESCE(linked_emails, '[]'::jsonb) @> to_jsonb(${bookingEmail}::text)
           OR COALESCE(manually_linked_emails, '[]'::jsonb) @> to_jsonb(${bookingEmail}::text)
         )
         LIMIT 1`);
      isLinkedEmail = (linkedCheck.rowCount ?? 0) > 0;
    }
    
    if (!isOwnBooking && !isValidViewAs && !isLinkedEmail) {
      logger.warn('[Member Cancel] Email mismatch', { extra: { bookingId, bookingEmail: existing.userEmail, sessionEmail: rawSessionEmail, actingAsEmail: actingAsEmail || 'none' } });
      return res.status(403).json({ error: 'You can only cancel your own bookings' });
    }
    
    if (existing.status === 'cancelled' || existing.status === 'declined') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }
    
    if (existing.status === 'cancellation_pending') {
      voidBookingPass(bookingId).catch(err =>
        logger.warn(`[BookingCancel] Self-heal void pass failed for already-pending booking (non-fatal), bookingId=${bookingId}`, { extra: { bookingId, error: getErrorMessage(err) } })
      );
      return res.status(400).json({ error: 'Cancellation is already in progress' });
    }

    if (!isAdminViewingAs && existing.requestDate && existing.startTime) {
      const dateStr = ensureDateString(existing.requestDate);
      const timeStr = ensureTimeString(existing.startTime);
      const bookingStart = createPacificDate(dateStr, timeStr);
      if (bookingStart.getTime() <= new Date().getTime()) {
        return res.status(400).json({ error: 'This booking has already started and cannot be cancelled' });
      }
    }

    const result = await BookingStateService.cancelBooking({
      bookingId,
      source: 'member',
      cancelledBy: bookingEmail || userEmail,
      enforceLateCancel: true,
    });

    if (!result.success) {
      return res.status(result.statusCode || 500).json({ error: result.error || 'Failed to cancel booking' });
    }

    logFromRequest(req, result.status === 'cancellation_pending' ? 'cancellation_requested' : 'cancel_booking', 'booking', idStr, undefined, {
      member_email: existing.userEmail,
      ...(existing.trackmanBookingId ? { trackman_booking_id: existing.trackmanBookingId } : {})
    }).catch(err => logger.error(`[BookingCancel] Audit log failed for bookingId=${bookingId}`, { extra: { bookingId, error: getErrorMessage(err) } }));

    let bayNameForLog = 'Simulator';
    if (existing.resourceId) {
      const [resourceForLog] = await db.select({ name: resources.name }).from(resources).where(eq(resources.id, existing.resourceId));
      if (resourceForLog?.name) {
        bayNameForLog = resourceForLog.name;
      }
    }

    const bookingDate = ensureDateString(existing.requestDate);
    const bookingTime = ensureTimeString(existing.startTime);

    await logMemberAction({
      memberEmail: existing.userEmail || '',
      action: result.status === 'cancellation_pending' ? 'cancellation_requested' : 'booking_cancelled_member',
      resourceType: 'booking',
      resourceId: String(bookingId),
      resourceName: result.status === 'cancellation_pending'
        ? `${bayNameForLog} on ${bookingDate}`
        : `Booking on ${bookingDate} at ${formatTime12Hour(bookingTime)}`,
      details: {
        source: 'member_dashboard',
        booking_date: bookingDate,
        booking_time: existing.startTime,
        bay_name: bayNameForLog,
        had_trackman_booking: !!existing.trackmanBookingId,
        ...(existing.trackmanBookingId ? { trackman_booking_id: existing.trackmanBookingId } : {}),
      },
      req
    });

    if (result.status === 'cancellation_pending') {
      return res.json({
        success: true,
        status: 'cancellation_pending',
        message: 'Cancellation request submitted. You will be notified once it is fully processed.'
      });
    }

    if (result.isLateCancel) {
      res.json({ 
        success: true, 
        message: 'Booking cancelled successfully. Fees were forfeited due to cancellation within 1 hour of booking start time.',
        refundSkipped: true
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Booking cancelled successfully',
        refundSkipped: false
      });
    }
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to cancel booking', error);
  }
});

export default router;
