import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
  getPacificDateParts: vi.fn().mockReturnValue({ hour: 12, minute: 0 }),
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  isPlaceholderEmail,
  normalizeStatus,
  timeToMinutes,
  isTimeWithinTolerance,
  PLACEHOLDER_EMAILS,
  VALID_MEMBER_STATUSES,
} from '../server/core/trackman/constants';

describe('Trackman Constants', () => {
  describe('isPlaceholderEmail', () => {
    it('recognizes known placeholder emails', () => {
      for (const email of PLACEHOLDER_EMAILS) {
        expect(isPlaceholderEmail(email)).toBe(true);
      }
    });

    it('recognizes trackman.local emails', () => {
      expect(isPlaceholderEmail('user@trackman.local')).toBe(true);
    });

    it('recognizes unmatched- prefix emails', () => {
      expect(isPlaceholderEmail('unmatched-12345@anything.com')).toBe(true);
    });

    it('recognizes short alphabetic @evenhouse.club emails as placeholder', () => {
      expect(isPlaceholderEmail('info@evenhouse.club')).toBe(true);
      expect(isPlaceholderEmail('admin@evenhouse.club')).toBe(true);
    });

    it('does not flag normal member emails', () => {
      expect(isPlaceholderEmail('john.doe@gmail.com')).toBe(false);
      expect(isPlaceholderEmail('member@company.com')).toBe(false);
    });

    it('handles case insensitivity', () => {
      expect(isPlaceholderEmail('BOOKING@EVENHOUSE.CLUB')).toBe(true);
    });

    it('trims whitespace', () => {
      expect(isPlaceholderEmail('  booking@evenhouse.club  ')).toBe(true);
    });
  });

  describe('normalizeStatus', () => {
    it('maps Attended to attended for past bookings', () => {
      expect(normalizeStatus('Attended', '2020-01-01', '10:00')).toBe('attended');
    });

    it('maps Confirmed to approved for future bookings', () => {
      expect(normalizeStatus('Confirmed', '2099-12-31', '10:00')).toBe('approved');
    });

    it('maps cancelled to cancelled', () => {
      expect(normalizeStatus('cancelled', '2026-03-15', '10:00')).toBe('cancelled');
    });

    it('maps canceled (US spelling) to cancelled', () => {
      expect(normalizeStatus('canceled', '2026-03-15', '10:00')).toBe('cancelled');
    });

    it('returns null for unknown status', () => {
      expect(normalizeStatus('unknown_status', '2026-03-15', '10:00')).toBeNull();
    });

    it('maps no_show to attended for past bookings', () => {
      expect(normalizeStatus('no_show', '2020-01-01', '10:00')).toBe('attended');
    });

    it('maps noshow to approved for future bookings', () => {
      expect(normalizeStatus('noshow', '2099-12-31', '10:00')).toBe('approved');
    });

    it('handles case insensitivity', () => {
      expect(normalizeStatus('ATTENDED', '2020-01-01', '10:00')).toBe('attended');
    });
  });

  describe('timeToMinutes', () => {
    it('converts 10:30 to 630 minutes', () => {
      expect(timeToMinutes('10:30')).toBe(630);
    });

    it('converts 0:00 to 0', () => {
      expect(timeToMinutes('0:00')).toBe(0);
    });

    it('converts 23:59 to 1439', () => {
      expect(timeToMinutes('23:59')).toBe(1439);
    });
  });

  describe('isTimeWithinTolerance', () => {
    it('returns true for same time', () => {
      expect(isTimeWithinTolerance('10:00', '10:00')).toBe(true);
    });

    it('returns true within 5-minute default tolerance', () => {
      expect(isTimeWithinTolerance('10:00', '10:04')).toBe(true);
    });

    it('returns false outside default tolerance', () => {
      expect(isTimeWithinTolerance('10:00', '10:06')).toBe(false);
    });

    it('respects custom tolerance', () => {
      expect(isTimeWithinTolerance('10:00', '10:10', 10)).toBe(true);
      expect(isTimeWithinTolerance('10:00', '10:11', 10)).toBe(false);
    });
  });

  describe('VALID_MEMBER_STATUSES', () => {
    it('includes active, expired, terminated, former_member, inactive', () => {
      expect(VALID_MEMBER_STATUSES).toContain('active');
      expect(VALID_MEMBER_STATUSES).toContain('expired');
      expect(VALID_MEMBER_STATUSES).toContain('terminated');
      expect(VALID_MEMBER_STATUSES).toContain('former_member');
      expect(VALID_MEMBER_STATUSES).toContain('inactive');
    });
  });
});
