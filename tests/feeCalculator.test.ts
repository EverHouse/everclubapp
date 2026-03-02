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

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
  toTextArrayLiteral: vi.fn(),
  toNumericArrayLiteral: vi.fn(),
}));

import {
  PRICING,
  calculateOverageCents,
  calculateOverageDollars,
  updateOverageRate,
  updateGuestFee,
  getOverageRateCents,
  getGuestFeeCents,
  getCorporateVolumeTiers,
  getCorporateBasePrice,
  getFamilyDiscountPercent,
  updateCorporateVolumePricing,
  updateFamilyDiscountPercent,
} from '../server/core/billing/pricingConfig';
import { estimateBookingFees } from '../server/core/billing/feeCalculator';

describe('PricingConfig', () => {
  beforeEach(() => {
    updateOverageRate(2500);
    updateGuestFee(2500);
  });

  describe('PRICING getters', () => {
    it('returns default overage rate in dollars', () => {
      expect(PRICING.OVERAGE_RATE_DOLLARS).toBe(25);
    });

    it('returns default overage rate in cents', () => {
      expect(PRICING.OVERAGE_RATE_CENTS).toBe(2500);
    });

    it('returns default guest fee in dollars', () => {
      expect(PRICING.GUEST_FEE_DOLLARS).toBe(25);
    });

    it('returns default guest fee in cents', () => {
      expect(PRICING.GUEST_FEE_CENTS).toBe(2500);
    });

    it('has 30-minute overage blocks', () => {
      expect(PRICING.OVERAGE_BLOCK_MINUTES).toBe(30);
    });
  });

  describe('updateOverageRate', () => {
    it('updates the overage rate', () => {
      updateOverageRate(3000);
      expect(PRICING.OVERAGE_RATE_CENTS).toBe(3000);
      expect(PRICING.OVERAGE_RATE_DOLLARS).toBe(30);
      expect(getOverageRateCents()).toBe(3000);
    });
  });

  describe('updateGuestFee', () => {
    it('updates the guest fee', () => {
      updateGuestFee(5000);
      expect(PRICING.GUEST_FEE_CENTS).toBe(5000);
      expect(PRICING.GUEST_FEE_DOLLARS).toBe(50);
      expect(getGuestFeeCents()).toBe(5000);
    });
  });

  describe('calculateOverageCents', () => {
    it('returns 0 for 0 minutes', () => {
      expect(calculateOverageCents(0)).toBe(0);
    });

    it('rounds up to one 30-min block for 1 minute', () => {
      expect(calculateOverageCents(1)).toBe(2500);
    });

    it('charges one block for exactly 30 minutes', () => {
      expect(calculateOverageCents(30)).toBe(2500);
    });

    it('rounds up to two blocks for 31 minutes', () => {
      expect(calculateOverageCents(31)).toBe(5000);
    });

    it('charges two blocks for exactly 60 minutes', () => {
      expect(calculateOverageCents(60)).toBe(5000);
    });

    it('charges three blocks for 90 minutes', () => {
      expect(calculateOverageCents(90)).toBe(7500);
    });

    it('rounds up partial blocks for 45 minutes', () => {
      expect(calculateOverageCents(45)).toBe(5000);
    });
  });

  describe('calculateOverageDollars', () => {
    it('returns 0 for 0 minutes', () => {
      expect(calculateOverageDollars(0)).toBe(0);
    });

    it('charges $25 for one block', () => {
      expect(calculateOverageDollars(30)).toBe(25);
    });

    it('charges $50 for two blocks', () => {
      expect(calculateOverageDollars(60)).toBe(50);
    });

    it('rounds up partial blocks', () => {
      expect(calculateOverageDollars(31)).toBe(50);
    });
  });

  describe('corporate volume pricing', () => {
    it('returns default volume tiers sorted by minMembers descending', () => {
      const tiers = getCorporateVolumeTiers();
      expect(tiers.length).toBe(4);
      expect(tiers[0].minMembers).toBe(50);
      expect(tiers[tiers.length - 1].minMembers).toBe(5);
    });

    it('returns default base price of $350', () => {
      expect(getCorporateBasePrice()).toBe(35000);
    });

    it('returns default family discount of 20%', () => {
      expect(getFamilyDiscountPercent()).toBe(20);
    });

    it('updates corporate volume pricing', () => {
      const newTiers = [
        { minMembers: 10, priceCents: 20000 },
        { minMembers: 30, priceCents: 15000 },
      ];
      updateCorporateVolumePricing(newTiers, 40000);
      const tiers = getCorporateVolumeTiers();
      expect(tiers[0].minMembers).toBe(30);
      expect(tiers[1].minMembers).toBe(10);
      expect(getCorporateBasePrice()).toBe(40000);
    });

    it('updates family discount percent', () => {
      updateFamilyDiscountPercent(15);
      expect(getFamilyDiscountPercent()).toBe(15);
    });
  });
});

describe('estimateBookingFees', () => {
  beforeEach(() => {
    updateOverageRate(2500);
    updateGuestFee(2500);
  });

  it('returns zero fees when within daily allowance with 1 player', () => {
    const result = estimateBookingFees('Core', 60, 1, 0, { dailySimulatorMinutes: 120 });
    expect(result.overageFee).toBe(0);
    expect(result.guestFees).toBe(0);
    expect(result.totalFee).toBe(0);
    expect(result.guestCount).toBe(0);
    expect(result.overageMinutes).toBe(0);
  });

  it('calculates overage when exceeding daily allowance', () => {
    const result = estimateBookingFees('Core', 60, 1, 100, { dailySimulatorMinutes: 120 });
    expect(result.overageMinutes).toBe(40);
    expect(result.overageFee).toBe(50);
  });

  it('splits time per person for multi-player bookings', () => {
    const result = estimateBookingFees('Core', 120, 2, 0, { dailySimulatorMinutes: 120 });
    expect(result.guestCount).toBe(1);
    expect(result.guestFees).toBe(25);
    expect(result.overageMinutes).toBe(0);
    expect(result.overageFee).toBe(0);
  });

  it('calculates both overage and guest fees', () => {
    const result = estimateBookingFees('Core', 120, 3, 30, { dailySimulatorMinutes: 60 });
    expect(result.guestCount).toBe(2);
    expect(result.guestFees).toBe(50);
    expect(result.overageMinutes).toBe(10);
    expect(result.overageFee).toBe(25);
    expect(result.totalFee).toBe(75);
  });

  it('handles conference room allowance', () => {
    const result = estimateBookingFees('Core', 60, 1, 0, { dailyConfRoomMinutes: 30 }, true);
    expect(result.overageMinutes).toBe(30);
    expect(result.overageFee).toBe(25);
  });

  it('handles zero duration', () => {
    const result = estimateBookingFees('Core', 0, 1, 0, { dailySimulatorMinutes: 60 });
    expect(result.totalFee).toBe(0);
  });

  it('handles zero or negative player count by flooring to 1', () => {
    const result = estimateBookingFees('Core', 60, 0, 0, { dailySimulatorMinutes: 120 });
    expect(result.guestCount).toBe(0);
  });

  it('handles no allowance tier', () => {
    const result = estimateBookingFees('Social', 60, 1, 0, { dailySimulatorMinutes: 0 });
    expect(result.overageMinutes).toBe(60);
    expect(result.overageFee).toBe(50);
  });
});
