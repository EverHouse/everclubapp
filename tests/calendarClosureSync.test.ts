import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  parseClosureMetadata,
  formatClosureMetadata,
  updateDescriptionWithMetadata,
  getBaseDescription,
} from '../server/core/calendar/sync/closures';

describe('Calendar Closure Sync Orchestration', () => {
  describe('parseClosureMetadata', () => {
    it('returns empty object for empty description', () => {
      expect(parseClosureMetadata('')).toEqual({});
    });

    it('parses affectedAreas: none', () => {
      const result = parseClosureMetadata('[Affected: None]');
      expect(result.affectedAreas).toBe('none');
    });

    it('parses affectedAreas: all bays', () => {
      const result = parseClosureMetadata('[Affected: All Bays]');
      expect(result.affectedAreas).toBe('all_bays');
    });

    it('parses affectedAreas: conference room', () => {
      const result = parseClosureMetadata('[Affected: Conference Room]');
      expect(result.affectedAreas).toBe('conference_room');
    });

    it('parses affectedAreas: entire facility', () => {
      const result = parseClosureMetadata('[Affected: Entire Facility]');
      expect(result.affectedAreas).toBe('entire_facility');
    });

    it('parses notifyMembers: Yes', () => {
      const result = parseClosureMetadata('[Affected: None]\n[Members Notified: Yes]');
      expect(result.notifyMembers).toBe(true);
    });

    it('parses notifyMembers: No', () => {
      const result = parseClosureMetadata('[Affected: None]\n[Members Notified: No]');
      expect(result.notifyMembers).toBe(false);
    });

    it('parses notes after Members Notified bracket', () => {
      const desc = '[Affected: All Bays]\n[Members Notified: Yes]\nPlumbing maintenance required.';
      const result = parseClosureMetadata(desc);
      expect(result.notes).toBe('Plumbing maintenance required.');
    });

    it('handles case insensitivity in brackets', () => {
      const result = parseClosureMetadata('[affected: all bays]\n[members notified: yes]');
      expect(result.affectedAreas).toBe('all_bays');
      expect(result.notifyMembers).toBe(true);
    });

    it('parses full closure description with all fields', () => {
      const desc = 'Holiday closure\n---\n[Affected: Entire Facility]\n[Members Notified: Yes]\n\nClosed for Thanksgiving';
      const result = parseClosureMetadata(desc);
      expect(result.affectedAreas).toBe('entire_facility');
      expect(result.notifyMembers).toBe(true);
      expect(result.notes).toContain('Thanksgiving');
    });
  });

  describe('formatClosureMetadata', () => {
    it('formats metadata string with affected areas and notification', () => {
      const result = formatClosureMetadata('all_bays', true);
      expect(result).toContain('[Affected: All Bays]');
      expect(result).toContain('[Members Notified: Yes]');
    });

    it('includes notes when provided', () => {
      const result = formatClosureMetadata('none', false, 'Special maintenance');
      expect(result).toContain('Special maintenance');
    });

    it('does not include notes section when notes are empty', () => {
      const result = formatClosureMetadata('none', false, '');
      expect(result).not.toContain('\n\n\n');
    });

    it('maps area identifiers to display names', () => {
      expect(formatClosureMetadata('conference_room', true)).toContain('Conference Room');
      expect(formatClosureMetadata('entire_facility', true)).toContain('Entire Facility');
    });
  });

  describe('updateDescriptionWithMetadata', () => {
    it('appends metadata to a base description', () => {
      const result = updateDescriptionWithMetadata('Holiday closure', 'all_bays', true);
      expect(result).toContain('Holiday closure');
      expect(result).toContain('[Affected: All Bays]');
    });

    it('replaces existing metadata in description', () => {
      const original = 'Event\n---\n[Affected: None]\n[Members Notified: No]';
      const result = updateDescriptionWithMetadata(original, 'entire_facility', true, 'Updated notes');
      expect(result).not.toContain('[Affected: None]');
      expect(result).toContain('[Affected: Entire Facility]');
      expect(result).toContain('Updated notes');
    });
  });

  describe('getBaseDescription', () => {
    it('returns empty string for empty input', () => {
      expect(getBaseDescription('')).toBe('');
    });

    it('strips metadata section from description', () => {
      const desc = 'Main event description\n---\n[Affected: All Bays]\n[Members Notified: Yes]';
      expect(getBaseDescription(desc)).toBe('Main event description');
    });

    it('returns full text when no metadata present', () => {
      const desc = 'Just a regular description';
      expect(getBaseDescription(desc)).toBe('Just a regular description');
    });
  });
});
