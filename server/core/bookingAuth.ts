import { getTierLimits } from './tierService';
import { logger } from './logger';

export async function isAuthorizedForMemberBooking(tier: string | null | undefined): Promise<boolean> {
  if (!tier) return false;
  
  try {
    const limits = await getTierLimits(tier);
    return limits.can_book_simulators;
  } catch (error) {
    logger.error('[bookingAuth] Failed to fetch tier limits', { error, extra: { tier } });
    return false;
  }
}
