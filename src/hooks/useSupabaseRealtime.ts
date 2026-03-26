import { useEffect, useRef, useCallback, useMemo } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { bookingEvents } from '../lib/bookingEvents';

export interface UseSupabaseRealtimeOptions {
  userEmail?: string;
  tables?: string[];
  onNotification?: (payload: Record<string, unknown>) => void;
  onBookingUpdate?: (payload: Record<string, unknown>) => void;
  onAnnouncementUpdate?: (payload: Record<string, unknown>) => void;
  onTrackmanUnmatchedUpdate?: (payload: Record<string, unknown>) => void;
}

const DEFAULT_TABLES = ['notifications', 'booking_sessions', 'announcements', 'trackman_unmatched_bookings'];

export function useSupabaseRealtime(options: UseSupabaseRealtimeOptions = {}) {
  const {
    userEmail,
    tables = DEFAULT_TABLES,
    onNotification,
    onBookingUpdate,
    onAnnouncementUpdate,
    onTrackmanUnmatchedUpdate
  } = options;

  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const mountedRef = useRef(true);
  const retryCountRef = useRef<Map<string, number>>(new Map());
  const retryTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // eslint-disable-next-line react-hooks/purity
  const instanceId = useMemo(() => Math.random().toString(36).slice(2, 8), []);

  const onNotificationRef = useRef(onNotification);
  const onBookingUpdateRef = useRef(onBookingUpdate);
  const onAnnouncementUpdateRef = useRef(onAnnouncementUpdate);
  const onTrackmanUnmatchedUpdateRef = useRef(onTrackmanUnmatchedUpdate);
  onNotificationRef.current = onNotification;
  onBookingUpdateRef.current = onBookingUpdate;
  onAnnouncementUpdateRef.current = onAnnouncementUpdate;
  onTrackmanUnmatchedUpdateRef.current = onTrackmanUnmatchedUpdate;

  const getHandler = useCallback((table: string) => {
    switch (table) {
      case 'notifications': return (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('member-notification', { detail: payload }));
        if (!window.__wsConnected) {
          bookingEvents.emit();
        }
        onNotificationRef.current?.(payload);
      };
      case 'booking_sessions': return (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('booking-update', { detail: payload }));
        if (!window.__wsConnected) {
          bookingEvents.emit();
        }
        onBookingUpdateRef.current?.(payload);
      };
      case 'announcements': return (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('announcement-update', { detail: payload }));
        onAnnouncementUpdateRef.current?.(payload);
      };
      case 'trackman_unmatched_bookings': return (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent('trackman-unmatched-update', { detail: payload }));
        onTrackmanUnmatchedUpdateRef.current?.(payload);
      };
      default: return (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent(`${table}-update`, { detail: payload }));
      };
    }
  }, []);

  const getChannelName = useCallback((table: string) => {
    const base = (table === 'notifications' && userEmail)
      ? `realtime-${table}-${userEmail}`
      : `realtime-${table}`;
    return `${base}-${instanceId}`;
  }, [userEmail, instanceId]);

  const subscribeToTable = useCallback((supabase: ReturnType<typeof getSupabase>, table: string) => {
    if (!supabase || !mountedRef.current) return;

    const existingChannel = channelsRef.current.get(table);
    if (existingChannel) {
      try {
        supabase.removeChannel(existingChannel);
      } catch (_removeErr) {
        // intentionally empty
      }
      channelsRef.current.delete(table);
    }

    const channelName = getChannelName(table);
    const handler = getHandler(table);

    const filter = (table === 'notifications' && userEmail)
      ? { event: '*' as const, schema: 'public', table, filter: `user_email=eq.${userEmail}` }
      : { event: '*' as const, schema: 'public', table };

    const narrowToInsertUpdate = table === 'booking_sessions' || table === 'trackman_unmatched_bookings';

    let channel: RealtimeChannel;
    if (narrowToInsertUpdate) {
      channel = supabase
        .channel(channelName)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
          handler(payload);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
          handler(payload);
        });
    } else {
      channel = supabase
        .channel(channelName)
        .on('postgres_changes', filter, (payload) => {
          handler(payload);
        });
    }

    channel.subscribe((status, err) => {
      if (!mountedRef.current) return;

      if (status === 'SUBSCRIBED') {
        retryCountRef.current.set(table, 0);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const retries = retryCountRef.current.get(table) || 0;
        const errMsg = err ? ` (${err.message || err})` : '';
        console.warn(`[Supabase Realtime] ${status} for ${table}${errMsg} — scheduling reconnect (attempt ${retries + 1})`);

        const existingTimer = retryTimerRef.current.get(table);
        if (existingTimer) clearTimeout(existingTimer);

        const MAX_RETRIES = 10;
        if (retries < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retries), 30000) + Math.random() * 1000;
          retryCountRef.current.set(table, retries + 1);
          const timer = setTimeout(() => {
            if (!mountedRef.current) return;
            retryTimerRef.current.delete(table);
            const currentChannel = channelsRef.current.get(table);
            if (currentChannel) {
              try {
                supabase.removeChannel(currentChannel);
              } catch (_e) {
                // intentionally empty
              }
              channelsRef.current.delete(table);
            }
            subscribeToTable(supabase, table);
          }, delay);
          retryTimerRef.current.set(table, timer);
        } else {
          console.error(`[Supabase Realtime] Max retries (${MAX_RETRIES}) reached for ${table}, giving up`);
        }
      } else if (status === 'CLOSED') {
        channelsRef.current.delete(table);
      }
    });

    channelsRef.current.set(table, channel);
  }, [getChannelName, getHandler, userEmail]);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = getSupabase();
    if (!supabase) {
      return () => {
        mountedRef.current = false;
      };
    }

    for (const table of tables) {
      subscribeToTable(supabase, table);
    }

    const channels = channelsRef.current;
    const retryTimers = retryTimerRef.current;
    return () => {
      mountedRef.current = false;
      retryTimers.forEach((timer) => clearTimeout(timer));
      retryTimers.clear();
      channels.forEach((channel) => {
        try {
          supabase.removeChannel(channel);
        } catch (_cleanupErr) {
          // intentionally empty
        }
      });
      channels.clear();
    };
  }, [userEmail, tables, subscribeToTable]);

  return {
    isConfigured: !!getSupabase()
  };
}
