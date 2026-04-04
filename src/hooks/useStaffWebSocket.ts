import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthData } from '../contexts/DataContext';

export interface BookingEvent {
  eventType: string;
  bookingId: number;
  memberEmail: string;
  memberName?: string;
  resourceId?: number;
  resourceName?: string;
  resourceType?: string;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  playerCount?: number;
  status: string;
  version?: number;
  actionBy?: 'member' | 'staff';
  timestamp: string;
}

interface UseStaffWebSocketOptions {
  onBookingEvent?: (event: BookingEvent) => void;
  debounceMs?: number;
}

let globalConnectionId = 0;

export function useStaffWebSocket(options: UseStaffWebSocketOptions = {}) {
  const { onBookingEvent, debounceMs = 500 } = options;
  const { actualUser, sessionChecked } = useAuthData();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const keepaliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 20;
  const initTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingEventsRef = useRef<BookingEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<BookingEvent | null>(null);
  
  const mountIdRef = useRef<number>(0);
  const connectionIdRef = useRef<number>(0);
  const activeConnectionUserRef = useRef<string | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const authRejectedRef = useRef(false);
  const hasInitializedRef = useRef(false);
  
  const onBookingEventRef = useRef(onBookingEvent);
  onBookingEventRef.current = onBookingEvent;
  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;

  const userEmailRef = useRef(actualUser?.email);
  const userRoleRef = useRef(actualUser?.role);
  const sessionCheckedRef = useRef(sessionChecked);
  userEmailRef.current = actualUser?.email;
  userRoleRef.current = actualUser?.role;
  sessionCheckedRef.current = sessionChecked;

  const processPendingEvents = useCallback(() => {
    if (pendingEventsRef.current.length === 0) return;
    
    const events = [...pendingEventsRef.current];
    pendingEventsRef.current = [];
    
    const latestEvent = events[events.length - 1];
    setLastEvent(latestEvent);
    
    if (onBookingEventRef.current) {
      onBookingEventRef.current(latestEvent);
    }
    
    window.dispatchEvent(new CustomEvent('booking-update', { detail: latestEvent }));
  }, []);

  const handleBookingEvent = useCallback((event: BookingEvent) => {
    pendingEventsRef.current.push(event);
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      processPendingEvents();
    }, debounceMsRef.current);
  }, [processPendingEvents]);

  const connect = useCallback((_reason: string) => {
    const email = userEmailRef.current;
    const role = userRoleRef.current;
    
    if (!email) return;
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const isStaff = role === 'staff' || role === 'admin';
    if (!isStaff) return;

    globalConnectionId++;
    const thisConnectionId = globalConnectionId;
    connectionIdRef.current = thisConnectionId;
    
    isConnectingRef.current = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        if (connectionIdRef.current !== thisConnectionId) {
          ws.close();
          return;
        }
        
        const currentEmail = userEmailRef.current;
        isConnectingRef.current = false;
        setIsConnected(true);
        activeConnectionUserRef.current = currentEmail || null;
        const wasReconnect = reconnectAttemptRef.current > 0;
        reconnectAttemptRef.current = 0;

        let wsToken: string | undefined;
        try {
          const resp = await fetch('/api/auth/ws-token', { method: 'POST', credentials: 'include' });
          if (resp.ok) {
            const data = await resp.json();
            wsToken = data.token;
          } else if (resp.status === 401) {
            authRejectedRef.current = true;
            intentionalDisconnectRef.current = true;
            ws.close(4010, 'Session expired');
            return;
          }
        } catch {
          // token fetch failed — send auth without token (cookie-based fallback)
        }

        if (connectionIdRef.current !== thisConnectionId || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        ws.send(JSON.stringify({ 
          type: 'auth', 
          email: currentEmail,
          isStaff: true,
          wsToken
        }));

        if (wasReconnect) {
          if (reconnectRefreshTimerRef.current) clearTimeout(reconnectRefreshTimerRef.current);
          reconnectRefreshTimerRef.current = setTimeout(() => {
            reconnectRefreshTimerRef.current = null;
            window.dispatchEvent(new CustomEvent('booking-action-completed', { detail: { eventType: 'reconnect_refresh' } }));
          }, 500);
        }

        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
        }
        keepaliveIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'auth_error') {
            authRejectedRef.current = true;
            intentionalDisconnectRef.current = true;
            console.warn('[StaffWebSocket] Session invalid - stopping reconnection');
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(4010, 'Session expired');
            }
            return;
          }
          
          if (message.type === 'auth_success') {
            authRejectedRef.current = false;
            ws.send(JSON.stringify({ type: 'staff_register' }));
          }
          
          if (message.type === 'booking_event') {
            handleBookingEvent(message as BookingEvent);
            if (message.eventType === 'booking_cancelled') {
              window.dispatchEvent(new CustomEvent('booking-action-completed', { detail: message }));
            }
          }
          
          if (message.type === 'notification') {
            handleBookingEvent({
              eventType: 'notification',
              bookingId: message.data?.bookingId || message.data?.relatedId || 0,
              memberEmail: '',
              bookingDate: '',
              startTime: '',
              status: '',
              timestamp: new Date().toISOString()
            });
            const notifType = message.data?.notificationType || '';
            if (notifType === 'booking_cancelled' || notifType === 'cancellation_pending') {
              window.dispatchEvent(new CustomEvent('booking-action-completed', { detail: { eventType: notifType } }));
            }
          }
          
          if (message.type === 'rsvp_event') {
            handleBookingEvent({
              eventType: `rsvp_${message.action}`,
              bookingId: message.eventId || 0,
              memberEmail: message.memberEmail || '',
              bookingDate: '',
              startTime: '',
              status: message.action,
              timestamp: new Date().toISOString()
            });
          }
          
          if (message.type === 'wellness_event') {
            handleBookingEvent({
              eventType: `wellness_${message.action}`,
              bookingId: message.classId || 0,
              memberEmail: message.memberEmail || '',
              bookingDate: '',
              startTime: '',
              status: message.action,
              timestamp: new Date().toISOString()
            });
          }
          
          if (message.type === 'walkin_checkin') {
            window.dispatchEvent(new CustomEvent('walkin-checkin', { detail: message }));
          }

          if (message.type === 'wellhub_validation_failed') {
            window.dispatchEvent(new CustomEvent('wellhub-validation-failed', { detail: message }));
          }

          if (message.type === 'wellhub_status_change') {
            window.dispatchEvent(new CustomEvent('wellhub-status-change', { detail: message }));
          }

          if (message.type === 'wellhub_status_blocked') {
            window.dispatchEvent(new CustomEvent('wellhub-status-blocked', { detail: message }));
          }

          if (message.type === 'directory_update') {
            window.dispatchEvent(new CustomEvent('directory-update', { detail: message }));
          }

          if (message.type === 'availability_update') {
            handleBookingEvent({
              eventType: 'availability_update',
              bookingId: 0,
              memberEmail: '',
              bookingDate: message.date || '',
              startTime: '',
              status: message.action,
              timestamp: new Date().toISOString()
            });
            if (message.action === 'cancelled') {
              window.dispatchEvent(new CustomEvent('booking-action-completed', { detail: { eventType: 'availability_cancelled' } }));
            }
          }

          if (message.type === 'cafe_menu_update') {
            window.dispatchEvent(new CustomEvent('cafe-menu-update', { detail: message }));
          }

          if (message.type === 'closure_update') {
            window.dispatchEvent(new CustomEvent('closure-update', { detail: message }));
          }

          if (message.type === 'billing_update') {
            window.dispatchEvent(new CustomEvent('billing-update', { detail: message }));
            
            if (message.action === 'booking_payment_updated' && message.bookingId) {
              handleBookingEvent({
                eventType: 'payment_updated',
                bookingId: message.bookingId,
                memberEmail: message.memberEmail || '',
                bookingDate: '',
                startTime: '',
                status: 'paid',
                timestamp: new Date().toISOString()
              });
            }
          }

          if (message.type === 'tier_update') {
            window.dispatchEvent(new CustomEvent('tier-update', { detail: message }));
          }

          if (message.type === 'member_stats_updated') {
            window.dispatchEvent(new CustomEvent('member-stats-updated', { detail: message }));
          }

          if (message.type === 'booking_auto_confirmed') {
            window.dispatchEvent(new CustomEvent('booking-auto-confirmed', { detail: message }));
            handleBookingEvent({
              eventType: 'booking_auto_confirmed',
              bookingId: message.data?.bookingId || 0,
              memberEmail: message.data?.memberEmail || '',
              memberName: message.data?.memberName,
              bookingDate: message.data?.date || '',
              startTime: message.data?.time || '',
              status: 'approved',
              timestamp: new Date().toISOString()
            });
          }

          if (message.type === 'booking_confirmed') {
            window.dispatchEvent(new CustomEvent('booking-confirmed', { detail: message }));
            handleBookingEvent({
              eventType: 'booking_confirmed',
              bookingId: message.data?.bookingId || 0,
              memberEmail: message.data?.userEmail || '',
              bookingDate: '',
              startTime: '',
              status: 'approved',
              timestamp: new Date().toISOString()
            });
          }

          if (message.type === 'data_integrity_update') {
            window.dispatchEvent(new CustomEvent('data-integrity-update', { detail: message }));
          }

          if (message.type === 'directory_sync_update') {
            window.dispatchEvent(new CustomEvent('directory-sync-update', { detail: message }));
          }

          if (message.type === 'member_data_updated') {
            window.dispatchEvent(new CustomEvent('member-data-updated', { detail: message }));
          }

          if (message.type === 'announcement_update') {
            window.dispatchEvent(new CustomEvent('announcement-update', { detail: message }));
          }

          if (message.type === 'stripe_cleanup_progress') {
            window.dispatchEvent(new CustomEvent('stripe-cleanup-progress', { detail: message }));
          }

          if (message.type === 'visitor_archive_progress') {
            window.dispatchEvent(new CustomEvent('visitor-archive-progress', { detail: message }));
          }

          if (message.type === 'calendar_cleanup_complete') {
            window.dispatchEvent(new CustomEvent('calendar-cleanup-complete', { detail: message }));
          }

          if (message.type === 'booking_roster_update') {
            window.dispatchEvent(new CustomEvent('booking-roster-update', { detail: message }));
          }

          if (message.type === 'booking_updated') {
            window.dispatchEvent(new CustomEvent('booking-action-completed', { detail: message }));
          }

          if (message.type === 'booking_invoice_update') {
            window.dispatchEvent(new CustomEvent('booking-invoice-update', { detail: message }));
          }

          if (message.type === 'waitlist_update') {
            window.dispatchEvent(new CustomEvent('waitlist-update', { detail: message }));
          }

          if (message.type === 'day_pass_update') {
            window.dispatchEvent(new CustomEvent('day-pass-update', { detail: message }));
          }

          if (message.type === 'tour_update') {
            window.dispatchEvent(new CustomEvent('tour-update', { detail: message }));
          }

          if (message.type === 'booking_cleanup_alert') {
            window.dispatchEvent(new CustomEvent('booking-cleanup-alert', { detail: message }));
          }
        } catch (e: unknown) {
          console.error('[StaffWebSocket] Error parsing message:', e);
        }
      };

      ws.onclose = (event) => {
        const wasThisConnection = connectionIdRef.current === thisConnectionId;
        
        if (!wasThisConnection) {
          return;
        }
        
        isConnectingRef.current = false;
        setIsConnected(false);
        wsRef.current = null;
        activeConnectionUserRef.current = null;

        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
          keepaliveIntervalRef.current = null;
        }
        
        if (event.code >= 4001 && event.code <= 4003) {
          authRejectedRef.current = true;
          intentionalDisconnectRef.current = true;
          console.warn(`[StaffWebSocket] Auth failed (${event.code}) - stopping reconnection`);
        }
        
        if (!intentionalDisconnectRef.current) {
          const currentEmail = userEmailRef.current;
          const currentRole = userRoleRef.current;
          if (currentEmail && (currentRole === 'staff' || currentRole === 'admin')) {
            if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
              console.warn(`[StaffWebSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, stopping`);
              return;
            }
            const baseDelay = 2000;
            const maxDelay = 30000;
            const delay = Math.min(baseDelay * Math.pow(2, reconnectAttemptRef.current), maxDelay);
            reconnectAttemptRef.current++;
            reconnectTimeoutRef.current = setTimeout(() => {
              if (!sessionCheckedRef.current) {
                reconnectTimeoutRef.current = setTimeout(() => {
                  connect('session_ready_retry');
                }, 1000);
                return;
              }
              connect('auto_reconnect');
            }, delay);
          }
        }
      };

      ws.onerror = (error) => {
        console.error(`[StaffWebSocket] Connection error (id=${thisConnectionId}):`, error);
        isConnectingRef.current = false;
        setIsConnected(false);
      };
    } catch (e: unknown) {
      isConnectingRef.current = false;
      setIsConnected(false);
      console.error('[StaffWebSocket] Connection error:', e);
    }
  }, [handleBookingEvent]);

  const cleanup = useCallback(() => {
    intentionalDisconnectRef.current = true;
    
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (reconnectRefreshTimerRef.current) {
      clearTimeout(reconnectRefreshTimerRef.current);
      reconnectRefreshTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    isConnectingRef.current = false;
    activeConnectionUserRef.current = null;
  }, []);

  useEffect(() => {
    mountIdRef.current++;
    const thisMountId = mountIdRef.current;
    
    if (!sessionChecked) {
      return;
    }
    
    const userEmail = actualUser?.email;
    const isStaff = actualUser?.role === 'staff' || actualUser?.role === 'admin';
    
    if (!userEmail || !isStaff) {
      if (activeConnectionUserRef.current || wsRef.current) {
        cleanup();
      }
      intentionalDisconnectRef.current = false;
      hasInitializedRef.current = false;
      return;
    }
    
    if (activeConnectionUserRef.current === userEmail && wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    
    if (activeConnectionUserRef.current && activeConnectionUserRef.current !== userEmail) {
      cleanup();
    }
    
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }
    
    if (isConnectingRef.current) {
      return;
    }
    
    if (initTimerRef.current) {
      return;
    }

    if (authRejectedRef.current) {
      return;
    }
    
    hasInitializedRef.current = true;
    
    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null;
      if (mountIdRef.current !== thisMountId) {
        return;
      }
      connect('initial');
    }, 300);
    
  }, [sessionChecked, actualUser?.email, actualUser?.role, cleanup, connect]);
  
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isConnected,
    lastEvent
  };
}

export default useStaffWebSocket;
