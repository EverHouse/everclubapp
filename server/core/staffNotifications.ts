import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { notifications, staffUsers, users } from '../../shared/schema';
import { isSyntheticEmail } from './notificationService';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

function resolveStaffUrl(type: string): string {
  if (type === 'cancellation_pending' || type === 'cancellation_stuck' || type === 'attendance' || type === 'trackman_cancelled_link') return '/admin/bookings';
  if (type.startsWith('booking') || type === 'day_pass' || type === 'guest_pass' || type === 'trackman_booking') return '/admin/bookings';
  if (type.startsWith('wellness')) return '/admin/calendar';
  if (type.startsWith('event')) return '/admin/calendar';
  if (type.startsWith('payment') || type === 'outstanding_balance' || type === 'billing' || type === 'billing_alert' || type === 'billing_migration' || type === 'terminal_refund' || type === 'terminal_dispute' || type === 'terminal_dispute_closed' || type === 'terminal_payment_canceled' || type === 'funds_added' || type === 'card_expiring' || type === 'fee_waived' || type === 'membership_failed' || type === 'membership_past_due') return '/admin/financials';
  if (type === 'membership_renewed' || type === 'membership_cancelled' || type === 'membership_terminated' || type === 'membership_cancellation' || type === 'new_member' || type === 'trial_expired' || type === 'trial_ending') return '/admin/directory';
  if (type === 'member_status_change' || type === 'membership_tier_change' || type === 'staff_note' || type === 'account_deletion') return '/admin/members';
  if (type === 'tour' || type === 'tour_scheduled' || type === 'tour_reminder') return '/admin/tours';
  if (type === 'bug_report') return '/admin/bugs';
  if (type === 'import_failure' || type === 'integration_error') return '/admin/data-integrity';
  if (type === 'waiver_review') return '/admin/waivers';
  if (type === 'trackman_unmatched') return '/admin/trackman';
  if (type === 'closure' || type === 'closure_today' || type === 'closure_created') return '/admin/notices';
  if (type === 'announcement') return '/admin/updates';
  if (type === 'system') return '/admin/data-integrity';
  return '/admin/updates';
}

export async function getStaffAndAdminEmails(): Promise<string[]> {
  const staffEmails = await db.select({ email: staffUsers.email })
    .from(staffUsers)
    .innerJoin(users, eq(sql`LOWER(${staffUsers.email})`, sql`LOWER(${users.email})`))
    .where(eq(staffUsers.isActive, true));
  
  return staffEmails.map(row => row.email);
}

export async function notifyAllStaffRequired(
  title: string,
  message: string,
  type: string,
  relatedId?: number,
  relatedType?: string
): Promise<void> {
  const emails = await getStaffAndAdminEmails();
  if (emails.length === 0) {
    throw new Error('No staff members to notify - cannot proceed without staff notification');
  }
  
  const url = resolveStaffUrl(type);
  
  const notificationValues = emails.map(email => ({
    userEmail: email,
    title,
    message,
    type,
    relatedId: relatedId ?? null,
    relatedType: relatedType ?? null,
    url,
  }));
  
  await db.insert(notifications).values(notificationValues);
}

export async function notifyAllStaff(
  title: string,
  message: string,
  type: string,
  relatedId?: number,
  relatedType?: string
): Promise<void> {
  try {
    await notifyAllStaffRequired(title, message, type, relatedId, relatedType);
  } catch (error: unknown) {
    logger.error('Failed to insert staff notifications:', { extra: { error: getErrorMessage(error) } });
  }
}

export async function notifyMemberRequired(
  userEmail: string,
  title: string,
  message: string,
  type: string,
  relatedId?: number,
  relatedType?: string
): Promise<void> {
  if (isSyntheticEmail(userEmail)) {
    return;
  }
  await db.insert(notifications).values({
    userEmail,
    title,
    message,
    type,
    relatedId: relatedId ?? null,
    relatedType: relatedType ?? null,
    url: resolveStaffUrl(type),
  });
}
