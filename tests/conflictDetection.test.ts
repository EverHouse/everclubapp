// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockExecute } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  return { mockExecute };
});

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: mockExecute },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) => ({})),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
  toTextArrayLiteral: vi.fn((arr: string[]) => `{${arr.join(',')}}`),
  toNumericArrayLiteral: vi.fn(),
}));

import { findConflictingBookings, checkMemberAvailability } from '../server/core/bookingService/conflictDetection';

describe('findConflictingBookings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no conflicts when no bookings exist', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns conflict when owner has overlapping booking', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          booking_id: 42,
          resource_name: 'Bay 1',
          request_date: '2025-01-15',
          start_time: '10:00',
          end_time: '11:00',
          owner_name: 'Test User',
          owner_email: 'test@example.com',
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:30', '11:30');

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].bookingId).toBe(42);
    expect(result.conflicts[0].conflictType).toBe('owner');
    expect(result.conflicts[0].resourceName).toBe('Bay 1');
  });

  it('returns conflict when member is participant in overlapping booking', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          booking_id: 99,
          resource_name: 'Bay 2',
          request_date: '2025-01-15',
          start_time: '14:00',
          end_time: '15:00',
          owner_name: 'Other User',
          owner_email: 'other@example.com',
          invite_status: 'accepted',
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '14:30', '15:30');

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictType).toBe('participant');
  });

  it('returns no conflict when bookings do not overlap in time', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          booking_id: 42,
          resource_name: 'Bay 1',
          request_date: '2025-01-15',
          start_time: '08:00',
          end_time: '09:00',
          owner_name: 'Test User',
          owner_email: 'test@example.com',
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('handles member not found in users table', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('unknown@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('throws on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB connection failed'));

    await expect(
      findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00')
    ).rejects.toThrow('DB connection failed');
  });

  it('deduplicates conflicts found as both owner and participant', async () => {
    const sharedBooking = {
      booking_id: 42,
      resource_name: 'Bay 1',
      request_date: '2025-01-15',
      start_time: '10:00',
      end_time: '11:00',
      owner_name: 'Test User',
      owner_email: 'test@example.com',
    };

    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [sharedBooking] })
      .mockResolvedValueOnce({
        rows: [{ ...sharedBooking, invite_status: 'accepted' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.conflicts).toHaveLength(1);
  });
});

describe('checkMemberAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available when no conflicts', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkMemberAvailability('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.available).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns unavailable when conflicts exist', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          booking_id: 42,
          resource_name: 'Bay 1',
          request_date: '2025-01-15',
          start_time: '10:00',
          end_time: '11:00',
          owner_name: 'Test User',
          owner_email: 'test@example.com',
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkMemberAvailability('test@example.com', '2025-01-15', '10:30', '11:30');

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });
});
