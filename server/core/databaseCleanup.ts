import { db } from '../db';
import { bookingRequests, notifications, users, eventRsvps } from '../../shared/schema';
import { sql, eq, like, or, and, inArray } from 'drizzle-orm';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

interface DrizzleExecuteResult {
  rowCount?: number;
  rows?: unknown[];
}

interface CleanupResult {
  testNotifications: number;
  testBookings: number;
  testUsers: number;
  testRsvps: number;
  oldCancelledBookings: number;
}

const _TEST_EMAIL_PATTERNS = [
  'test-member@example.com',
  'test-staff@example.com',
  'notif-test-member@example.com',
  'notif-test-staff@example.com',
  'booking-test-%',
  'calendar-test-%',
  '%@test.example.com'
];

const _TEST_NAME_PATTERNS = [
  'Test Member',
  'Test Staff',
  'Test User'
];

export async function cleanupTestData(): Promise<CleanupResult> {
  const result: CleanupResult = {
    testNotifications: 0,
    testBookings: 0,
    testUsers: 0,
    testRsvps: 0,
    oldCancelledBookings: 0
  };
  
  try {
    const testNotifications = await db
      .delete(notifications)
      .where(
        or(
          like(notifications.userEmail, 'test-%@example.com'),
          like(notifications.userEmail, 'notif-test-%'),
          like(notifications.userEmail, '%@test.example.com'),
          sql`${notifications.title} LIKE '%Test Member%'`,
          sql`${notifications.message} LIKE '%Test Member%'`
        )
      )
      .returning({ id: notifications.id });
    
    result.testNotifications = testNotifications.length;
    
    const testBookings = await db
      .delete(bookingRequests)
      .where(
        or(
          like(bookingRequests.userEmail, 'test-%@example.com'),
          like(bookingRequests.userEmail, 'notif-test-%'),
          like(bookingRequests.userEmail, '%@test.example.com'),
          like(bookingRequests.userName, 'Test %')
        )
      )
      .returning({ id: bookingRequests.id });
    
    result.testBookings = testBookings.length;
    
    const testRsvps = await db
      .delete(eventRsvps)
      .where(
        or(
          like(eventRsvps.userEmail, 'test-%@example.com'),
          like(eventRsvps.userEmail, 'notif-test-%'),
          like(eventRsvps.userEmail, '%@test.example.com')
        )
      )
      .returning({ id: eventRsvps.id });
    
    result.testRsvps = testRsvps.length;
    
    const testUsers = await db
      .delete(users)
      .where(
        or(
          like(users.email, 'test-%@example.com'),
          like(users.email, 'notif-test-%'),
          like(users.email, '%@test.example.com'),
          like(users.email, 'booking-test-%'),
          like(users.email, 'calendar-test-%')
        )
      )
      .returning({ id: users.id });
    
    result.testUsers = testUsers.length;
    
    logger.info('[Cleanup] Test data cleanup completed', {
      extra: { 
        event: 'cleanup.test_data',
        ...result
      }
    });
    
    return result;
  } catch (error: unknown) {
    logger.error('[Cleanup] Test data cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.test_data_failed' }
    });
    throw error;
  }
}

export async function cleanupOldBookings(daysOld: number = 90): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    const oldBookings = await db
      .delete(bookingRequests)
      .where(
        and(
          inArray(bookingRequests.status, ['cancelled', 'declined']),
          sql`${bookingRequests.requestDate} < ${cutoffDateStr}`
        )
      )
      .returning({ id: bookingRequests.id });
    
    logger.info(`[Cleanup] Removed ${oldBookings.length} old cancelled/declined bookings`, {
      extra: { 
        event: 'cleanup.old_bookings',
        count: oldBookings.length,
        daysOld,
        cutoffDate: cutoffDateStr
      }
    });
    
    return oldBookings.length;
  } catch (error: unknown) {
    logger.error('[Cleanup] Old bookings cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.old_bookings_failed' }
    });
    throw error;
  }
}

export async function cleanupOldNotifications(daysOld: number = 90): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const oldNotifications = await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.isRead, true),
          sql`${notifications.createdAt} < ${cutoffDate.toISOString()}`
        )
      )
      .returning({ id: notifications.id });
    
    logger.info(`[Cleanup] Removed ${oldNotifications.length} old read notifications`, {
      extra: { 
        event: 'cleanup.old_notifications',
        count: oldNotifications.length,
        daysOld
      }
    });
    
    return oldNotifications.length;
  } catch (error: unknown) {
    logger.error('[Cleanup] Old notifications cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.old_notifications_failed' }
    });
    throw error;
  }
}

export async function cleanupOldUnreadNotifications(daysOld: number = 60): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const oldNotifications = await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.isRead, false),
          sql`${notifications.createdAt} < ${cutoffDate.toISOString()}`
        )
      )
      .returning({ id: notifications.id });
    
    logger.info(`[Cleanup] Removed ${oldNotifications.length} old unread notifications (>${daysOld} days)`, {
      extra: { 
        event: 'cleanup.old_unread_notifications',
        count: oldNotifications.length,
        daysOld
      }
    });
    
    return oldNotifications.length;
  } catch (error: unknown) {
    logger.error('[Cleanup] Old unread notifications cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.old_unread_notifications_failed' }
    });
    throw error;
  }
}

export async function cleanupOldAvailabilityBlocks(daysOld: number = 30): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM availability_blocks 
      WHERE block_date < CURRENT_DATE - ${daysOld} * INTERVAL '1 day'
    `);
    
    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);
    
    if (count > 0) {
      logger.info(`[Cleanup] Removed ${count} old availability blocks (>${daysOld} days)`, {
        extra: { event: 'cleanup.old_availability_blocks', count, daysOld }
      });
    }
    
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Old availability blocks cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.old_availability_blocks_failed' }
    });
    throw error;
  }
}

export async function cleanupLessonClosures(): Promise<number> {
  try {
    const result = await db.execute(sql`
      UPDATE facility_closures
      SET is_active = false
      WHERE is_active = true
        AND end_date < CURRENT_DATE
        AND (
          LOWER(title) LIKE 'lesson%'
          OR LOWER(title) LIKE 'private lesson%'
          OR LOWER(title) LIKE 'kids lesson%'
          OR LOWER(title) LIKE 'group lesson%'
          OR LOWER(title) LIKE 'beginner group lesson%'
        )
    `);

    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);

    if (count > 0) {
      logger.info(`[Cleanup] Deactivated ${count} past lesson closures`, {
        extra: { event: 'cleanup.lesson_closures', count }
      });
    }

    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Lesson closures cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.lesson_closures_failed' }
    });
    throw error;
  }
}

export async function cleanupOldIntegrityHistory(daysOld: number = 14): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM integrity_check_history 
      WHERE checked_at < NOW() - ${daysOld} * INTERVAL '1 day'
    `);
    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);
    if (count > 0) {
      logger.info(`[Cleanup] Removed ${count} old integrity check history records (>${daysOld} days)`, {
        extra: { event: 'cleanup.integrity_history', count, daysOld }
      });
    }
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Integrity history cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.integrity_history_failed' }
    });
    return 0;
  }
}

export async function cleanupResolvedIntegrityIssues(daysOld: number = 14): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM integrity_issues_tracking 
      WHERE status = 'resolved' AND resolved_at < NOW() - ${daysOld} * INTERVAL '1 day'
    `);
    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);
    if (count > 0) {
      logger.info(`[Cleanup] Removed ${count} resolved integrity issues (>${daysOld} days)`, {
        extra: { event: 'cleanup.resolved_integrity_issues', count, daysOld }
      });
    }
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Resolved integrity issues cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.resolved_integrity_issues_failed' }
    });
    return 0;
  }
}

export async function cleanupOldAuditLog(daysOld: number = 60): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM admin_audit_log 
      WHERE created_at < NOW() - ${daysOld} * INTERVAL '1 day'
    `);
    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);
    if (count > 0) {
      logger.info(`[Cleanup] Removed ${count} old audit log entries (>${daysOld} days)`, {
        extra: { event: 'cleanup.audit_log', count, daysOld }
      });
    }
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Audit log cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.audit_log_failed' }
    });
    return 0;
  }
}

export async function cleanupOldCommunicationLogs(daysOld: number = 30): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM communication_logs 
      WHERE created_at < NOW() - ${daysOld} * INTERVAL '1 day'
    `);
    const execResult = result as unknown as DrizzleExecuteResult;
    const count = Number(execResult.rowCount || execResult.rows?.length || 0);
    if (count > 0) {
      logger.info(`[Cleanup] Removed ${count} old communication logs (>${daysOld} days)`, {
        extra: { event: 'cleanup.communication_logs', count, daysOld }
      });
    }
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Communication logs cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.communication_logs_failed' }
    });
    return 0;
  }
}

export async function cleanupOldJobs(daysToKeep: number = 7): Promise<number> {
  try {
    const { cleanupOldJobs: cleanupJobs } = await import('../core/jobQueue');
    const count = await cleanupJobs(daysToKeep);
    return count;
  } catch (error: unknown) {
    logger.error('[Cleanup] Old jobs cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.old_jobs_failed' }
    });
    return 0;
  }
}

export async function runScheduledCleanup(): Promise<void> {
  logger.info('[Cleanup] Starting scheduled cleanup', {
    extra: { event: 'cleanup.scheduled_start' }
  });
  
  try {
    await cleanupTestData();
    await cleanupOldBookings(90);
    await cleanupOldNotifications(90);
    await cleanupOldUnreadNotifications(60);
    await cleanupOldAvailabilityBlocks(30);
    await cleanupLessonClosures();
    await cleanupOldJobs(7);
    await cleanupOldIntegrityHistory(14);
    await cleanupResolvedIntegrityIssues(14);
    await cleanupOldAuditLog(60);
    await cleanupOldCommunicationLogs(30);
    
    logger.info('[Cleanup] Scheduled cleanup completed', {
      extra: { event: 'cleanup.scheduled_complete' }
    });
  } catch (error: unknown) {
    logger.error('[Cleanup] Scheduled cleanup failed', {
      extra: { error: getErrorMessage(error), event: 'cleanup.scheduled_failed' }
    });
  }
}
