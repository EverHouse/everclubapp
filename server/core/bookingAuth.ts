import { getTierLimits } from './tierService';
import { logger } from './logger';

export async function isAuthorizedForMemberBooking(
  tier: string | null | undefined,
  role?: string
): Promise<boolean> {
  if (role === 'admin' || role === 'staff') return true;
  if (!tier) return false;
  
  try {
    const limits = await getTierLimits(tier);
    return limits.can_book_simulators;
  } catch (error) {
    logger.error('[bookingAuth] Failed to fetch tier limits', { error, extra: { tier } });
    return false;
  }
}
