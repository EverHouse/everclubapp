import { getSettingValue } from '../settingsHelper';

export const CALENDAR_CONFIG = {
  golf: {
    name: 'Booked Golf',
    businessHours: { start: 9, end: 21 },
    slotDuration: 60,
  },
  conference: {
    name: 'MBO_Conference_Room',
    businessHours: { start: 8, end: 18 },
    slotDuration: 30,
  },
  events: {
    name: 'Events',
  },
  wellness: {
    name: 'Wellness & Classes',
    businessHours: { start: 6, end: 21 },
  },
  tours: {
    name: 'Tours Scheduled',
    businessHours: { start: 10, end: 17 },
    slotDuration: 30,
  },
  internal: {
    name: 'Internal Calendar',
  }
};

export async function getResourceConfig(resourceType: 'golf' | 'conference' | 'wellness' | 'tours') {
  const config = CALENDAR_CONFIG[resourceType];
  const defaultStart = config.businessHours?.start ?? 9;
  const defaultEnd = config.businessHours?.end ?? 21;
  const startHour = Number(await getSettingValue('resource.club_open_hour', String(defaultStart)));
  const endHour = Number(await getSettingValue('resource.club_close_hour', String(defaultEnd)));
  const slotDuration = 'slotDuration' in config
    ? Number(await getSettingValue(`resource.${resourceType}.slot_duration`, String(config.slotDuration)))
    : undefined;

  return {
    ...config,
    businessHours: { start: startHour, end: endHour },
    ...(slotDuration !== undefined ? { slotDuration } : {}),
  };
}

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface BusyPeriod {
  start: Date;
  end: Date;
}

export interface ConferenceRoomBooking {
  id: string;
  summary: string;
  description: string | null;
  date: string;
  startTime: string;
  endTime: string;
  memberName: string | null;
}

export interface MemberMatchResult {
  userEmail: string | null;
  userName: string | null;
  matchMethod: 'attendee' | 'description' | 'name' | 'manual_link' | null;
}

export interface CalendarEventData {
  summary?: string;
  description?: string;
  attendees?: Array<{ email?: string }>;
}
