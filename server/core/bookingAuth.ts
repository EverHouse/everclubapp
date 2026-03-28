import { getTierLimits } from './tierService';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

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
    logger.error('[bookingAuth] Failed to fetch tier limits', { extra: { error: getErrorMessage(error), tier } });
    return false;
  }
}
