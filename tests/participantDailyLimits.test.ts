// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCheckDailyBookingLimit } = vi.hoisted(() => ({
  mockCheckDailyBookingLimit: vi.fn(),
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({})),
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock('../server/core/tierService', () => ({
  checkDailyBookingLimit: mockCheckDailyBookingLimit,
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn(() => '2025-01-15'),
  formatTime12Hour: vi.fn((t: string) => t),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: Error) => e.message),
}));

vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn(),
}));

vi.mock('../server/core/bookingValidation', () => ({
  checkClosureConflict: vi.fn(),
  checkAvailabilityBlockConflict: vi.fn(),
}));

vi.mock('../server/core/bookingService/bookingCreationGuard', () => ({
  acquireBookingLocks: vi.fn(),
  checkResourceOverlap: vi.fn(),
}));

import { checkParticipantDailyLimits } from '../server/core/bookingService/createBooking';

describe('checkParticipantDailyLimits — participant-level daily hour limit enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow participants within their daily limit', async () => {
    mockCheckDailyBookingLimit.mockResolvedValue({
      allowed: true,
      remainingMinutes: 60,
    });

    await expect(checkParticipantDailyLimits(
      [{ type: 'member', email: 'participant@example.com', name: 'Test Participant' }],
      '2025-01-15',
      60,
      'simulator'
    )).resolves.not.toThrow();

    expect(mockCheckDailyBookingLimit).toHaveBeenCalledWith(
      'participant@example.com', '2025-01-15', 60, undefined, 'simulator'
    );
  });

  it('should reject participant who exceeded daily booking limit', async () => {
    mockCheckDailyBookingLimit.mockResolvedValue({
      allowed: false,
      remainingMinutes: 0,
    });

    await expect(checkParticipantDailyLimits(
      [{ type: 'member', email: 'overlimit@example.com', name: 'Over Limit' }],
      '2025-01-15',
      120,
      'simulator'
    )).rejects.toThrow('exceeded their daily booking limit');
  });

  it('should check each member participant independently', async () => {
    mockCheckDailyBookingLimit
      .mockResolvedValueOnce({ allowed: true, remainingMinutes: 120 })
      .mockResolvedValueOnce({ allowed: false, remainingMinutes: 0 });

    await expect(checkParticipantDailyLimits(
      [
        { type: 'member', email: 'ok@example.com', name: 'OK User' },
        { type: 'member', email: 'overlimit@example.com', name: 'Over Limit' },
      ],
      '2025-01-15',
      60,
      'simulator'
    )).rejects.toThrow('Over Limit');

    expect(mockCheckDailyBookingLimit).toHaveBeenCalledTimes(2);
  });

  it('should skip daily limit check for guest participants', async () => {
    await expect(checkParticipantDailyLimits(
      [{ type: 'guest', email: 'guest@example.com', name: 'Guest User' }],
      '2025-01-15',
      60,
      'simulator'
    )).resolves.not.toThrow();

    expect(mockCheckDailyBookingLimit).not.toHaveBeenCalled();
  });

  it('should skip daily limit check for member participants without email', async () => {
    await expect(checkParticipantDailyLimits(
      [{ type: 'member', email: '', name: 'No Email' }],
      '2025-01-15',
      60,
      'simulator'
    )).resolves.not.toThrow();

    expect(mockCheckDailyBookingLimit).not.toHaveBeenCalled();
  });

  it('should pass when all participants are within limits', async () => {
    mockCheckDailyBookingLimit
      .mockResolvedValueOnce({ allowed: true, remainingMinutes: 120 })
      .mockResolvedValueOnce({ allowed: true, remainingMinutes: 60 })
      .mockResolvedValueOnce({ allowed: true, remainingMinutes: 180 });

    await expect(checkParticipantDailyLimits(
      [
        { type: 'member', email: 'a@example.com', name: 'User A' },
        { type: 'member', email: 'b@example.com', name: 'User B' },
        { type: 'member', email: 'c@example.com', name: 'User C' },
      ],
      '2025-01-15',
      60,
      'simulator'
    )).resolves.not.toThrow();

    expect(mockCheckDailyBookingLimit).toHaveBeenCalledTimes(3);
  });

  it('should enforce daily limit for conference room bookings', async () => {
    mockCheckDailyBookingLimit.mockResolvedValue({
      allowed: false,
      remainingMinutes: 0,
    });

    await expect(checkParticipantDailyLimits(
      [{ type: 'member', email: 'member@example.com', name: 'Member' }],
      '2025-01-15',
      60,
      'conference_room'
    )).rejects.toThrow('exceeded their daily booking limit');

    expect(mockCheckDailyBookingLimit).toHaveBeenCalledWith(
      'member@example.com', '2025-01-15', 60, undefined, 'conference_room'
    );
  });

  it('should handle empty participants array', async () => {
    await expect(checkParticipantDailyLimits(
      [],
      '2025-01-15',
      60,
      'simulator'
    )).resolves.not.toThrow();

    expect(mockCheckDailyBookingLimit).not.toHaveBeenCalled();
  });
});
