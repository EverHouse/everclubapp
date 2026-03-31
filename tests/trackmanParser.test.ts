import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
  getPacificDateParts: vi.fn().mockReturnValue({ hour: 12, minute: 0 }),
}));

import {
  parseNotesForPlayers,
  parseCSVLine,
  parseCSVWithMultilineSupport,
  extractTime,
  extractDate,
} from '../server/core/trackman/parser';

describe('Trackman Parser', () => {
  describe('parseNotesForPlayers', () => {
    it('returns empty array for empty notes', () => {
      expect(parseNotesForPlayers('')).toEqual([]);
    });

    it('parses pipe-separated format (M|email|first|last)', () => {
      const players = parseNotesForPlayers('M|john@test.com|John|Doe');
      expect(players).toEqual([
        { type: 'member', email: 'john@test.com', name: 'John Doe' },
      ]);
    });

    it('parses guest pipe-separated format', () => {
      const players = parseNotesForPlayers('G|guest@test.com|Jane|Smith');
      expect(players).toEqual([
        { type: 'guest', email: 'guest@test.com', name: 'Jane Smith' },
      ]);
    });

    it('parses M:email|Name format', () => {
      const players = parseNotesForPlayers('M:john@test.com | John Doe');
      expect(players).toEqual([
        { type: 'member', email: 'john@test.com', name: 'John Doe' },
      ]);
    });

    it('parses G:Name format (guest without email)', () => {
      const players = parseNotesForPlayers('G: Jane Smith');
      expect(players).toEqual([
        { type: 'guest', email: null, name: 'Jane Smith' },
      ]);
    });

    it('parses G:email|Name format', () => {
      const players = parseNotesForPlayers('G:guest@test.com | Jane Smith');
      expect(players).toEqual([
        { type: 'guest', email: 'guest@test.com', name: 'Jane Smith' },
      ]);
    });

    it('handles multiple players across lines', () => {
      const notes = 'M:member@test.com | Member One\nG: Guest Two\nG: Guest Three';
      const players = parseNotesForPlayers(notes);
      expect(players.length).toBe(3);
      expect(players[0].type).toBe('member');
      expect(players[1].type).toBe('guest');
      expect(players[2].type).toBe('guest');
    });

    it('treats "none" email as null', () => {
      const players = parseNotesForPlayers('M|none|John|Doe');
      expect(players[0].email).toBeNull();
    });

    it('strips "Guests pay separately" suffix from member name', () => {
      const players = parseNotesForPlayers('M:john@test.com | John Doe Guests pay separately');
      expect(players[0].name).toBe('John Doe');
    });

    it('parses inline G: tags within M: line', () => {
      const players = parseNotesForPlayers('M:john@test.com | John Doe G:Jane G:Bob');
      expect(players.length).toBe(3);
      const member = players.find(p => p.type === 'member');
      const guests = players.filter(p => p.type === 'guest');
      expect(member).toEqual({ type: 'member', email: 'john@test.com', name: 'John Doe' });
      expect(guests.length).toBe(2);
      expect(guests.map(g => g.name)).toContain('Jane');
      expect(guests.map(g => g.name)).toContain('Bob');
    });

    it('handles G:none|GuestName format', () => {
      const players = parseNotesForPlayers('G:none | Jane');
      expect(players[0]).toEqual({ type: 'guest', email: null, name: 'Jane' });
    });
  });

  describe('parseCSVLine', () => {
    it('parses simple comma-separated values', () => {
      expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('handles quoted fields containing commas', () => {
      expect(parseCSVLine('"hello, world",b,c')).toEqual(['hello, world', 'b', 'c']);
    });

    it('handles escaped double quotes', () => {
      expect(parseCSVLine('"she said ""hello""",b')).toEqual(['she said "hello"', 'b']);
    });

    it('trims whitespace from fields', () => {
      expect(parseCSVLine(' a , b , c ')).toEqual(['a', 'b', 'c']);
    });

    it('handles empty fields', () => {
      expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
    });
  });

  describe('parseCSVWithMultilineSupport', () => {
    it('parses simple CSV content', () => {
      const result = parseCSVWithMultilineSupport('a,b\nc,d');
      expect(result).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('handles quoted fields with newlines', () => {
      const result = parseCSVWithMultilineSupport('a,"b\nb2"\nc,d');
      expect(result).toEqual([['a', 'b\nb2'], ['c', 'd']]);
    });

    it('skips empty rows', () => {
      const result = parseCSVWithMultilineSupport('a,b\n\nc,d');
      expect(result).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('handles Windows-style CRLF line endings', () => {
      const result = parseCSVWithMultilineSupport('a,b\r\nc,d');
      expect(result).toEqual([['a', 'b'], ['c', 'd']]);
    });
  });

  describe('extractTime', () => {
    it('extracts time from datetime string', () => {
      expect(extractTime('2026-03-15 14:30')).toBe('14:30:00');
    });

    it('returns 00:00 for empty string', () => {
      expect(extractTime('')).toBe('00:00');
    });

    it('returns 00:00:00 for date-only string', () => {
      expect(extractTime('2026-03-15')).toBe('00:00:00');
    });
  });

  describe('extractDate', () => {
    it('extracts date from datetime string', () => {
      expect(extractDate('2026-03-15 14:30')).toBe('2026-03-15');
    });

    it('returns today for empty string', () => {
      const result = extractDate('');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('representative Trackman CSV format', () => {
    it('parses a full production-format CSV row with all 21 columns', () => {
      const headerRow = 'Booking Id,Confirmation Number,Account Id,Account Name,Facility Name,Name,Email,Booked Date,Start Date,End Date,Duration (minutes),Status,Total Price,Currency,Player Count,Subtotal,Notes,Coupon,Discount,Tax,Bay';
      const dataRow = '12345,CONF-001,ACC-100,Ever Golf Club,Main Facility,John Doe,john@example.com,2026-03-15 09:00,2026-03-20 10:00,2026-03-20 11:00,60,Attended,150.00,USD,2,150.00,"M:john@example.com | John Doe\nG: Jane Guest",SPRING10,10.00,0.00,Bay 3';
      const rows = parseCSVWithMultilineSupport(headerRow + '\n' + dataRow);
      expect(rows.length).toBe(2);
      const headers = rows[0];
      expect(headers[0]).toBe('Booking Id');
      expect(headers[20]).toBe('Bay');
      const fields = rows[1];
      expect(fields[0]).toBe('12345');
      expect(fields[5]).toBe('John Doe');
      expect(fields[6]).toBe('john@example.com');
      expect(fields[8]).toBe('2026-03-20 10:00');
      expect(fields[9]).toBe('2026-03-20 11:00');
      expect(fields[10]).toBe('60');
      expect(fields[11]).toBe('Attended');
      expect(fields[14]).toBe('2');
      expect(fields[20]).toBe('Bay 3');
    });

    it('parses multi-line notes field with player data correctly', () => {
      const csv = 'Id,Name,Notes\n1,Test,"M:owner@test.com | Owner\nG: Guest One\nG: guest2@test.com | Guest Two"';
      const rows = parseCSVWithMultilineSupport(csv);
      expect(rows.length).toBe(2);
      const notesField = rows[1][2];
      expect(notesField).toContain('M:owner@test.com');
      expect(notesField).toContain('G: Guest One');
      expect(notesField).toContain('G: guest2@test.com');
      const players = parseNotesForPlayers(notesField);
      expect(players.length).toBe(3);
      expect(players[0].type).toBe('member');
      expect(players[0].email).toBe('owner@test.com');
      expect(players[1].type).toBe('guest');
      expect(players[1].name).toBe('Guest One');
      expect(players[2].type).toBe('guest');
      expect(players[2].email).toBe('guest2@test.com');
    });

    it('handles CSV with cancelled status rows', () => {
      const csv = 'Booking Id,Name,Email,Start,End,Duration,Bay,Status\n100,John,john@test.com,2026-03-20 10:00,2026-03-20 11:00,60,Bay 1,Cancelled\n101,Jane,jane@test.com,2026-03-20 12:00,2026-03-20 13:00,60,Bay 2,Attended';
      const rows = parseCSVWithMultilineSupport(csv);
      expect(rows.length).toBe(3);
      expect(rows[1][7]).toBe('Cancelled');
      expect(rows[2][7]).toBe('Attended');
    });

    it('extracts date and time from production datetime format', () => {
      expect(extractDate('2026-03-20 10:00')).toBe('2026-03-20');
      expect(extractTime('2026-03-20 10:00')).toMatch(/10:00/);
      expect(extractDate('2026-03-20 14:30:00')).toBe('2026-03-20');
      expect(extractTime('2026-03-20 14:30:00')).toMatch(/14:30/);
    });
  });

  describe('malformed CSV edge cases', () => {
    it('parseCSVLine handles single column', () => {
      expect(parseCSVLine('hello')).toEqual(['hello']);
    });

    it('parseCSVLine handles empty string', () => {
      expect(parseCSVLine('')).toEqual(['']);
    });

    it('parseCSVLine handles consecutive commas', () => {
      const result = parseCSVLine(',,,');
      expect(result.length).toBe(4);
      result.forEach(field => expect(field).toBe(''));
    });

    it('parseCSVWithMultilineSupport handles empty input', () => {
      const result = parseCSVWithMultilineSupport('');
      expect(result).toEqual([]);
    });

    it('parseCSVWithMultilineSupport handles single row no newline', () => {
      const result = parseCSVWithMultilineSupport('a,b,c');
      expect(result).toEqual([['a', 'b', 'c']]);
    });

    it('parseNotesForPlayers handles notes with only whitespace', () => {
      expect(parseNotesForPlayers('   ')).toEqual([]);
    });

    it('parseNotesForPlayers handles notes with no recognized patterns', () => {
      expect(parseNotesForPlayers('just some random text')).toEqual([]);
    });

    it('parseNotesForPlayers handles mixed newline formats', () => {
      const notes = 'M:a@test.com | Alice\r\nG: Bob\nG: Carol';
      const players = parseNotesForPlayers(notes);
      expect(players.length).toBe(3);
    });
  });
});
