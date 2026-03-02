// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(),
}));

vi.mock('../server/core/tierService', () => ({
  getTierLimits: vi.fn(),
  getMemberTierByEmail: vi.fn(),
  checkDailyBookingLimit: vi.fn(),
  getDailyBookedMinutes: vi.fn(),
}));

vi.mock('../server/core/memberService', () => ({
  MemberService: { findById: vi.fn() },
  isUUID: vi.fn(() => false),
  isEmail: vi.fn(() => true),
  normalizeEmail: vi.fn((e: string) => e.toLowerCase()),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn(),
  toTextArrayLiteral: vi.fn(),
  toNumericArrayLiteral: vi.fn(),
}));

import {
  computeUsageAllocation,
  calculateOverageFee,
  computeTotalSessionCost,
  formatOverageFee,
  formatOverageFeeFromDollars,
  Participant,
  UsageAllocation,
} from '../server/core/bookingService/usageCalculator';
import { updateOverageRate, updateGuestFee } from '../server/core/billing/pricingConfig';

describe('computeUsageAllocation', () => {
  beforeEach(() => {
    updateOverageRate(2500);
    updateGuestFee(2500);
  });

  it('returns empty array for no participants', () => {
    expect(computeUsageAllocation(60, [])).toEqual([]);
  });

  it('allocates all time to single participant', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
    ];
    const result = computeUsageAllocation(60, participants);
    expect(result).toHaveLength(1);
    expect(result[0].minutesAllocated).toBe(60);
    expect(result[0].participantType).toBe('owner');
  });

  it('splits time evenly among participants', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { userId: 'u2', participantType: 'member', displayName: 'Bob' },
    ];
    const result = computeUsageAllocation(60, participants);
    expect(result[0].minutesAllocated).toBe(30);
    expect(result[1].minutesAllocated).toBe(30);
  });

  it('distributes remainder to first participants by default', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { userId: 'u2', participantType: 'member', displayName: 'Bob' },
      { guestId: 1, participantType: 'guest', displayName: 'Guest 1' },
    ];
    const result = computeUsageAllocation(61, participants);
    expect(result[0].minutesAllocated).toBe(21);
    expect(result[1].minutesAllocated).toBe(20);
    expect(result[2].minutesAllocated).toBe(20);
    expect(result.reduce((s, r) => s + r.minutesAllocated, 0)).toBe(61);
  });

  it('assigns remainder to owner when assignRemainderToOwner is true', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { userId: 'u2', participantType: 'member', displayName: 'Bob' },
      { guestId: 1, participantType: 'guest', displayName: 'Guest 1' },
    ];
    const result = computeUsageAllocation(61, participants, { assignRemainderToOwner: true });
    expect(result[0].minutesAllocated).toBe(21);
    expect(result[1].minutesAllocated).toBe(20);
    expect(result[2].minutesAllocated).toBe(20);
  });

  it('uses declaredSlots when provided', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { userId: 'u2', participantType: 'member', displayName: 'Bob' },
    ];
    const result = computeUsageAllocation(120, participants, { declaredSlots: 4 });
    expect(result[0].minutesAllocated).toBe(30);
    expect(result[1].minutesAllocated).toBe(30);
  });

  it('preserves participant metadata in allocation', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { guestId: 5, participantType: 'guest', displayName: 'Guest Bob' },
    ];
    const result = computeUsageAllocation(60, participants);
    expect(result[0].userId).toBe('u1');
    expect(result[0].displayName).toBe('Alice');
    expect(result[1].guestId).toBe(5);
    expect(result[1].displayName).toBe('Guest Bob');
  });

  it('handles single participant with remainder', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
    ];
    const result = computeUsageAllocation(61, participants);
    expect(result[0].minutesAllocated).toBe(61);
  });

  it('handles zero duration', () => {
    const participants: Participant[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice' },
      { userId: 'u2', participantType: 'member', displayName: 'Bob' },
    ];
    const result = computeUsageAllocation(0, participants);
    expect(result[0].minutesAllocated).toBe(0);
    expect(result[1].minutesAllocated).toBe(0);
  });
});

describe('calculateOverageFee', () => {
  beforeEach(() => {
    updateOverageRate(2500);
  });

  it('returns no overage when usage is within allowance', () => {
    const result = calculateOverageFee(60, 120);
    expect(result.hasOverage).toBe(false);
    expect(result.overageMinutes).toBe(0);
    expect(result.overageFee).toBe(0);
  });

  it('returns no overage when usage equals allowance', () => {
    const result = calculateOverageFee(60, 60);
    expect(result.hasOverage).toBe(false);
    expect(result.overageMinutes).toBe(0);
    expect(result.overageFee).toBe(0);
  });

  it('returns no overage for unlimited tier (999+)', () => {
    const result = calculateOverageFee(500, 999);
    expect(result.hasOverage).toBe(false);
    expect(result.overageMinutes).toBe(0);
    expect(result.overageFee).toBe(0);
  });

  it('calculates overage for 30 minutes over', () => {
    const result = calculateOverageFee(90, 60);
    expect(result.hasOverage).toBe(true);
    expect(result.overageMinutes).toBe(30);
    expect(result.overageFee).toBe(25);
  });

  it('rounds up partial 30-min blocks', () => {
    const result = calculateOverageFee(61, 60);
    expect(result.hasOverage).toBe(true);
    expect(result.overageMinutes).toBe(1);
    expect(result.overageFee).toBe(25);
  });

  it('calculates multiple blocks of overage', () => {
    const result = calculateOverageFee(180, 60);
    expect(result.hasOverage).toBe(true);
    expect(result.overageMinutes).toBe(120);
    expect(result.overageFee).toBe(100);
  });

  it('handles zero allowance (Social tier)', () => {
    const result = calculateOverageFee(60, 0);
    expect(result.hasOverage).toBe(true);
    expect(result.overageMinutes).toBe(60);
    expect(result.overageFee).toBe(50);
  });

  it('handles zero minutes used', () => {
    const result = calculateOverageFee(0, 60);
    expect(result.hasOverage).toBe(false);
    expect(result.overageMinutes).toBe(0);
    expect(result.overageFee).toBe(0);
  });

  it('responds to updated overage rate', () => {
    updateOverageRate(5000);
    const result = calculateOverageFee(90, 60);
    expect(result.overageFee).toBe(50);
  });
});

describe('computeTotalSessionCost', () => {
  beforeEach(() => {
    updateOverageRate(2500);
  });

  it('returns 0 for empty allocations', () => {
    expect(computeTotalSessionCost([], new Map())).toBe(0);
  });

  it('skips guest participants', () => {
    const allocations: UsageAllocation[] = [
      { guestId: 1, participantType: 'guest', displayName: 'Guest', minutesAllocated: 60 },
    ];
    expect(computeTotalSessionCost(allocations, new Map())).toBe(0);
  });

  it('calculates overage for members exceeding allowance', () => {
    const allocations: UsageAllocation[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice', minutesAllocated: 90 },
    ];
    const tierAllowances = new Map([['u1', 60]]);
    const cost = computeTotalSessionCost(allocations, tierAllowances);
    expect(cost).toBe(25);
  });

  it('returns 0 when all members are within allowance', () => {
    const allocations: UsageAllocation[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice', minutesAllocated: 30 },
      { userId: 'u2', participantType: 'member', displayName: 'Bob', minutesAllocated: 30 },
    ];
    const tierAllowances = new Map([['u1', 60], ['u2', 60]]);
    expect(computeTotalSessionCost(allocations, tierAllowances)).toBe(0);
  });

  it('sums overage across multiple members', () => {
    const allocations: UsageAllocation[] = [
      { userId: 'u1', participantType: 'owner', displayName: 'Alice', minutesAllocated: 90 },
      { userId: 'u2', participantType: 'member', displayName: 'Bob', minutesAllocated: 90 },
    ];
    const tierAllowances = new Map([['u1', 60], ['u2', 60]]);
    const cost = computeTotalSessionCost(allocations, tierAllowances);
    expect(cost).toBe(50);
  });

  it('uses 0 allowance for unknown users', () => {
    const allocations: UsageAllocation[] = [
      { userId: 'unknown', participantType: 'member', displayName: 'Unknown', minutesAllocated: 30 },
    ];
    expect(computeTotalSessionCost(allocations, new Map())).toBe(25);
  });
});

describe('formatOverageFee', () => {
  it('formats cents to dollar string', () => {
    expect(formatOverageFee(2500)).toBe('$25.00');
  });

  it('formats zero cents', () => {
    expect(formatOverageFee(0)).toBe('$0.00');
  });

  it('formats odd cent amounts', () => {
    expect(formatOverageFee(1234)).toBe('$12.34');
  });
});

describe('formatOverageFeeFromDollars', () => {
  it('formats dollar amount to string', () => {
    expect(formatOverageFeeFromDollars(25)).toBe('$25.00');
  });

  it('formats zero dollars', () => {
    expect(formatOverageFeeFromDollars(0)).toBe('$0.00');
  });

  it('formats decimal dollar amounts', () => {
    expect(formatOverageFeeFromDollars(12.5)).toBe('$12.50');
  });
});
