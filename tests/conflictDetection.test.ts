// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockExecute, sqlCalls } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const sqlCalls: Array<{ strings: string[]; values: unknown[] }> = [];
  return { mockExecute, sqlCalls };
});

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: mockExecute },
}));

vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ strings: Array.from(strings), values });
      return {};
    }),
    {
      join: vi.fn((fragments: unknown[], separator: unknown) => ({})),
    }
  );
  return { sql: sqlFn };
});

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
  toTextArrayLiteral: vi.fn((arr: string[]) => `{${arr.join(',')}}`),
  toNumericArrayLiteral: vi.fn(),
}));

import { findConflictingBookings, checkMemberAvailability, timePeriodsOverlap } from '../server/core/bookingService/conflictDetection';

function mockOwnerAndParticipantResults(
  ownerRows: Record<string, unknown>[],
  participantRows: Record<string, unknown>[]
) {
  mockExecute
    .mockResolvedValueOnce({ rows: ownerRows })
    .mockResolvedValueOnce({ rows: participantRows });
}

describe('findConflictingBookings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
  });

  it('returns no conflicts when no bookings exist', async () => {
    mockOwnerAndParticipantResults([], []);

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns conflict when owner has overlapping booking', async () => {
    mockOwnerAndParticipantResults(
      [{
        booking_id: 42,
        resource_name: 'Bay 1',
        request_date: '2025-01-15',
        start_time: '10:00',
        end_time: '11:00',
        owner_name: 'Test User',
        owner_email: 'test@example.com',
      }],
      []
    );

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:30', '11:30');

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].bookingId).toBe(42);
    expect(result.conflicts[0].conflictType).toBe('owner');
    expect(result.conflicts[0].resourceName).toBe('Bay 1');
  });

  it('returns conflict when member is participant in overlapping booking', async () => {
    mockOwnerAndParticipantResults(
      [],
      [{
        booking_id: 99,
        resource_name: 'Bay 2',
        request_date: '2025-01-15',
        start_time: '14:00',
        end_time: '15:00',
        owner_name: 'Other User',
        owner_email: 'other@example.com',
        invite_status: 'accepted',
      }]
    );

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '14:30', '15:30');

    expect(result.hasConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictType).toBe('participant');
  });

  it('returns no conflict when bookings do not overlap in time', async () => {
    mockOwnerAndParticipantResults(
      [{
        booking_id: 42,
        resource_name: 'Bay 1',
        request_date: '2025-01-15',
        start_time: '08:00',
        end_time: '09:00',
        owner_name: 'Test User',
        owner_email: 'test@example.com',
      }],
      []
    );

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it('handles empty email', async () => {
    const result = await findConflictingBookings('', '2025-01-15', '10:00', '11:00');

    expect(result.hasConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    expect(mockExecute).not.toHaveBeenCalled();
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

    mockOwnerAndParticipantResults(
      [sharedBooking],
      [{ ...sharedBooking, invite_status: 'accepted' }]
    );

    const result = await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.conflicts).toHaveLength(1);
  });

  describe('midnight boundary and cross-date conflict regression', () => {
    it('should detect conflict when booking spans midnight from 23:00 to 01:00', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 100,
          resource_name: 'Bay 3',
          request_date: '2025-01-15',
          start_time: '23:00',
          end_time: '01:00',
          owner_name: 'Night Owl',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '23:30', '00:30');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].bookingId).toBe(100);
    });

    it('should detect conflict when existing booking ends at 24:00 (midnight) and new booking starts at 23:00', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 101,
          resource_name: 'Bay 1',
          request_date: '2025-01-15',
          start_time: '22:00',
          end_time: '24:00',
          owner_name: 'Late User',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '23:00', '23:30');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should detect conflict when new booking ends at 24:00 and overlaps existing late-night booking', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 102,
          resource_name: 'Bay 2',
          request_date: '2025-01-15',
          start_time: '23:00',
          end_time: '23:30',
          owner_name: 'Late User',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '22:00', '24:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });

    it('should detect cross-date conflict when prior-day booking overhangs into requested date', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 103,
          resource_name: 'Bay 4',
          request_date: '2025-01-14',
          start_time: '23:00',
          end_time: '01:00',
          owner_name: 'Prior Day',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '00:00', '01:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].bookingId).toBe(103);
    });

    it('should NOT detect conflict when prior-day cross-midnight booking ends before new booking starts', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 104,
          resource_name: 'Bay 4',
          request_date: '2025-01-14',
          start_time: '23:00',
          end_time: '00:30',
          owner_name: 'Prior Day',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '01:00', '02:00');

      expect(result.hasConflict).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect conflict when next-day booking is returned and overlaps cross-midnight window', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 105,
          resource_name: 'Bay 5',
          request_date: '2025-01-16',
          start_time: '00:00',
          end_time: '01:00',
          owner_name: 'Next Day Early',
          owner_email: 'test@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('test@example.com', '2025-01-15', '23:00', '01:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  describe('linked email conflict detection regression', () => {
    it('should detect conflict from booking under a linked email address', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 200,
          resource_name: 'Bay 1',
          request_date: '2025-01-15',
          start_time: '10:00',
          end_time: '11:00',
          owner_name: 'User Alt Email',
          owner_email: 'alt@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('primary@example.com', '2025-01-15', '10:00', '11:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].ownerEmail).toBe('alt@example.com');
      expect(result.conflicts[0].conflictType).toBe('owner');
    });

    it('should detect conflict when booking with primary email and querying with linked email', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 201,
          resource_name: 'Bay 2',
          request_date: '2025-01-15',
          start_time: '14:00',
          end_time: '15:00',
          owner_name: 'User Primary Email',
          owner_email: 'primary@example.com',
        }],
        []
      );

      const result = await findConflictingBookings('linked@example.com', '2025-01-15', '14:00', '15:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].ownerEmail).toBe('primary@example.com');
    });

    it('should detect conflict across linked emails even with case differences', async () => {
      mockOwnerAndParticipantResults(
        [{
          booking_id: 202,
          resource_name: 'Bay 3',
          request_date: '2025-01-15',
          start_time: '16:00',
          end_time: '17:00',
          owner_name: 'Mixed Case User',
          owner_email: 'User@Example.com',
        }],
        []
      );

      const result = await findConflictingBookings('USER@EXAMPLE.COM', '2025-01-15', '16:00', '17:00');

      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });
  });

  describe('SQL query construction verification', () => {
    it('should include user_linked_emails lookup in owner conflict query', async () => {
      mockOwnerAndParticipantResults([], []);

      await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

      const ownerQuerySql = sqlCalls.find(call =>
        call.strings.some(s => s.includes('user_linked_emails'))
      );
      expect(ownerQuerySql).toBeDefined();

      const linkedEmailStrings = ownerQuerySql!.strings.join('');
      expect(linkedEmailStrings).toContain('user_linked_emails');
      expect(linkedEmailStrings).toContain('linked_email');
      expect(linkedEmailStrings).toContain('primary_email');
    });

    it('should query 3-day window (requested date ± 1 day) for cross-midnight detection', async () => {
      mockOwnerAndParticipantResults([], []);

      await findConflictingBookings('test@example.com', '2025-01-15', '10:00', '11:00');

      const dateWindowQuery = sqlCalls.find(call =>
        call.strings.some(s => s.includes('INTERVAL'))
      );
      expect(dateWindowQuery).toBeDefined();

      const queryText = dateWindowQuery!.strings.join('');
      expect(queryText).toContain("1 day");
    });

    it('should normalize email to lowercase before querying', async () => {
      mockOwnerAndParticipantResults([], []);

      await findConflictingBookings('TEST@EXAMPLE.COM', '2025-01-15', '10:00', '11:00');

      const emailQuery = sqlCalls.find(call =>
        call.values.some(v => v === 'test@example.com')
      );
      expect(emailQuery).toBeDefined();
    });
  });
});

describe('checkMemberAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available when no conflicts', async () => {
    mockOwnerAndParticipantResults([], []);

    const result = await checkMemberAvailability('test@example.com', '2025-01-15', '10:00', '11:00');

    expect(result.available).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns unavailable when conflicts exist', async () => {
    mockOwnerAndParticipantResults(
      [{
        booking_id: 42,
        resource_name: 'Bay 1',
        request_date: '2025-01-15',
        start_time: '10:00',
        end_time: '11:00',
        owner_name: 'Test User',
        owner_email: 'test@example.com',
      }],
      []
    );

    const result = await checkMemberAvailability('test@example.com', '2025-01-15', '10:30', '11:30');

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });
});

describe('timePeriodsOverlap — pure function regression tests', () => {
  describe('standard overlap cases', () => {
    it('detects overlap when periods partially overlap', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '10:30', '11:30')).toBe(true);
    });

    it('detects overlap when one period fully contains the other', () => {
      expect(timePeriodsOverlap('09:00', '12:00', '10:00', '11:00')).toBe(true);
    });

    it('detects no overlap when periods are adjacent (end == start)', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '11:00', '12:00')).toBe(false);
    });

    it('detects no overlap when periods are fully separate', () => {
      expect(timePeriodsOverlap('08:00', '09:00', '14:00', '15:00')).toBe(false);
    });

    it('detects overlap for identical periods', () => {
      expect(timePeriodsOverlap('10:00', '11:00', '10:00', '11:00')).toBe(true);
    });
  });

  describe('midnight boundary regression', () => {
    it('should detect overlap for 23:00-01:00 vs 23:30-00:30', () => {
      expect(timePeriodsOverlap('23:00', '01:00', '23:30', '00:30')).toBe(true);
    });

    it('should detect overlap for 23:00-01:00 vs 00:00-00:30', () => {
      expect(timePeriodsOverlap('23:00', '01:00', '00:00', '00:30')).toBe(true);
    });

    it('should detect overlap for 22:00-24:00 vs 23:00-23:30', () => {
      expect(timePeriodsOverlap('22:00', '24:00', '23:00', '23:30')).toBe(true);
    });

    it('should detect overlap for 23:00-02:00 vs 01:00-03:00', () => {
      expect(timePeriodsOverlap('23:00', '02:00', '01:00', '03:00')).toBe(true);
    });

    it('should NOT detect overlap for 23:00-01:00 vs 01:00-02:00 (adjacent at 01:00)', () => {
      expect(timePeriodsOverlap('23:00', '01:00', '01:00', '02:00')).toBe(false);
    });

    it('should NOT detect overlap for 22:00-23:00 vs 01:00-02:00 (separate, no midnight wrap)', () => {
      expect(timePeriodsOverlap('22:00', '23:00', '01:00', '02:00')).toBe(false);
    });

    it('should detect overlap for two cross-midnight bookings 23:00-01:00 vs 22:00-00:30', () => {
      expect(timePeriodsOverlap('23:00', '01:00', '22:00', '00:30')).toBe(true);
    });

    it('should detect overlap for booking ending exactly at midnight 22:00-24:00 vs 23:30-01:00', () => {
      expect(timePeriodsOverlap('22:00', '24:00', '23:30', '01:00')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns false for invalid time strings', () => {
      expect(timePeriodsOverlap('invalid', '11:00', '10:00', '11:00')).toBe(false);
    });

    it('returns false for empty time strings', () => {
      expect(timePeriodsOverlap('', '11:00', '10:00', '11:00')).toBe(false);
    });

    it('handles time strings with seconds (HH:MM:SS)', () => {
      expect(timePeriodsOverlap('10:00:00', '11:00:00', '10:30:00', '11:30:00')).toBe(true);
    });

    it('handles single-digit hours', () => {
      expect(timePeriodsOverlap('9:00', '10:00', '9:30', '10:30')).toBe(true);
    });
  });
});
