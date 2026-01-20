import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/core/db', () => ({
  pool: {
    query: vi.fn()
  }
}));

vi.mock('../../shared/constants/tiers', () => ({
  normalizeTierName: (tier: string) => tier || 'Social',
  DEFAULT_TIER: 'Social'
}));

import { pool } from '../../server/core/db';
import { 
  getTierLimits,
  getDailyBookedMinutes,
  getDailyParticipantMinutes,
  getTotalDailyUsageMinutes,
  checkDailyBookingLimit,
  clearTierCache,
  invalidateTierCache
} from '../../server/core/tierService';

describe('checkDailyBookingLimit - Overage Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTierCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function mockTierLimits(tier: string, dailyMinutes: number, canBook: boolean = true, unlimited: boolean = false) {
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation((query: string, params?: any[]) => {
      if (query.includes('membership_tiers')) {
        return Promise.resolve({
          rows: [{
            daily_sim_minutes: dailyMinutes,
            guest_passes_per_month: 4,
            booking_window_days: 14,
            daily_conf_room_minutes: 0,
            can_book_simulators: canBook,
            can_book_conference: false,
            can_book_wellness: true,
            has_group_lessons: false,
            has_extended_sessions: false,
            has_private_lesson: false,
            has_simulator_guest_passes: false,
            has_discounted_merch: false,
            unlimited_access: unlimited
          }]
        });
      }
      if (query.includes('users') && query.includes('tier')) {
        return Promise.resolve({
          rows: [{ tier_name: tier, tier }]
        });
      }
      if (query.includes('booking_requests') && query.includes('SUM')) {
        return Promise.resolve({ rows: [{ total_minutes: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  function mockWithExistingUsage(tier: string, dailyMinutes: number, alreadyBooked: number) {
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation((query: string) => {
      if (query.includes('membership_tiers')) {
        return Promise.resolve({
          rows: [{
            daily_sim_minutes: dailyMinutes,
            guest_passes_per_month: 4,
            booking_window_days: 14,
            daily_conf_room_minutes: 0,
            can_book_simulators: true,
            can_book_conference: false,
            can_book_wellness: true,
            has_group_lessons: false,
            has_extended_sessions: false,
            has_private_lesson: false,
            has_simulator_guest_passes: false,
            has_discounted_merch: false,
            unlimited_access: false
          }]
        });
      }
      if (query.includes('users') && query.includes('tier')) {
        return Promise.resolve({
          rows: [{ tier_name: tier, tier }]
        });
      }
      if (query.includes('booking_requests') && query.includes('SUM')) {
        return Promise.resolve({ rows: [{ total_minutes: alreadyBooked }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  describe('Social tier (0 daily minutes - pay-as-you-go)', () => {
    it('should allow booking but mark all time as overage for Social tier', async () => {
      mockTierLimits('Social', 0, true);
      
      const result = await checkDailyBookingLimit('social@test.com', '2026-01-25', 60, 'Social');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(0);
      expect(result.overageMinutes).toBe(60);
    });

    it('should treat Social tier 90-min booking as full overage', async () => {
      mockTierLimits('Social', 0, true);
      
      const result = await checkDailyBookingLimit('social@test.com', '2026-01-25', 90, 'Social');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(0);
      expect(result.overageMinutes).toBe(90);
    });
  });

  describe('Core tier (60 daily minutes)', () => {
    it('should allow 60-min booking within limits', async () => {
      mockTierLimits('Core', 60, true);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 60, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(60);
      expect(result.overageMinutes).toBe(0);
    });

    it('should correctly split 90-min booking: 60 included, 30 overage', async () => {
      mockTierLimits('Core', 60, true);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 90, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(60);
      expect(result.overageMinutes).toBe(30);
    });

    it('should mark all as overage when daily limit already used', async () => {
      mockWithExistingUsage('Core', 60, 60);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 60, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(0);
      expect(result.overageMinutes).toBe(60);
      expect(result.remainingMinutes).toBe(0);
    });

    it('should correctly calculate partial overage when some daily time is remaining', async () => {
      mockWithExistingUsage('Core', 60, 30);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 60, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(30);
      expect(result.overageMinutes).toBe(30);
    });
  });

  describe('Premium tier (90 daily minutes)', () => {
    it('should allow 90-min booking fully within limits', async () => {
      mockTierLimits('Premium', 90, true);
      
      const result = await checkDailyBookingLimit('premium@test.com', '2026-01-25', 90, 'Premium');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(90);
      expect(result.overageMinutes).toBe(0);
    });

    it('should calculate overage for 120-min booking', async () => {
      mockTierLimits('Premium', 90, true);
      
      const result = await checkDailyBookingLimit('premium@test.com', '2026-01-25', 120, 'Premium');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(90);
      expect(result.overageMinutes).toBe(30);
    });
  });

  describe('VIP tier (unlimited access)', () => {
    it('should always allow booking with no overage for VIP', async () => {
      mockTierLimits('VIP', 999, true, true);
      
      const result = await checkDailyBookingLimit('vip@test.com', '2026-01-25', 180, 'VIP');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(180);
      expect(result.overageMinutes).toBe(0);
    });

    it('should allow VIP extended sessions without overage', async () => {
      mockTierLimits('VIP', 999, true, true);
      
      const result = await checkDailyBookingLimit('vip@test.com', '2026-01-25', 240, 'VIP');
      
      expect(result.allowed).toBe(true);
      expect(result.overageMinutes).toBe(0);
    });
  });

  describe('Booking at exact limit boundary', () => {
    it('should handle booking exactly at daily limit (no overage)', async () => {
      mockWithExistingUsage('Core', 60, 30);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 30, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(30);
      expect(result.overageMinutes).toBe(0);
      expect(result.remainingMinutes).toBe(0);
    });

    it('should handle 1-minute overflow correctly', async () => {
      mockWithExistingUsage('Core', 60, 59);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 30, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(1);
      expect(result.overageMinutes).toBe(29);
    });
  });

  describe('Member with guest scenario', () => {
    it('should allow booking even with no remaining minutes (overage)', async () => {
      mockWithExistingUsage('Core', 60, 60);
      
      const result = await checkDailyBookingLimit('core@test.com', '2026-01-25', 60, 'Core');
      
      expect(result.allowed).toBe(true);
      expect(result.includedMinutes).toBe(0);
      expect(result.overageMinutes).toBe(60);
    });
  });

  describe('Tier with can_book_simulators = false', () => {
    it('should reject booking when tier cannot book simulators', async () => {
      mockTierLimits('NoSimAccess', 0, false);
      
      const result = await checkDailyBookingLimit('nosim@test.com', '2026-01-25', 60, 'NoSimAccess');
      
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('simulator');
    });
  });
});

describe('getDailyParticipantMinutes - Player Count Division', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should correctly divide session minutes by player count', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation((query: string) => {
      if (query.includes('booking_members')) {
        return Promise.resolve({
          rows: [{ total_minutes: 15 }]
        });
      }
      if (query.includes('booking_participants')) {
        return Promise.resolve({
          rows: [{ total_minutes: 0 }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await getDailyParticipantMinutes('member@test.com', '2026-01-25');
    
    expect(result).toBe(15);
  });

  it('should return 0 when no participation found', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ total_minutes: 0 }]
    });

    const result = await getDailyParticipantMinutes('new@test.com', '2026-01-25');
    
    expect(result).toBe(0);
  });
});

describe('getTotalDailyUsageMinutes - Combined Usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return combined usage object with correct structure', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ total_minutes: 30 }]
    });

    const result = await getTotalDailyUsageMinutes('member@test.com', '2026-01-25');
    
    expect(result).toHaveProperty('ownerMinutes');
    expect(result).toHaveProperty('participantMinutes');
    expect(result).toHaveProperty('totalMinutes');
    expect(typeof result.totalMinutes).toBe('number');
    expect(result.totalMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe('Cache Invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTierCache();
  });

  it('should invalidate cache for specific tier', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        daily_sim_minutes: 60,
        guest_passes_per_month: 4,
        booking_window_days: 7,
        daily_conf_room_minutes: 0,
        can_book_simulators: true,
        can_book_conference: false,
        can_book_wellness: true,
        has_group_lessons: false,
        has_extended_sessions: false,
        has_private_lesson: false,
        has_simulator_guest_passes: false,
        has_discounted_merch: false,
        unlimited_access: false
      }]
    });

    const limits1 = await getTierLimits('Core');
    expect(limits1.daily_sim_minutes).toBe(60);

    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        daily_sim_minutes: 90,
        guest_passes_per_month: 8,
        booking_window_days: 14,
        daily_conf_room_minutes: 30,
        can_book_simulators: true,
        can_book_conference: true,
        can_book_wellness: true,
        has_group_lessons: true,
        has_extended_sessions: true,
        has_private_lesson: false,
        has_simulator_guest_passes: true,
        has_discounted_merch: false,
        unlimited_access: false
      }]
    });

    invalidateTierCache('Core');

    const limits2 = await getTierLimits('Core');
    expect(limits2.daily_sim_minutes).toBe(90);
  });

  it('should allow clearing all caches without errors', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{
        daily_sim_minutes: 60,
        guest_passes_per_month: 4,
        booking_window_days: 7,
        daily_conf_room_minutes: 0,
        can_book_simulators: true,
        can_book_conference: false,
        can_book_wellness: true,
        has_group_lessons: false,
        has_extended_sessions: false,
        has_private_lesson: false,
        has_simulator_guest_passes: false,
        has_discounted_merch: false,
        unlimited_access: false
      }]
    });

    await getTierLimits('Core');
    await getTierLimits('Premium');

    expect(() => clearTierCache()).not.toThrow();

    await getTierLimits('Core');
    
    expect(pool.query).toHaveBeenCalled();
  });
});
