import { useMemo } from 'react';
import { getTodayString, getNowTimePacific } from '../utils/dateUtils';

interface BookingLike {
  booking_date?: string;
  request_date?: string;
  event_date?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  time?: string;
  status?: string;
}

const normalizeTime = (time: string | null | undefined): string => {
  if (!time) return '00:00';
  const parts = time.split(':');
  if (parts.length < 2) return '00:00';
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].slice(0, 2).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getBookingDate = (item: BookingLike): string => {
  const rawDate = item.booking_date || item.request_date || item.event_date || item.date || '';
  return rawDate.split('T')[0];
};

const getEndTime = (item: BookingLike): string | undefined => {
  return item.end_time || item.time;
};

export interface BookingFilterOptions {
  excludeCancelled?: boolean;
  excludeDeclined?: boolean;
  includeTerminalOnToday?: boolean;
}

const DEFAULT_OPTIONS: BookingFilterOptions = {
  excludeCancelled: true,
  excludeDeclined: true,
  includeTerminalOnToday: true,
};

export function useBookingFilters<T extends BookingLike>(
  items: T[],
  options: BookingFilterOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return useMemo(() => {
    const today = getTodayString();
    const nowTime = getNowTimePacific();
    const terminalStatuses = ['attended', 'no_show'];

    const upcoming: T[] = [];
    const past: T[] = [];

    for (const item of items) {
      const status = item.status?.toLowerCase() || '';
      
      if (opts.excludeCancelled && status === 'cancelled') continue;
      if (opts.excludeDeclined && status === 'declined') continue;

      const itemDate = getBookingDate(item);
      const endTime = getEndTime(item);
      const isToday = itemDate === today;
      const isFuture = itemDate > today;
      const isPast = itemDate < today;
      const hasEnded = endTime && normalizeTime(endTime) <= nowTime;
      const isTerminal = terminalStatuses.includes(status);

      if (isFuture) {
        upcoming.push(item);
      } else if (isPast) {
        past.push(item);
      } else if (isToday) {
        if (isTerminal || hasEnded) {
          past.push(item);
        } else {
          upcoming.push(item);
        }
      }
    }

    return { upcoming, past };
  }, [items, opts.excludeCancelled, opts.excludeDeclined]);
}

export function filterUpcoming<T extends BookingLike>(
  items: T[],
  options: BookingFilterOptions = {}
): T[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const today = getTodayString();
  const nowTime = getNowTimePacific();

  return items.filter(item => {
    const status = item.status?.toLowerCase() || '';
    
    if (opts.excludeCancelled && status === 'cancelled') return false;
    if (opts.excludeDeclined && status === 'declined') return false;

    const itemDate = getBookingDate(item);
    const endTime = getEndTime(item);
    const isToday = itemDate === today;
    const isFuture = itemDate > today;
    const hasEnded = endTime && normalizeTime(endTime) <= nowTime;

    if (isFuture) return true;
    if (isToday && !hasEnded) return true;
    return false;
  });
}

export function filterPast<T extends BookingLike>(
  items: T[],
  options: BookingFilterOptions = {}
): T[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const today = getTodayString();
  const nowTime = getNowTimePacific();
  const terminalStatuses = ['attended', 'no_show'];

  return items.filter(item => {
    const status = item.status?.toLowerCase() || '';
    
    if (opts.excludeCancelled && status === 'cancelled') return false;
    if (opts.excludeDeclined && status === 'declined') return false;

    const itemDate = getBookingDate(item);
    const endTime = getEndTime(item);
    const isToday = itemDate === today;
    const isPast = itemDate < today;
    const hasEnded = endTime && normalizeTime(endTime) <= nowTime;
    const isTerminal = terminalStatuses.includes(status);

    if (isPast) return true;
    if (isToday && (isTerminal || hasEnded)) return true;
    return false;
  });
}
