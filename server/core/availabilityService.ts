import { getSettingValue } from './settingsHelper';
import { getDayOfWeekFromDateStr } from '../utils/dateUtils';

export interface APISlot {
  start_time: string;
  end_time: string;
  available: boolean;
  requested?: boolean;
}

export interface BusinessHours {
  open: number;
  close: number;
}

export interface TimeRange {
  start_time: string;
  end_time: string;
}

export interface GenerateSlotsOptions {
  durationMinutes: number;
  hours: BusinessHours;
  currentMinutes: number;
  isToday: boolean;
  bookedSlots: TimeRange[];
  blockedSlots: TimeRange[];
  unmatchedSlots: TimeRange[];
  calendarSlots: TimeRange[];
  pendingSlots?: TimeRange[];
  slotIncrement?: number;
  skipPastBuffer?: number;
}

export function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function parseDisplayHoursToMinutes(displayStr: string): BusinessHours | null {
  if (!displayStr || displayStr.toLowerCase() === 'closed') return null;
  const parts = displayStr.split(/\s*[–-]\s*/);
  if (parts.length !== 2) return null;
  const open = parseTimeToMinutes(parts[0]);
  const close = parseTimeToMinutes(parts[1]);
  if (open === null || close === null) return null;
  return { open, close };
}

export async function getBusinessHoursFromSettings(date: string): Promise<BusinessHours | null> {
  const dayOfWeek = getDayOfWeekFromDateStr(date);
  let settingKey: string;
  let fallback: string;
  switch (dayOfWeek) {
    case 0: settingKey = 'hours.sunday'; fallback = '8:30 AM – 6:00 PM'; break;
    case 1: settingKey = 'hours.monday'; fallback = 'Closed'; break;
    case 5:
    case 6: settingKey = 'hours.friday_saturday'; fallback = '8:30 AM – 10:00 PM'; break;
    default: settingKey = 'hours.tuesday_thursday'; fallback = '8:30 AM – 8:00 PM'; break;
  }
  const displayStr = (await getSettingValue(settingKey, fallback)) ?? fallback;
  return parseDisplayHoursToMinutes(displayStr);
}

export function parseTime24ToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function hasOverlap(start: string, end: string, slots: TimeRange[]): boolean {
  return slots.some(s => start < s.end_time && end > s.start_time);
}

export function generateSlotsForResource(options: GenerateSlotsOptions): APISlot[] {
  const {
    durationMinutes,
    hours,
    currentMinutes,
    isToday,
    bookedSlots,
    blockedSlots,
    unmatchedSlots,
    calendarSlots,
    pendingSlots = [],
    slotIncrement = 15,
    skipPastBuffer = 0,
  } = options;

  const slots: APISlot[] = [];
  const { open: openMinutes, close: closeMinutes } = hours;

  for (let startMins = openMinutes; startMins + durationMinutes <= closeMinutes; startMins += slotIncrement) {
    if (isToday && startMins < currentMinutes + skipPastBuffer) {
      continue;
    }

    const startHour = Math.floor(startMins / 60);
    const startMin = startMins % 60;
    const endMins = startMins + durationMinutes;
    const endHour = Math.floor(endMins / 60);
    const endMin = endMins % 60;

    const startTime = `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}:00`;
    const endTime = `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}:00`;

    const hasBookingConflict = hasOverlap(startTime, endTime, bookedSlots);
    const hasBlockConflict = hasOverlap(startTime, endTime, blockedSlots);
    const hasUnmatchedConflict = hasOverlap(startTime, endTime, unmatchedSlots);
    const hasCalendarConflict = hasOverlap(startTime, endTime, calendarSlots);
    const hasPendingConflict = hasOverlap(startTime, endTime, pendingSlots);

    const isUnavailable = hasBookingConflict || hasBlockConflict || hasUnmatchedConflict || hasCalendarConflict || hasPendingConflict;

    const slot: APISlot = {
      start_time: startTime,
      end_time: endTime,
      available: !isUnavailable
    };

    if (hasPendingConflict && !hasBookingConflict && !hasBlockConflict && !hasUnmatchedConflict && !hasCalendarConflict) {
      slot.requested = true;
    }

    slots.push(slot);
  }

  return slots;
}
