import { bookingEvents } from '../../core/bookingEvents';
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';

export { getCalendarNameForBayAsync, getCalendarNameForBay } from '../../core/calendar/calendarHelpers';

export async function dismissStaffNotificationsForBooking(bookingId: number): Promise<void> {
  try {
    await bookingEvents.cleanupNotificationsForBooking(bookingId, { markRead: true });
  } catch (error: unknown) {
    logger.error('Failed to dismiss staff notifications', { extra: { error: getErrorMessage(error) } });
  }
}

export async function isStaffOrAdminCheck(email: string): Promise<boolean> {
  const { isAdminEmail, getAuthPool, queryWithRetry } = await import('../../replit_integrations/auth/replitAuth');
  const { getAlternateDomainEmail } = await import('../../core/utils/emailNormalization');
  const isAdmin = await isAdminEmail(email);
  if (isAdmin) return true;
  
  const pool = getAuthPool();
  if (!pool) return false;
  
  try {
    const alt = getAlternateDomainEmail(email);
    const emails = alt ? [email, alt] : [email];
    const result = await queryWithRetry(
      pool,
      `SELECT id FROM staff_users WHERE LOWER(email) = ANY($1::text[]) AND is_active = true`,
      [emails.map(e => e.toLowerCase())]
    );
    return (result as unknown as { rows: Array<Record<string, unknown>> }).rows.length > 0;
  } catch (error: unknown) {
    logger.error('[Bays] isActiveStaff DB check failed, defaulting to false', { extra: { error: getErrorMessage(error) } });
    return false;
  }
}
