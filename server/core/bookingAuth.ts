import { getTierLimits } from './tierService';

export async function isAuthorizedForMemberBooking(tier: string | null | undefined): Promise<boolean> {
  if (!tier) return false;
  
  const limits = await getTierLimits(tier);
  return limits.can_book_simulators;
}
