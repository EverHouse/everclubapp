import { logger } from '../core/logger';
import { Router } from 'express';
import webpush from 'web-push';
import { isProduction } from '../core/db';
import { db } from '../db';
import { pushSubscriptions, users, notifications, events, eventRsvps, bookingRequests, wellnessClasses, wellnessEnrollments, facilityClosures } from '../../shared/schema';
import { eq, inArray, and, sql, or, isNull } from 'drizzle-orm';
import { formatTime12Hour, getTodayPacific, getTomorrowPacific } from '../utils/dateUtils';
import { isAuthenticated, isStaffOrAdmin } from '../core/middleware';
import { getErrorMessage, getErrorStatusCode } from '../utils/errorUtils';
import { isSyntheticEmail, notifyMember, notifyAllStaff } from '../core/notificationService';
import { sendPushNotification, sendPushNotificationToStaff, isPushNotificationsEnabled } from '../core/pushService';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { formatAffectedAreasForNotification } from '../utils/closureUtils';

const pushSubscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export { sendPushNotification, sendPushNotificationToStaff, isPushNotificationsEnabled };

const router = Router();

const vapidConfigured = isPushNotificationsEnabled();

const PUSH_ICON = '/icon-192.png';
const PUSH_BADGE = '/badge-72.png';

export async function sendPushNotificationToAllMembers(payload: { title: string; body: string; url?: string; tag?: string; icon?: string; badge?: string }): Promise<number> {
  if (!vapidConfigured) {
    logger.info('[Push to Members] Skipped - VAPID not configured');
    return 0;
  }
  
  const results = { sent: 0, pushFailed: 0 };
  
  try {
    const activeMemberFilter = and(
      or(eq(users.role, 'member'), isNull(users.role)),
      inArray(users.membershipStatus, ['active', 'trialing', 'past_due'])
    );

    const allMembers = await db
      .select({ email: users.email })
      .from(users)
      .where(activeMemberFilter);
    
    if (allMembers.length === 0) {
      logger.info('[Push to Members] No members found');
      return 0;
    }
    
    const memberSubscriptions = await db
      .select({
        userEmail: pushSubscriptions.userEmail,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(pushSubscriptions.userEmail, users.email))
      .where(activeMemberFilter);
    
    const uniqueEmails = [...new Set(allMembers.filter(m => m.email).map(m => m.email!))];
    const notifyResults = await Promise.allSettled(
      uniqueEmails.map(email =>
        notifyMember({
          userEmail: email,
          title: payload.title,
          message: payload.body,
          type: 'announcement',
          relatedType: 'announcement'
        })
      )
    );
    results.sent = notifyResults.filter(r => r.status === 'fulfilled').length;
    results.pushFailed = notifyResults.filter(r => r.status === 'rejected').length;
    
    logger.info('[Push to Members] Sent notifications via notifyMember', { extra: { resultsSent: results.sent, resultsPushFailed: results.pushFailed } });
    
    return results.sent;
  } catch (error: unknown) {
    logger.error('Failed to send push notification to members', { extra: { error: getErrorMessage(error) } });
    return 0;
  }
}

// PUBLIC ROUTE
router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/api/push/subscribe', isAuthenticated, validateBody(pushSubscribeSchema), async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'subscription is required' });
    }
    const userEmail = req.session?.user?.email;
    
    const { endpoint, keys } = subscription;
    
    await db
      .insert(pushSubscriptions)
      .values({
        userEmail: userEmail!,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userEmail: userEmail!,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      });
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Push subscription error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

router.post('/api/push/unsubscribe', isAuthenticated, validateBody(pushUnsubscribeSchema), async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint is required' });
    }
    const userEmail = req.session?.user?.email;
    
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userEmail, userEmail!)));
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Push unsubscribe error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

router.post('/api/push/test', isAuthenticated, async (req, res) => {
  try {
    const userEmail = req.session?.user?.email;
    
    await sendPushNotification(userEmail!, {
      title: 'Test Notification',
      body: 'This is a test push notification from Ever Club!',
      url: '/profile',
      tag: 'test',
      icon: PUSH_ICON,
      badge: PUSH_BADGE
    });
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Test push error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

export async function sendDailyReminders() {
  const results = { events: 0, bookings: 0, wellness: 0, pushFailed: 0, errors: [] as string[] };
  
  const tomorrowStr = getTomorrowPacific();
    
    const eventReminders = await db.select({
      userEmail: eventRsvps.userEmail,
      eventId: events.id,
      title: events.title,
      eventDate: events.eventDate,
      startTime: events.startTime,
      location: events.location
    })
    .from(eventRsvps)
    .innerJoin(events, eq(eventRsvps.eventId, events.id))
    .where(and(
      eq(eventRsvps.status, 'confirmed'),
      sql`DATE(${events.eventDate}) = ${tomorrowStr}`
    ));
    
    if (eventReminders.length > 0) {
      const eventNotifyResults = await Promise.allSettled(
        eventReminders.map(evt => {
          const message = `Reminder: ${evt.title} is tomorrow${evt.startTime ? ` at ${formatTime12Hour(evt.startTime)}` : ''}${evt.location ? ` - ${evt.location}` : ''}.`;
          return notifyMember({
            userEmail: evt.userEmail,
            title: 'Event Tomorrow',
            message,
            type: 'event_reminder',
            relatedId: evt.eventId,
            relatedType: 'event',
            url: '/events'
          });
        })
      );
      results.events = eventNotifyResults.filter(r => r.status === 'fulfilled').length;
    }
    
    const bookingReminders = await db.select({
      userEmail: bookingRequests.userEmail,
      id: bookingRequests.id,
      requestDate: bookingRequests.requestDate,
      startTime: bookingRequests.startTime,
      resourceId: bookingRequests.resourceId
    })
    .from(bookingRequests)
    .where(and(
      eq(bookingRequests.status, 'approved'),
      sql`DATE(${bookingRequests.requestDate}) = ${tomorrowStr}`
    ));
    
    if (bookingReminders.length > 0) {
      const validBookings = bookingReminders.filter(b => b.userEmail && !isSyntheticEmail(b.userEmail));
      const bookingNotifyResults = await Promise.allSettled(
        validBookings.map(booking => {
          const message = `Reminder: Your simulator booking is tomorrow at ${formatTime12Hour(booking.startTime)}${booking.resourceId ? ` on Bay ${booking.resourceId}` : ''}.`;
          return notifyMember({
            userEmail: booking.userEmail,
            title: 'Booking Tomorrow',
            message,
            type: 'booking_reminder',
            relatedId: booking.id,
            relatedType: 'booking_request',
            url: '/sims'
          });
        })
      );
      results.bookings = bookingNotifyResults.filter(r => r.status === 'fulfilled').length;
    }
    
    const wellnessReminders = await db.select({
      userEmail: wellnessEnrollments.userEmail,
      classId: wellnessClasses.id,
      title: wellnessClasses.title,
      date: wellnessClasses.date,
      time: wellnessClasses.time,
      instructor: wellnessClasses.instructor
    })
    .from(wellnessEnrollments)
    .innerJoin(wellnessClasses, eq(wellnessEnrollments.classId, wellnessClasses.id))
    .where(and(
      eq(wellnessEnrollments.status, 'confirmed'),
      sql`DATE(${wellnessClasses.date}) = ${tomorrowStr}`
    ));
    
    if (wellnessReminders.length > 0) {
      const wellnessNotifyResults = await Promise.allSettled(
        wellnessReminders.map(cls => {
          const message = `Reminder: ${cls.title} with ${cls.instructor} is tomorrow at ${formatTime12Hour(cls.time)}.`;
          return notifyMember({
            userEmail: cls.userEmail,
            title: 'Wellness Class Tomorrow',
            message,
            type: 'wellness_reminder',
            relatedId: cls.classId,
            relatedType: 'wellness_class',
            url: '/wellness'
          });
        })
      );
      results.wellness = wellnessNotifyResults.filter(r => r.status === 'fulfilled').length;
    }
    
  logger.info('[Daily Reminders] Sent event, booking, wellness reminders. Push failures', { extra: { resultsEvents: results.events, resultsBookings: results.bookings, resultsWellness: results.wellness, resultsPushFailed: results.pushFailed } });
  
  return {
    success: true,
    message: `Sent ${results.events} event, ${results.bookings} booking, and ${results.wellness} wellness reminders`,
    ...results
  };
}

router.post('/api/push/send-daily-reminders', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await sendDailyReminders();
    res.json(result);
  } catch (error: unknown) {
    logger.error('Daily reminders error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to send daily reminders' });
  }
});

// Send morning notifications for closures/notices starting today
export async function sendMorningClosureNotifications() {
  const results = { closures: 0, skipped: 0, pushFailed: 0, errors: [] as string[] };
  
  try {
    const todayStr = getTodayPacific();
    
    // Find closures that:
    // 1. Start today
    // 2. Are published (needsReview = false)
    // 3. Are active
    // 4. Affect booking availability (affectedAreas != 'none')
    const todayClosures = await db
      .select({
        id: facilityClosures.id,
        title: facilityClosures.title,
        reason: facilityClosures.reason,
        noticeType: facilityClosures.noticeType,
        startDate: facilityClosures.startDate,
        startTime: facilityClosures.startTime,
        endTime: facilityClosures.endTime,
        affectedAreas: facilityClosures.affectedAreas
      })
      .from(facilityClosures)
      .where(and(
        sql`DATE(${facilityClosures.startDate}) = ${todayStr}`,
        eq(facilityClosures.isActive, true),
        eq(facilityClosures.needsReview, false)
      ));
    
    if (todayClosures.length === 0) {
      logger.info('[Morning Notifications] No closures starting today');
      return { success: true, message: 'No closures starting today', ...results };
    }
    
    // Check which closures have already been notified (idempotency check)
    // Look for existing closure_today notifications for these closure IDs
    const closureIds = todayClosures.map(c => c.id);
    const existingNotifications = await db
      .select({
        relatedId: notifications.relatedId
      })
      .from(notifications)
      .where(and(
        eq(notifications.type, 'closure_today'),
        eq(notifications.relatedType, 'closure'),
        inArray(notifications.relatedId, closureIds)
      ))
      .groupBy(notifications.relatedId);
    
    const alreadyNotifiedIds = new Set(existingNotifications.map(n => n.relatedId));
    const closuresToNotify = todayClosures.filter(c => !alreadyNotifiedIds.has(c.id));
    
    if (closuresToNotify.length === 0) {
      const skippedCount = todayClosures.length;
      logger.info('[Morning Notifications] All closures already notified today', { extra: { skippedCount } });
      return { success: true, message: `All ${skippedCount} closures already notified`, ...results, skipped: skippedCount };
    }
    
    results.skipped = todayClosures.length - closuresToNotify.length;
    
    for (const closure of closuresToNotify) {
      const title = closure.noticeType || closure.title || 'Notice';
      const timeInfo = closure.startTime && closure.endTime 
        ? `${formatTime12Hour(closure.startTime)} - ${formatTime12Hour(closure.endTime)}`
        : '';
      const affectedText = closure.affectedAreas && closure.affectedAreas !== 'none' && closure.affectedAreas !== ''
        ? formatAffectedAreasForNotification(closure.affectedAreas)
        : '';
      const parts: string[] = [];
      if (closure.title) parts.push(closure.title);
      if (timeInfo) parts.push(timeInfo);
      if (affectedText) parts.push(affectedText);
      if (closure.reason) parts.push(closure.reason);
      const message = parts.length > 0 ? parts.join(' • ') : title;

      await notifyAllStaff(
        `Today: ${title}`,
        message,
        'closure_today',
        {
          relatedId: closure.id,
          relatedType: 'closure',
          sendPush: true,
          sendWebSocket: true,
          url: '/staff/facility'
        }
      );
      results.closures++;
    }
    
    logger.info('[Morning Notifications] Sent staff closure notifications', { extra: { resultsClosures: results.closures, resultsSkipped: results.skipped, resultsPushFailed: results.pushFailed } });
    
    return {
      success: true,
      message: `Sent notifications for ${results.closures} closures starting today (${results.skipped} already notified)`,
      ...results
    };
  } catch (error: unknown) {
    logger.error('[Morning Notifications] Error', { extra: { error: getErrorMessage(error) } });
    results.errors.push(getErrorMessage(error));
    return { success: false, message: 'Failed to send morning notifications', ...results };
  }
}

router.post('/api/push/send-morning-closure-notifications', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await sendMorningClosureNotifications();
    res.json(result);
  } catch (error: unknown) {
    logger.error('Morning closure notifications error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to send morning closure notifications' });
  }
});

export default router;
