// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn(), transaction: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
}));

vi.mock('../server/core/affectedAreas', () => ({
  parseAffectedAreas: vi.fn(),
}));

import { parseTimeToMinutes, hasTimeOverlap } from '../server/core/bookingValidation';

describe('parseTimeToMinutes', () => {
  it('returns 0 for null', () => {
    expect(parseTimeToMinutes(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseTimeToMinutes(undefined)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseTimeToMinutes('')).toBe(0);
  });

  it('parses midnight (00:00) as 0', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
  });

  it('parses 01:00 as 60', () => {
    expect(parseTimeToMinutes('01:00')).toBe(60);
  });

  it('parses 12:30 as 750', () => {
    expect(parseTimeToMinutes('12:30')).toBe(750);
  });

  it('parses 23:59 as 1439', () => {
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('parses 08:30 as 510', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
  });

  it('parses 22:00 as 1320', () => {
    expect(parseTimeToMinutes('22:00')).toBe(1320);
  });

  it('handles time with only hours (no colon)', () => {
    expect(parseTimeToMinutes('10')).toBe(600);
  });
});

describe('hasTimeOverlap', () => {
  it('returns true for identical time ranges', () => {
    expect(hasTimeOverlap(60, 120, 60, 120)).toBe(true);
  });

  it('returns true for partial overlap (first starts before second ends)', () => {
    expect(hasTimeOverlap(60, 120, 90, 150)).toBe(true);
  });

  it('returns true for partial overlap (second starts before first ends)', () => {
    expect(hasTimeOverlap(90, 150, 60, 120)).toBe(true);
  });

  it('returns true for full containment (first contains second)', () => {
    expect(hasTimeOverlap(60, 180, 90, 150)).toBe(true);
  });

  it('returns true for full containment (second contains first)', () => {
    expect(hasTimeOverlap(90, 150, 60, 180)).toBe(true);
  });

  it('returns false for adjacent times (no overlap)', () => {
    expect(hasTimeOverlap(60, 120, 120, 180)).toBe(false);
  });

  it('returns false for non-overlapping ranges', () => {
    expect(hasTimeOverlap(60, 120, 180, 240)).toBe(false);
  });

  it('returns false for non-overlapping ranges (reversed order)', () => {
    expect(hasTimeOverlap(180, 240, 60, 120)).toBe(false);
  });

  it('handles cross-midnight range overlapping with normal range', () => {
    // 23:00 (1380) to 01:00 (60) crosses midnight
    // 00:00 (0) to 02:00 (120) is a normal range
    expect(hasTimeOverlap(1380, 60, 0, 120)).toBe(true);
  });

  it('handles normal range overlapping with cross-midnight range', () => {
    expect(hasTimeOverlap(0, 120, 1380, 60)).toBe(true);
  });

  it('handles cross-midnight range not overlapping with daytime range', () => {
    // 23:00 to 01:00 crosses midnight, 08:00 to 10:00 is daytime
    expect(hasTimeOverlap(1380, 60, 480, 600)).toBe(false);
  });

  it('handles zero-length ranges', () => {
    expect(hasTimeOverlap(60, 60, 60, 120)).toBe(false);
  });
});
