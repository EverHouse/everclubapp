import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockEventsInsert = vi.fn();
const mockEventsDelete = vi.fn();
const mockEventsPatch = vi.fn();

vi.mock('../server/core/integrations', () => ({
  getGoogleCalendarClient: vi.fn().mockResolvedValue({
    events: {
      insert: (...args: unknown[]) => mockEventsInsert(...args),
      delete: (...args: unknown[]) => mockEventsDelete(...args),
      patch: (...args: unknown[]) => mockEventsPatch(...args),
    },
  }),
}));

vi.mock('../server/core/retryUtils', () => ({
  withCalendarRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getPacificISOString: vi.fn((date: string, time: string) => `${date}T${time}:00-07:00`),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

describe('Google Calendar Client', () => {
  let createCalendarEvent: typeof import('../server/core/calendar/google-client').createCalendarEvent;
  let deleteCalendarEvent: typeof import('../server/core/calendar/google-client').deleteCalendarEvent;
  let updateCalendarEvent: typeof import('../server/core/calendar/google-client').updateCalendarEvent;
  let createCalendarEventOnCalendar: typeof import('../server/core/calendar/google-client').createCalendarEventOnCalendar;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/core/calendar/google-client');
    createCalendarEvent = mod.createCalendarEvent;
    deleteCalendarEvent = mod.deleteCalendarEvent;
    updateCalendarEvent = mod.updateCalendarEvent;
    createCalendarEventOnCalendar = mod.createCalendarEventOnCalendar;
  });

  describe('createCalendarEvent', () => {
    it('creates event with correct summary and description', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'evt-123' } });
      const result = await createCalendarEvent(
        {
          requestDate: '2026-04-01',
          startTime: '10:00',
          endTime: '11:00',
          userName: 'John Doe',
          userEmail: 'john@test.com',
          durationMinutes: 60,
          notes: 'Test notes',
        },
        'Bay 1'
      );
      expect(result).toBe('evt-123');
      expect(mockEventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          requestBody: expect.objectContaining({
            summary: 'Booking: John Doe',
            description: expect.stringContaining('Bay 1'),
          }),
        })
      );
    });

    it('returns null when required fields are missing', async () => {
      const result = await createCalendarEvent({ userName: 'John' }, 'Bay 1');
      expect(result).toBeNull();
      expect(mockEventsInsert).not.toHaveBeenCalled();
    });

    it('returns null on API error', async () => {
      mockEventsInsert.mockRejectedValue(new Error('Google API error'));
      const result = await createCalendarEvent(
        {
          requestDate: '2026-04-01',
          startTime: '10:00',
          endTime: '11:00',
          userName: 'John',
          userEmail: 'john@test.com',
          durationMinutes: 60,
        },
        'Bay 1'
      );
      expect(result).toBeNull();
    });

    it('uses userEmail in summary when userName is missing', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'evt-456' } });
      await createCalendarEvent(
        {
          requestDate: '2026-04-01',
          startTime: '10:00',
          endTime: '11:00',
          userEmail: 'john@test.com',
          durationMinutes: 60,
        },
        'Bay 1'
      );
      expect(mockEventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Booking: john@test.com',
          }),
        })
      );
    });
  });

  describe('deleteCalendarEvent', () => {
    it('deletes event and returns true on success', async () => {
      mockEventsDelete.mockResolvedValue({});
      const result = await deleteCalendarEvent('evt-123');
      expect(result).toBe(true);
      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: 'primary', eventId: 'evt-123' })
      );
    });

    it('uses custom calendarId when provided', async () => {
      mockEventsDelete.mockResolvedValue({});
      await deleteCalendarEvent('evt-456', 'custom-cal-id');
      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: 'custom-cal-id' })
      );
    });

    it('returns false on API error', async () => {
      mockEventsDelete.mockRejectedValue(new Error('Not found'));
      const result = await deleteCalendarEvent('evt-999');
      expect(result).toBe(false);
    });
  });

  describe('updateCalendarEvent', () => {
    it('updates event and returns success with etag', async () => {
      mockEventsPatch.mockResolvedValue({
        data: { etag: '"abc123"', updated: '2026-04-01T12:00:00Z' },
      });
      const result = await updateCalendarEvent(
        'evt-123',
        'cal-id',
        'Updated Booking',
        'Updated description',
        '2026-04-01',
        '10:00',
        '11:00'
      );
      expect(result.success).toBe(true);
      expect(result.etag).toBe('"abc123"');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('returns failure when date is missing', async () => {
      const result = await updateCalendarEvent(
        'evt-123',
        'cal-id',
        'Title',
        'Desc',
        '',
        '10:00',
        '11:00'
      );
      expect(result.success).toBe(false);
    });

    it('returns failure on API error', async () => {
      mockEventsPatch.mockRejectedValue(new Error('Update failed'));
      const result = await updateCalendarEvent(
        'evt-123',
        'cal-id',
        'Title',
        'Desc',
        '2026-04-01',
        '10:00',
        '11:00'
      );
      expect(result.success).toBe(false);
    });

    it('includes extended properties when provided', async () => {
      mockEventsPatch.mockResolvedValue({ data: { etag: '"xyz"' } });
      await updateCalendarEvent(
        'evt-123',
        'cal-id',
        'Title',
        'Desc',
        '2026-04-01',
        '10:00',
        '11:00',
        { ehApp_visibility: 'public' }
      );
      expect(mockEventsPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            extendedProperties: { shared: { ehApp_visibility: 'public' } },
          }),
        })
      );
    });
  });

  describe('createCalendarEventOnCalendar', () => {
    it('creates event on specified calendar with extended properties', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'custom-evt' } });
      const result = await createCalendarEventOnCalendar(
        'custom-cal',
        'Event Title',
        'Event Desc',
        '2026-04-01',
        '10:00',
        '11:00',
        { ehApp_imageUrl: 'https://example.com/img.jpg' }
      );
      expect(result).toBe('custom-evt');
      expect(mockEventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'custom-cal',
          requestBody: expect.objectContaining({
            summary: 'Event Title',
            extendedProperties: { shared: { ehApp_imageUrl: 'https://example.com/img.jpg' } },
          }),
        })
      );
    });

    it('returns null when date is missing', async () => {
      const result = await createCalendarEventOnCalendar(
        'cal-id',
        'Title',
        'Desc',
        '',
        '10:00',
        '11:00'
      );
      expect(result).toBeNull();
    });
  });
});

describe('Calendar Config', () => {
  it('defines expected calendar names', async () => {
    vi.doMock('../server/core/settingsHelper', () => ({
      getSettingValue: vi.fn().mockImplementation((_k: string, d: string) => Promise.resolve(d)),
    }));
    const { CALENDAR_CONFIG } = await import('../server/core/calendar/config');
    expect(CALENDAR_CONFIG.golf.name).toBe('Booked Golf');
    expect(CALENDAR_CONFIG.conference.name).toBe('MBO_Conference_Room');
    expect(CALENDAR_CONFIG.events.name).toBe('Events');
    expect(CALENDAR_CONFIG.wellness.name).toBe('Wellness & Classes');
    expect(CALENDAR_CONFIG.internal.name).toBe('Internal Calendar');
    expect(CALENDAR_CONFIG.tours.name).toBe('Tours Scheduled');
  });

  it('getResourceConfig returns business hours and slot duration', async () => {
    vi.doMock('../server/core/settingsHelper', () => ({
      getSettingValue: vi.fn().mockImplementation((_k: string, d: string) => Promise.resolve(d)),
    }));
    const { getResourceConfig } = await import('../server/core/calendar/config');
    const golfConfig = await getResourceConfig('golf');
    expect(golfConfig.businessHours).toBeDefined();
    expect(golfConfig.slotDuration).toBe(60);
  });
});
