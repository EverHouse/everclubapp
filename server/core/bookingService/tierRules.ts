/**
 * Tier Rules Module for Multi-Member Booking System
 * 
 * SCOPE LIMITATIONS (Phase 2):
 * - Only DAILY limits are enforced (daily_sim_minutes from membership_tiers)
 * - Weekly limits are NOT implemented - no weekly_sim_minutes column exists in schema
 * - If weekly caps are needed, a future phase should add the column and aggregation logic
 */
import { pool } from '../db';
import { 
  getTierLimits, 
  getMemberTierByEmail, 
  checkDailyBookingLimit,
  getDailyBookedMinutes,
  TierLimits 
} from '../tierService';
import { logger } from '../logger';

export interface TierValidationResult {
  allowed: boolean;
  reason?: string;
  remainingMinutes?: number;
  tier?: string;
}

export interface SocialTierResult {
  allowed: boolean;
  reason?: string;
}

export interface ParticipantForValidation {
  type: 'owner' | 'member' | 'guest';
  displayName?: string;
}

export async function validateTierWindowAndBalance(
  memberEmail: string,
  bookingDate: string,
  duration: number,
  declaredPlayerCount: number = 1
): Promise<TierValidationResult> {
  try {
    const tier = await getMemberTierByEmail(memberEmail);
    
    if (!tier) {
      return { 
        allowed: false, 
        reason: 'Member not found or no tier assigned' 
      };
    }
    
    const result = await checkDailyBookingLimit(memberEmail, bookingDate, duration, tier);
    
    if (!result.allowed) {
      return {
        allowed: false,
        reason: result.reason,
        remainingMinutes: result.remainingMinutes,
        tier
      };
    }
    
    return {
      allowed: true,
      remainingMinutes: result.remainingMinutes,
      tier
    };
  } catch (error) {
    logger.error('[validateTierWindowAndBalance] Error:', { error: error as Error });
    throw error;
  }
}

export async function getRemainingMinutes(
  memberEmail: string,
  tier?: string,
  date?: string
): Promise<number> {
  try {
    const memberTier = tier || await getMemberTierByEmail(memberEmail);
    
    if (!memberTier) {
      return 0;
    }
    
    const limits = await getTierLimits(memberTier);
    
    if (limits.unlimited_access || limits.daily_sim_minutes >= 999) {
      return 999;
    }
    
    if (limits.daily_sim_minutes === 0) {
      return 0;
    }
    
    const targetDate = date || new Date().toISOString().split('T')[0];
    const bookedMinutes = await getDailyBookedMinutes(memberEmail, targetDate);
    
    return Math.max(0, limits.daily_sim_minutes - bookedMinutes);
  } catch (error) {
    logger.error('[getRemainingMinutes] Error:', { error: error as Error });
    return 0;
  }
}

export async function enforceSocialTierRules(
  ownerTier: string,
  participants: ParticipantForValidation[]
): Promise<SocialTierResult> {
  try {
    const normalizedTier = ownerTier.toLowerCase();
    
    // Non-Social tiers can always have guests
    if (!normalizedTier.includes('social')) {
      return { allowed: true };
    }
    
    const limits = await getTierLimits(ownerTier);
    
    // Check if Social tier has 0 guest passes and participants include guests
    if (limits.guest_passes_per_month === 0) {
      const hasGuests = participants.some(p => p.type === 'guest');
      
      if (hasGuests) {
        return {
          allowed: false,
          reason: 'Social tier members cannot bring guests to simulator bookings. Your membership includes 0 guest passes per month.'
        };
      }
    }
    
    // Social hosts CAN have other members in their booking
    return { allowed: true };
  } catch (error) {
    logger.error('[enforceSocialTierRules] Error:', { error: error as Error });
    return { allowed: true };
  }
}

// Legacy function for backward compatibility (deprecated)
export async function enforceSocialTierRulesLegacy(
  ownerTier: string,
  participantCount: number
): Promise<SocialTierResult> {
  // Convert count to participants (assume all additional are guests for conservative check)
  const participants: ParticipantForValidation[] = [{ type: 'owner' }];
  for (let i = 1; i < participantCount; i++) {
    participants.push({ type: 'guest' });
  }
  return enforceSocialTierRules(ownerTier, participants);
}

export async function getGuestPassesRemaining(memberEmail: string): Promise<number> {
  try {
    const tier = await getMemberTierByEmail(memberEmail);
    
    if (!tier) {
      return 0;
    }
    
    const limits = await getTierLimits(tier);
    
    const currentMonth = new Date();
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
      .toISOString().split('T')[0];
    const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    
    const result = await pool.query(
      `SELECT COUNT(*) as guest_count
       FROM booking_participants bp
       JOIN booking_sessions bs ON bp.session_id = bs.id
       WHERE bp.participant_type = 'guest'
         AND bs.session_date >= $1
         AND bs.session_date <= $2
         AND EXISTS (
           SELECT 1 FROM booking_participants owner_bp
           WHERE owner_bp.session_id = bs.id
             AND owner_bp.participant_type = 'owner'
             AND owner_bp.user_id = (
               SELECT id FROM users WHERE LOWER(email) = LOWER($3) LIMIT 1
             )
         )`,
      [monthStart, monthEnd, memberEmail]
    );
    
    const usedPasses = parseInt(result.rows[0]?.guest_count || '0');
    
    return Math.max(0, limits.guest_passes_per_month - usedPasses);
  } catch (error) {
    logger.error('[getGuestPassesRemaining] Error:', { error: error as Error });
    return 0;
  }
}

export async function getMemberTier(email: string): Promise<string | null> {
  return getMemberTierByEmail(email);
}

export { getTierLimits };
export type { TierLimits };
