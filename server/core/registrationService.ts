import { db } from '../db';
import { events, eventRsvps, wellnessEnrollments, wellnessClasses } from '../../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { notifyAllStaff, notifyMember } from './notificationService';
import { formatDateDisplayWithDay, formatTime12Hour, formatDateFromDb } from '../utils/dateUtils';
import { broadcastToStaff, broadcastWaitlistUpdate } from './websocket';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';
import { invalidateCache } from './queryCache';

export interface RegistrationContext {
  userEmail: string;
  sessionEmail: string;
  isStaffOverride: boolean;
}

export interface EventRsvpResult {
  rsvp: typeof eventRsvps.$inferSelect;
  memberMessage: string;
  staffMessage: string;
  eventTitle: string;
}

export async function createEventRsvp(
  eventId: number,
  ctx: RegistrationContext,
  memberDisplayName: string
): Promise<EventRsvpResult> {
  const { userEmail } = ctx;

  const eventData = await db.select({
    title: events.title,
    eventDate: events.eventDate,
    startTime: events.startTime,
    location: events.location,
    maxAttendees: events.maxAttendees
  }).from(events).where(eq(events.id, eventId));

  if (eventData.length === 0) {
    throw Object.assign(new Error('Event not found'), { statusCode: 404 });
  }

  const evt = eventData[0];
  const formattedDate = formatDateDisplayWithDay(evt.eventDate);
  const formattedTime = evt.startTime ? formatTime12Hour(evt.startTime) : '';
  const memberMessage = `You're confirmed for ${evt.title} on ${formattedDate}${formattedTime ? ` at ${formattedTime}` : ''}${evt.location ? ` - ${evt.location}` : ''}.`;
  const staffMessage = `${memberDisplayName} RSVP'd for ${evt.title} on ${formattedDate}`;

  const rsvp = await db.transaction(async (tx) => {
    if (evt.maxAttendees && evt.maxAttendees > 0) {
      await tx.execute(sql`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`);
      const rsvpCountResult = await tx.select({ count: sql<number>`count(*)::int` })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, 'confirmed')));

      const rsvpCount = rsvpCountResult[0]?.count || 0;

      if (rsvpCount >= evt.maxAttendees) {
        throw Object.assign(new Error('Event is at capacity'), { statusCode: 400 });
      }
    }

    const rsvpResult = await tx.insert(eventRsvps).values({
      eventId,
      userEmail,
      checkedIn: true,
    }).onConflictDoUpdate({
      target: [eventRsvps.eventId, eventRsvps.userEmail],
      set: { status: 'confirmed', checkedIn: true },
    }).returning();

    return rsvpResult[0];
  });

  notifyMember({
    userEmail,
    title: 'Event RSVP Confirmed',
    message: memberMessage,
    type: 'event_rsvp',
    relatedId: eventId,
    relatedType: 'event',
    url: '/events'
  }).catch(err => logger.warn('Failed to send RSVP notification', { extra: { error: getErrorMessage(err) } }));

  notifyAllStaff(
    'New Event RSVP',
    staffMessage,
    'event_rsvp',
    { relatedId: eventId, relatedType: 'event', url: '/admin/calendar' }
  ).catch((err: unknown) => logger.warn('Failed to notify staff of event RSVP', { extra: { error: getErrorMessage(err) } }));

  broadcastToStaff({
    type: 'rsvp_event',
    action: 'rsvp_created',
    eventId,
    memberEmail: userEmail
  });

  invalidateCache('members_directory');

  return { rsvp, memberMessage, staffMessage, eventTitle: evt.title };
}

export interface WellnessEnrollmentResult {
  enrollment: typeof wellnessEnrollments.$inferSelect;
  isWaitlisted: boolean;
  memberMessage: string;
  staffMessage: string;
  classTitle: string;
}

export async function createWellnessEnrollment(
  classId: number,
  ctx: RegistrationContext,
  memberDisplayName: string
): Promise<WellnessEnrollmentResult> {
  const { userEmail } = ctx;

  const existing = await db.select({ id: wellnessEnrollments.id })
    .from(wellnessEnrollments)
    .where(and(
      eq(wellnessEnrollments.classId, classId),
      eq(wellnessEnrollments.userEmail, userEmail),
      eq(wellnessEnrollments.status, 'confirmed')
    ));

  if (existing.length > 0) {
    throw Object.assign(new Error('Already enrolled in this class'), { statusCode: 409 });
  }

  const classDataResult = await db.execute(sql`SELECT wc.*,
      COALESCE((SELECT COUNT(*) FROM wellness_enrollments WHERE class_id = wc.id AND status = 'confirmed' AND is_waitlisted = false), 0)::integer as enrolled_count
    FROM wellness_classes wc WHERE wc.id = ${classId}`);

  if (classDataResult.rows.length === 0) {
    throw Object.assign(new Error('Wellness class not found'), { statusCode: 404 });
  }

  const cls = classDataResult.rows[0] as Record<string, unknown>;
  const classDate = cls.date;
  const dateStr = formatDateFromDb(classDate as Date | string);
  const formattedDate = formatDateDisplayWithDay(dateStr);
  const waitlistEnabled = cls.waitlist_enabled as boolean;
  const classTitle = cls.title as string;
  const classInstructor = cls.instructor as string;
  const classTime = cls.time as string;

  let result: { enrollment: typeof wellnessEnrollments.$inferSelect; isWaitlisted: boolean; memberMessage: string };

  try {
    result = await db.transaction(async (tx) => {
      const lockedClassResult = await tx.execute(sql`SELECT capacity,
          COALESCE((SELECT COUNT(*) FROM wellness_enrollments WHERE class_id = ${classId} AND status = 'confirmed' AND is_waitlisted = false), 0)::integer as enrolled_count
        FROM wellness_classes WHERE id = ${classId} FOR UPDATE`);

      const lockedCls = lockedClassResult.rows[0] as { capacity: number | null; enrolled_count: number };
      const capacity = lockedCls.capacity;
      const enrolledCount = lockedCls.enrolled_count;
      const isAtCapacity = capacity !== null && capacity !== undefined && enrolledCount >= capacity;

      if (isAtCapacity && !waitlistEnabled) {
        throw Object.assign(new Error('This class is full'), { statusCode: 400 });
      }

      const isWaitlisted = isAtCapacity && waitlistEnabled;

      const memberMessage = isWaitlisted
        ? `You've been added to the waitlist for ${classTitle} with ${classInstructor} on ${formattedDate} at ${formatTime12Hour(classTime)}. We'll notify you if a spot opens up.`
        : `You're enrolled in ${classTitle} with ${classInstructor} on ${formattedDate} at ${formatTime12Hour(classTime)}.`;

      const enrollmentResult = await tx.insert(wellnessEnrollments)
        .values({
          classId,
          userEmail,
          status: 'confirmed',
          isWaitlisted: isWaitlisted as boolean
        })
        .returning();

      return { enrollment: enrollmentResult[0], isWaitlisted, memberMessage };
    });
  } catch (txErr: unknown) {
    if (getErrorMessage(txErr).includes('wellness_enrollments_unique_active')) {
      throw Object.assign(new Error('Already enrolled in this class'), { statusCode: 409 });
    }
    throw txErr;
  }

  const { isWaitlisted, memberMessage } = result;

  notifyMember({
    userEmail,
    title: isWaitlisted ? 'Added to Waitlist' : 'Wellness Class Confirmed',
    message: memberMessage,
    type: 'wellness_booking',
    relatedId: classId,
    relatedType: 'wellness_class',
    url: '/wellness'
  }).catch(err => logger.warn('Failed to send wellness enrollment notification', { extra: { error: getErrorMessage(err) } }));

  const staffMessage = isWaitlisted
    ? `${memberDisplayName} joined the waitlist for ${classTitle} on ${formattedDate}`
    : `${memberDisplayName} enrolled in ${classTitle} on ${formattedDate}`;

  notifyAllStaff(
    isWaitlisted ? 'New Waitlist Entry' : 'New Wellness Enrollment',
    staffMessage,
    'wellness_enrollment',
    { relatedId: classId, relatedType: 'wellness_class', url: '/admin/calendar' }
  ).catch(err => logger.warn('Failed to notify staff of wellness enrollment', { extra: { error: getErrorMessage(err) } }));

  broadcastToStaff({
    type: 'wellness_event',
    action: isWaitlisted ? 'waitlist_joined' : 'enrollment_created',
    classId,
    memberEmail: userEmail
  });

  broadcastWaitlistUpdate({ classId, action: 'enrolled' });

  invalidateCache('members_directory');

  return { enrollment: result.enrollment, isWaitlisted, memberMessage, staffMessage, classTitle };
}
