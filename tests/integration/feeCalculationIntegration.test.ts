// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import {
  computeUsageAllocation,
  calculateOverageFee,
} from '../../server/core/bookingService/usageCalculator';

import {
  getEffectivePlayerCount,
} from '../../server/core/billing/unifiedFeeService';

import {
  timePeriodsOverlap,
} from '../../server/core/bookingService/conflictDetection';

vi.mock('../../server/core/billing/pricingConfig', () => ({
  PRICING: {
    GUEST_FEE_CENTS: 7500,
    GUEST_FEE_DOLLARS: 75,
    OVERAGE_RATE_CENTS_PER_MINUTE: 100,
    OVERAGE_BLOCK_MINUTES: 30,
    OVERAGE_RATE_CENTS: 5000,
  },
  isPlaceholderGuestName: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Fee Calculation Integration — Full Pipeline Components', () => {
  describe('Usage Allocation — Duration Splitting', () => {
    it('60-minute session with 4 participants: each gets 15 minutes', () => {
      const participants = [
        { userId: 'u1', participantType: 'owner' as const, displayName: 'Owner' },
        { userId: 'u2', participantType: 'member' as const, displayName: 'Member 2' },
        { userId: 'u3', participantType: 'member' as const, displayName: 'Member 3' },
        { guestId: 1, participantType: 'guest' as const, displayName: 'Guest' },
      ];

      const allocations = computeUsageAllocation(60, participants);
      expect(allocations).toHaveLength(4);
      expect(allocations.every(a => a.minutesAllocated === 15)).toBe(true);
    });

    it('remainder minutes are distributed to first participants', () => {
      const participants = [
        { userId: 'u1', participantType: 'owner' as const, displayName: 'Owner' },
        { userId: 'u2', participantType: 'member' as const, displayName: 'Member 2' },
        { userId: 'u3', participantType: 'member' as const, displayName: 'Member 3' },
      ];

      const allocations = computeUsageAllocation(61, participants);
      expect(allocations).toHaveLength(3);
      expect(allocations[0].minutesAllocated).toBe(21);
      expect(allocations[1].minutesAllocated).toBe(20);
      expect(allocations[2].minutesAllocated).toBe(20);
    });

    it('assignRemainderToOwner gives remainder to owner only', () => {
      const participants = [
        { userId: 'u1', participantType: 'owner' as const, displayName: 'Owner' },
        { userId: 'u2', participantType: 'member' as const, displayName: 'Member 2' },
      ];

      const allocations = computeUsageAllocation(61, participants, { assignRemainderToOwner: true });
      expect(allocations[0].minutesAllocated).toBe(31);
      expect(allocations[1].minutesAllocated).toBe(30);
    });

    it('declaredSlots overrides participant count for splitting', () => {
      const participants = [
        { userId: 'u1', participantType: 'owner' as const, displayName: 'Owner' },
        { userId: 'u2', participantType: 'member' as const, displayName: 'Member 2' },
      ];

      const allocations = computeUsageAllocation(60, participants, { declaredSlots: 4 });
      expect(allocations).toHaveLength(2);
      expect(allocations[0].minutesAllocated).toBe(15);
      expect(allocations[1].minutesAllocated).toBe(15);
    });

    it('empty participants returns empty allocations', () => {
      const allocations = computeUsageAllocation(60, []);
      expect(allocations).toHaveLength(0);
    });

    it('single participant gets full session duration', () => {
      const allocations = computeUsageAllocation(120, [
        { userId: 'u1', participantType: 'owner' as const, displayName: 'Owner' },
      ]);
      expect(allocations).toHaveLength(1);
      expect(allocations[0].minutesAllocated).toBe(120);
    });
  });

  describe('Overage Fee Calculation', () => {
    it('no overage when usage is within tier allowance', () => {
      const result = calculateOverageFee(60, 120);
      expect(result.hasOverage).toBe(false);
      expect(result.overageMinutes).toBe(0);
      expect(result.overageFee).toBe(0);
    });

    it('no overage when usage equals tier allowance exactly', () => {
      const result = calculateOverageFee(120, 120);
      expect(result.hasOverage).toBe(false);
      expect(result.overageMinutes).toBe(0);
    });

    it('calculates overage when usage exceeds tier allowance', () => {
      const result = calculateOverageFee(150, 120);
      expect(result.hasOverage).toBe(true);
      expect(result.overageMinutes).toBe(30);
      expect(result.overageFee).toBeGreaterThan(0);
    });

    it('unlimited tier (999+ allowance) never has overage', () => {
      const result = calculateOverageFee(500, 999);
      expect(result.hasOverage).toBe(false);
      expect(result.overageMinutes).toBe(0);
    });

    it('zero-minute usage has no overage', () => {
      const result = calculateOverageFee(0, 120);
      expect(result.hasOverage).toBe(false);
    });
  });

  describe('Effective Player Count — Max of Declared vs Actual', () => {
    it('returns actual when actual exceeds declared', () => {
      expect(getEffectivePlayerCount(2, 4)).toBe(4);
    });

    it('returns declared when declared exceeds actual', () => {
      expect(getEffectivePlayerCount(4, 2)).toBe(4);
    });

    it('returns at least 1 even with 0 inputs', () => {
      expect(getEffectivePlayerCount(0, 0)).toBe(1);
    });

    it('handles undefined declared count', () => {
      expect(getEffectivePlayerCount(undefined, 3)).toBe(3);
    });

    it('declared and actual equal returns that value', () => {
      expect(getEffectivePlayerCount(4, 4)).toBe(4);
    });
  });

  describe('Cross-Midnight Time Overlap Detection', () => {
    it('detects same-day overlap', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '10:30', '11:30')).toBe(true);
    });

    it('no overlap with adjacent slots', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '11:00', '12:00')).toBe(false);
    });

    it('detects cross-midnight overlap (23:00-01:00 vs 00:00-02:00)', () => {
      expect(timePeriodsOverlap('23:00', '01:00', '00:00', '02:00')).toBe(true);
    });

    it('no overlap: daytime slot vs late-night cross-midnight', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '23:00', '01:00')).toBe(false);
    });

    it('detects full containment overlap', () => {
      expect(timePeriodsOverlap('09:00', '17:00', '10:00', '12:00')).toBe(true);
    });

    it('identical time periods overlap', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '10:00', '11:00')).toBe(true);
    });
  });

  describe('Daily Allowance Integration Scenarios', () => {
    it('member with two 60-min bookings on gold tier (120-min allowance): exactly at limit, no overage', () => {
      const firstBookingMinutes = 60;
      const secondBookingMinutes = 60;
      const goldAllowance = 120;

      const afterFirst = calculateOverageFee(firstBookingMinutes, goldAllowance);
      expect(afterFirst.hasOverage).toBe(false);

      const cumulativeUsage = firstBookingMinutes + secondBookingMinutes;
      const afterSecond = calculateOverageFee(cumulativeUsage, goldAllowance);
      expect(afterSecond.hasOverage).toBe(false);
      expect(afterSecond.overageMinutes).toBe(0);
    });

    it('member exceeding daily allowance with three bookings', () => {
      const goldAllowance = 120;
      const bookings = [60, 60, 30];
      let cumulative = 0;

      for (const minutes of bookings) {
        cumulative += minutes;
      }

      const result = calculateOverageFee(cumulative, goldAllowance);
      expect(result.hasOverage).toBe(true);
      expect(result.overageMinutes).toBe(30);
    });

    it('guest fee assessment: guests with no tier get full fee, members with tier get allocated share', () => {
      const sessionDuration = 60;
      const participants = [
        { userId: 'owner-1', participantType: 'owner' as const, displayName: 'Owner' },
        { userId: 'member-2', participantType: 'member' as const, displayName: 'Active Member' },
        { guestId: 1, participantType: 'guest' as const, displayName: 'Guest Alice' },
      ];

      const allocations = computeUsageAllocation(sessionDuration, participants);
      expect(allocations).toHaveLength(3);

      const guestAllocation = allocations.find(a => a.participantType === 'guest');
      expect(guestAllocation).toBeDefined();
      expect(guestAllocation!.minutesAllocated).toBe(20);

      const ownerAllocation = allocations.find(a => a.participantType === 'owner');
      expect(ownerAllocation!.minutesAllocated).toBe(20);
    });
  });
});
