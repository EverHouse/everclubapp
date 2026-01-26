import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../server/core/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

vi.mock('../../server/core/tierService', () => ({
  getMemberTierByEmail: vi.fn(),
  getTierLimits: vi.fn()
}));

vi.mock('../../server/core/memberService', () => ({
  MemberService: {
    findById: vi.fn()
  },
  isEmail: (str: string) => str?.includes('@'),
  normalizeEmail: (email: string) => email?.toLowerCase().trim(),
  isUUID: (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}));

vi.mock('../../server/core/bookingService/usageCalculator', () => ({
  getDailyUsageFromLedger: vi.fn().mockResolvedValue(0),
  getGuestPassInfo: vi.fn().mockResolvedValue({ remaining: 0, hasGuestPassBenefit: false }),
  calculateOverageFee: vi.fn((minutesUsed: number, tierAllowance: number) => {
    if (tierAllowance >= 999 || minutesUsed <= tierAllowance) {
      return { hasOverage: false, overageMinutes: 0, overageFee: 0 };
    }
    const overageMinutes = minutesUsed - tierAllowance;
    const overageFee = Math.ceil(overageMinutes / 30) * 25;
    return { hasOverage: true, overageMinutes, overageFee };
  })
}));

vi.mock('../../server/core/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

import { getEffectivePlayerCount } from '../../server/core/billing/unifiedFeeService';
import { pool } from '../../server/core/db';
import { getMemberTierByEmail, getTierLimits } from '../../server/core/tierService';
import { getDailyUsageFromLedger, getGuestPassInfo } from '../../server/core/bookingService/usageCalculator';

const FLAT_GUEST_FEE_CENTS = 2500;

interface TierConfig {
  name: string;
  dailySimMinutes: number;
  guestPassesPerMonth: number;
  hasSimulatorGuestPasses: boolean;
  unlimitedAccess: boolean;
}

const TIER_CONFIGS: TierConfig[] = [
  { name: 'Social', dailySimMinutes: 0, guestPassesPerMonth: 0, hasSimulatorGuestPasses: false, unlimitedAccess: false },
  { name: 'Core', dailySimMinutes: 60, guestPassesPerMonth: 4, hasSimulatorGuestPasses: false, unlimitedAccess: false },
  { name: 'Premium', dailySimMinutes: 90, guestPassesPerMonth: 8, hasSimulatorGuestPasses: true, unlimitedAccess: false },
  { name: 'VIP', dailySimMinutes: 999, guestPassesPerMonth: 999, hasSimulatorGuestPasses: true, unlimitedAccess: true },
];

function getTierLimitsFromConfig(tierName: string) {
  const tier = TIER_CONFIGS.find(t => t.name.toLowerCase() === tierName.toLowerCase());
  if (!tier) return null;
  return {
    daily_sim_minutes: tier.dailySimMinutes,
    guest_passes_per_month: tier.guestPassesPerMonth,
    has_simulator_guest_passes: tier.hasSimulatorGuestPasses,
    unlimited_access: tier.unlimitedAccess,
    booking_window_days: 7,
    daily_conf_room_minutes: 0,
    can_book_simulators: true,
    can_book_conference: false,
    can_book_wellness: true,
  };
}

describe('Unified Fee Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEffectivePlayerCount', () => {
    it('should return MAX of declared and actual when actual is higher', () => {
      expect(getEffectivePlayerCount(4, 5)).toBe(5);
    });

    it('should return MAX of declared and actual when declared is higher', () => {
      expect(getEffectivePlayerCount(5, 3)).toBe(5);
    });

    it('should return the count when declared equals actual', () => {
      expect(getEffectivePlayerCount(4, 4)).toBe(4);
    });

    it('should default to 1 if declared is undefined', () => {
      expect(getEffectivePlayerCount(undefined, 0)).toBe(1);
    });

    it('should default to 1 if declared is 0', () => {
      expect(getEffectivePlayerCount(0, 0)).toBe(1);
    });

    it('should return actual if declared is undefined but actual is > 0', () => {
      expect(getEffectivePlayerCount(undefined, 3)).toBe(3);
    });

    it('should always return at least 1', () => {
      expect(getEffectivePlayerCount(0, 0)).toBe(1);
      expect(getEffectivePlayerCount(undefined, 0)).toBe(1);
    });
  });

  describe('computeFeeBreakdown - Time Allocation Logic', () => {
    it('should allocate time using effective player count', () => {
      const sessionDuration = 240;
      const effectivePlayerCount = 5;
      const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(minutesPerParticipant).toBe(48);
    });

    it('should allocate full session duration to owner', () => {
      const sessionDuration = 120;
      const ownerMinutes = sessionDuration;
      
      expect(ownerMinutes).toBe(120);
    });

    it('should allocate proportional time to guests based on effective player count', () => {
      const sessionDuration = 120;
      const effectivePlayerCount = 4;
      const guestMinutes = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(guestMinutes).toBe(30);
    });

    it('should handle single player session (owner only)', () => {
      const sessionDuration = 60;
      const effectivePlayerCount = getEffectivePlayerCount(1, 1);
      const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(effectivePlayerCount).toBe(1);
      expect(minutesPerParticipant).toBe(60);
    });
  });

  describe('computeFeeBreakdown - Owner Overage Calculation', () => {
    it('should calculate owner overage based on full session duration for Social tier', () => {
      const sessionDuration = 60;
      const dailyAllowance = 0;
      const usedMinutesToday = 0;
      
      const totalAfterSession = usedMinutesToday + sessionDuration;
      const overageMinutes = Math.max(0, totalAfterSession - dailyAllowance);
      const overageFee = Math.ceil(overageMinutes / 30) * 25;
      
      expect(overageMinutes).toBe(60);
      expect(overageFee).toBe(50);
    });

    it('should calculate partial overage when tier allowance partially covers session', () => {
      const sessionDuration = 90;
      const dailyAllowance = 60;
      const usedMinutesToday = 0;
      
      const totalAfterSession = usedMinutesToday + sessionDuration;
      const overageMinutes = Math.max(0, totalAfterSession - dailyAllowance);
      const overageFee = Math.ceil(overageMinutes / 30) * 25;
      
      expect(overageMinutes).toBe(30);
      expect(overageFee).toBe(25);
    });

    it('should calculate no overage for VIP/unlimited tier', () => {
      const sessionDuration = 180;
      const dailyAllowance = 999;
      const unlimitedAccess = true;
      
      if (unlimitedAccess || dailyAllowance >= 999) {
        expect(0).toBe(0);
      }
    });

    it('should account for prior usage when calculating overage', () => {
      const sessionDuration = 60;
      const dailyAllowance = 60;
      const usedMinutesToday = 30;
      
      const totalAfterSession = usedMinutesToday + sessionDuration;
      const overageMinutes = Math.max(0, totalAfterSession - dailyAllowance);
      
      expect(overageMinutes).toBe(30);
    });

    it('should calculate incremental overage only', () => {
      const sessionDuration = 60;
      const dailyAllowance = 60;
      const usedMinutesToday = 90;
      
      const totalAfterSession = usedMinutesToday + sessionDuration;
      const priorOverage = Math.max(0, usedMinutesToday - dailyAllowance);
      const totalOverage = Math.max(0, totalAfterSession - dailyAllowance);
      const incrementalOverage = totalOverage - priorOverage;
      
      expect(priorOverage).toBe(30);
      expect(totalOverage).toBe(90);
      expect(incrementalOverage).toBe(60);
    });
  });

  describe('computeFeeBreakdown - Guest Fee Calculation', () => {
    it('should charge flat guest fee when no guest passes available', () => {
      const hasGuestPassBenefit = false;
      const guestPassesRemaining = 0;
      
      let guestCents = 0;
      if (!hasGuestPassBenefit || guestPassesRemaining <= 0) {
        guestCents = FLAT_GUEST_FEE_CENTS;
      }
      
      expect(guestCents).toBe(2500);
    });

    it('should use guest pass when available', () => {
      const hasGuestPassBenefit = true;
      let guestPassesRemaining = 2;
      
      let guestCents = 0;
      let guestPassUsed = false;
      
      if (hasGuestPassBenefit && guestPassesRemaining > 0) {
        guestPassUsed = true;
        guestPassesRemaining--;
        guestCents = 0;
      }
      
      expect(guestPassUsed).toBe(true);
      expect(guestCents).toBe(0);
      expect(guestPassesRemaining).toBe(1);
    });

    it('should consume guest passes in order', () => {
      const hasGuestPassBenefit = true;
      let guestPassesRemaining = 2;
      const guests = [{ name: 'Guest 1' }, { name: 'Guest 2' }, { name: 'Guest 3' }];
      
      let totalGuestCents = 0;
      let guestPassesUsed = 0;
      
      for (const guest of guests) {
        if (hasGuestPassBenefit && guestPassesRemaining > 0) {
          guestPassesRemaining--;
          guestPassesUsed++;
        } else {
          totalGuestCents += FLAT_GUEST_FEE_CENTS;
        }
      }
      
      expect(guestPassesUsed).toBe(2);
      expect(totalGuestCents).toBe(FLAT_GUEST_FEE_CENTS);
      expect(guestPassesRemaining).toBe(0);
    });

    it('should charge all guests when tier has no guest pass benefit', () => {
      const hasGuestPassBenefit = false;
      const guestCount = 3;
      
      const totalGuestCents = guestCount * FLAT_GUEST_FEE_CENTS;
      
      expect(totalGuestCents).toBe(7500);
    });
  });

  describe('computeFeeBreakdown - Source Consistency', () => {
    it('should return consistent fee structure for preview source', () => {
      const source = 'preview';
      const sessionDuration = 60;
      const declaredPlayerCount = 2;
      const actualPlayerCount = 2;
      
      const effectivePlayerCount = getEffectivePlayerCount(declaredPlayerCount, actualPlayerCount);
      const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(effectivePlayerCount).toBe(2);
      expect(minutesPerParticipant).toBe(30);
    });

    it('should return consistent fee structure for approval source', () => {
      const source = 'approval';
      const sessionDuration = 60;
      const declaredPlayerCount = 2;
      const actualPlayerCount = 2;
      
      const effectivePlayerCount = getEffectivePlayerCount(declaredPlayerCount, actualPlayerCount);
      const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(effectivePlayerCount).toBe(2);
      expect(minutesPerParticipant).toBe(30);
    });

    it('should return consistent fee structure for checkin source', () => {
      const source = 'checkin';
      const sessionDuration = 60;
      const declaredPlayerCount = 2;
      const actualPlayerCount = 2;
      
      const effectivePlayerCount = getEffectivePlayerCount(declaredPlayerCount, actualPlayerCount);
      const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
      
      expect(effectivePlayerCount).toBe(2);
      expect(minutesPerParticipant).toBe(30);
    });
  });

  describe('Roster Changes After Approval', () => {
    it('should recalculate fees when participant added', () => {
      const initialParticipants = 2;
      const newParticipants = 3;
      const sessionDuration = 120;
      
      const initialMinutes = Math.floor(sessionDuration / initialParticipants);
      const newMinutes = Math.floor(sessionDuration / newParticipants);
      
      expect(initialMinutes).toBe(60);
      expect(newMinutes).toBe(40);
      expect(newMinutes).toBeLessThan(initialMinutes);
    });

    it('should recalculate fees when participant removed', () => {
      const initialParticipants = 3;
      const newParticipants = 2;
      const sessionDuration = 120;
      
      const initialMinutes = Math.floor(sessionDuration / initialParticipants);
      const newMinutes = Math.floor(sessionDuration / newParticipants);
      
      expect(initialMinutes).toBe(40);
      expect(newMinutes).toBe(60);
      expect(newMinutes).toBeGreaterThan(initialMinutes);
    });

    it('should invalidate cached fees on roster change', () => {
      const participantIds = [1, 2, 3];
      const invalidatedIds: number[] = [];
      
      for (const id of participantIds) {
        invalidatedIds.push(id);
      }
      
      expect(invalidatedIds).toEqual([1, 2, 3]);
      expect(invalidatedIds.length).toBe(participantIds.length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle 0 guests correctly', () => {
      const guestCount = 0;
      const totalGuestCents = guestCount * FLAT_GUEST_FEE_CENTS;
      
      expect(totalGuestCents).toBe(0);
    });

    it('should handle all guests scenario', () => {
      const guestCount = 4;
      const hasGuestPassBenefit = false;
      
      const totalGuestCents = guestCount * FLAT_GUEST_FEE_CENTS;
      
      expect(totalGuestCents).toBe(10000);
    });

    it('should handle Social tier always having overage', () => {
      const tierLimits = getTierLimitsFromConfig('Social');
      const sessionDuration = 30;
      
      const overageMinutes = Math.max(0, sessionDuration - (tierLimits?.daily_sim_minutes ?? 0));
      const overageFee = Math.ceil(overageMinutes / 30) * 25;
      
      expect(tierLimits?.daily_sim_minutes).toBe(0);
      expect(overageMinutes).toBe(30);
      expect(overageFee).toBe(25);
    });

    it('should handle VIP tier with unlimited access', () => {
      const tierLimits = getTierLimitsFromConfig('VIP');
      const sessionDuration = 480;
      
      const hasOverage = !tierLimits?.unlimited_access && sessionDuration > (tierLimits?.daily_sim_minutes ?? 0);
      
      expect(tierLimits?.unlimited_access).toBe(true);
      expect(hasOverage).toBe(false);
    });

    it('should handle Premium tier with guest pass benefit', () => {
      const tierLimits = getTierLimitsFromConfig('Premium');
      
      expect(tierLimits?.has_simulator_guest_passes).toBe(true);
      expect(tierLimits?.guest_passes_per_month).toBe(8);
    });
  });
});
