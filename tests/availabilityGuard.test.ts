// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock('../server/core/affectedAreas', () => ({
  parseAffectedAreas: vi.fn(),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorCode: vi.fn(),
  getErrorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn(),
  toTextArrayLiteral: vi.fn(),
  toNumericArrayLiteral: vi.fn(),
}));

import {
  parseTimeToMinutes,
  hasTimeOverlap,
  isResourceAvailableForDate,
} from '../server/core/bookingService/availabilityGuard';
import { db } from '../server/db';
import { parseAffectedAreas } from '../server/core/affectedAreas';

describe('availabilityGuard re-exports', () => {
  describe('parseTimeToMinutes', () => {
    it('returns 0 for null', () => {
      expect(parseTimeToMinutes(null)).toBe(0);
    });

    it('returns 0 for undefined', () => {
      expect(parseTimeToMinutes(undefined)).toBe(0);
    });

    it('parses midnight as 0', () => {
      expect(parseTimeToMinutes('00:00')).toBe(0);
    });

    it('parses 01:30 as 90', () => {
      expect(parseTimeToMinutes('01:30')).toBe(90);
    });

    it('parses 12:00 as 720', () => {
      expect(parseTimeToMinutes('12:00')).toBe(720);
    });

    it('parses 23:59 as 1439', () => {
      expect(parseTimeToMinutes('23:59')).toBe(1439);
    });

    it('handles HH:MM:SS format', () => {
      expect(parseTimeToMinutes('14:30:00')).toBe(870);
    });

    it('returns 0 for empty string', () => {
      expect(parseTimeToMinutes('')).toBe(0);
    });
  });

  describe('hasTimeOverlap', () => {
    it('returns false for non-overlapping ranges', () => {
      expect(hasTimeOverlap(60, 120, 180, 240)).toBe(false);
    });

    it('returns false for adjacent ranges', () => {
      expect(hasTimeOverlap(60, 120, 120, 180)).toBe(false);
    });

    it('returns true for partial overlap', () => {
      expect(hasTimeOverlap(60, 120, 90, 150)).toBe(true);
    });

    it('returns true for full containment', () => {
      expect(hasTimeOverlap(60, 240, 90, 150)).toBe(true);
    });

    it('returns true for identical ranges', () => {
      expect(hasTimeOverlap(60, 120, 60, 120)).toBe(true);
    });

    it('handles midnight-crossing range overlapping normal range', () => {
      expect(hasTimeOverlap(1380, 60, 0, 30)).toBe(true);
    });

    it('returns false for non-overlapping with midnight-crossing range', () => {
      expect(hasTimeOverlap(1380, 60, 120, 180)).toBe(false);
    });
  });
});

describe('isResourceAvailableForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when no closures exist', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
    const result = await isResourceAvailableForDate(1, '2025-01-15');
    expect(result).toBe(true);
  });

  it('returns false when closure affects the resource', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: 10, affected_areas: 'Bay 1,Bay 2' }],
    });
    (parseAffectedAreas as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2]);

    const result = await isResourceAvailableForDate(1, '2025-01-15');
    expect(result).toBe(false);
  });

  it('returns true when closure does not affect the resource', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: 10, affected_areas: 'Bay 3,Bay 4' }],
    });
    (parseAffectedAreas as ReturnType<typeof vi.fn>).mockResolvedValue([3, 4]);

    const result = await isResourceAvailableForDate(1, '2025-01-15');
    expect(result).toBe(true);
  });

  it('returns true when closure has null affected_areas', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      rows: [{ id: 10, affected_areas: null }],
    });

    const result = await isResourceAvailableForDate(1, '2025-01-15');
    expect(result).toBe(true);
  });

  it('returns true on error (fail-open)', async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result = await isResourceAvailableForDate(1, '2025-01-15');
    expect(result).toBe(true);
  });
});
