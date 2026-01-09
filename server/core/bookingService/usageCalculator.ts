import { logger } from '../logger';
import { getTierLimits, getMemberTierByEmail } from '../tierService';

export interface Participant {
  userId?: string;
  email?: string;
  guestId?: number;
  participantType: 'owner' | 'member' | 'guest';
  displayName: string;
}

export interface UsageAllocation {
  userId?: string;
  guestId?: number;
  participantType: 'owner' | 'member' | 'guest';
  displayName: string;
  minutesAllocated: number;
}

export interface OverageFeeResult {
  hasOverage: boolean;
  overageMinutes: number;
  overageFee: number;
}

const OVERAGE_RATE_PER_30_MIN = 25;
const OVERAGE_RATE_PER_HOUR = 50;

export interface AllocationOptions {
  declaredSlots?: number;
  assignRemainderToOwner?: boolean;
}

export function computeUsageAllocation(
  sessionDuration: number,
  participants: Participant[],
  options?: AllocationOptions
): UsageAllocation[] {
  if (!participants || participants.length === 0) {
    return [];
  }
  
  // Use declaredSlots if provided, otherwise use participant count
  const divisor = options?.declaredSlots && options.declaredSlots > 0 
    ? options.declaredSlots 
    : participants.length;
  
  const minutesPerParticipant = Math.floor(sessionDuration / divisor);
  const remainder = sessionDuration % divisor;
  
  // If assigning remainder to owner, find owner and give them the extra minutes
  // Otherwise distribute remainder 1 minute at a time to first N participants
  const assignToOwner = options?.assignRemainderToOwner ?? false;
  
  if (assignToOwner) {
    // Remainder goes entirely to the owner
    return participants.map((participant) => ({
      userId: participant.userId,
      guestId: participant.guestId,
      participantType: participant.participantType,
      displayName: participant.displayName,
      minutesAllocated: minutesPerParticipant + (participant.participantType === 'owner' ? remainder : 0)
    }));
  }
  
  // Default: distribute remainder to first N participants
  return participants.map((participant, index) => ({
    userId: participant.userId,
    guestId: participant.guestId,
    participantType: participant.participantType,
    displayName: participant.displayName,
    minutesAllocated: minutesPerParticipant + (index < remainder ? 1 : 0)
  }));
}

export function calculateOverageFee(
  minutesUsed: number,
  tierAllowance: number
): OverageFeeResult {
  if (tierAllowance >= 999 || minutesUsed <= tierAllowance) {
    return {
      hasOverage: false,
      overageMinutes: 0,
      overageFee: 0
    };
  }
  
  const overageMinutes = minutesUsed - tierAllowance;
  
  const thirtyMinBlocks = Math.ceil(overageMinutes / 30);
  const overageFee = thirtyMinBlocks * OVERAGE_RATE_PER_30_MIN;
  
  return {
    hasOverage: true,
    overageMinutes,
    overageFee
  };
}

export interface GuestTimeAssignment {
  hostEmail: string;
  guestMinutes: number;
  totalHostMinutes: number;
  overageFee: number;
}

export async function assignGuestTimeToHost(
  hostEmail: string,
  guestMinutes: number,
  existingHostMinutes: number = 0
): Promise<GuestTimeAssignment> {
  try {
    const tier = await getMemberTierByEmail(hostEmail);
    
    if (!tier) {
      const overageResult = calculateOverageFee(guestMinutes, 0);
      return {
        hostEmail,
        guestMinutes,
        totalHostMinutes: existingHostMinutes + guestMinutes,
        overageFee: overageResult.overageFee
      };
    }
    
    const limits = await getTierLimits(tier);
    const totalMinutes = existingHostMinutes + guestMinutes;
    
    const overageResult = calculateOverageFee(totalMinutes, limits.daily_sim_minutes);
    
    return {
      hostEmail,
      guestMinutes,
      totalHostMinutes: totalMinutes,
      overageFee: overageResult.overageFee
    };
  } catch (error) {
    logger.error('[assignGuestTimeToHost] Error:', { error: error as Error });
    throw error;
  }
}

export function computeTotalSessionCost(
  allocations: UsageAllocation[],
  tierAllowances: Map<string, number>
): number {
  let totalCost = 0;
  
  for (const allocation of allocations) {
    if (allocation.participantType === 'guest') {
      continue;
    }
    
    if (allocation.userId) {
      const allowance = tierAllowances.get(allocation.userId) ?? 0;
      const overage = calculateOverageFee(allocation.minutesAllocated, allowance);
      totalCost += overage.overageFee;
    }
  }
  
  return totalCost;
}

export function formatOverageFee(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatOverageFeeFromDollars(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

export { OVERAGE_RATE_PER_30_MIN, OVERAGE_RATE_PER_HOUR };
