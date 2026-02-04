import { useState, useEffect, useCallback, useRef } from 'react';

export interface CommandCenterCounts {
  pendingBookings: number;
  todaysBookings: number;
  activeMembers: number;
  pendingTours: number;
}

export interface PendingRequest {
  id: number;
  requestDate: string;
  startTime: string;
  endTime: string;
  status: string;
  createdAt: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  resourceName: string | null;
}

export interface TodaysBooking {
  id: number;
  requestDate: string;
  startTime: string;
  endTime: string;
  status: string;
  resourceId: number | null;
  resourceName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface PendingTour {
  id: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string | null;
  tourDate: string | null;
  startTime: string | null;
  status: string;
  createdAt: string;
}

export interface RecentActivity {
  id: number;
  action: string;
  staffEmail: string | null;
  resourceType: string | null;
  resourceName: string | null;
  createdAt: string;
}

export interface CommandCenterFinancials {
  todayRevenueCents: number;
  overduePaymentsCount: number;
  failedPaymentsCount: number;
}

export interface CommandCenterData {
  counts: CommandCenterCounts;
  pendingRequests: PendingRequest[];
  todaysBookings: TodaysBooking[];
  pendingToursList: PendingTour[];
  recentActivity: RecentActivity[];
  financials: CommandCenterFinancials;
  date: string;
  timestamp: string;
}

interface UseCommandCenterResult {
  data: CommandCenterData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const defaultCounts: CommandCenterCounts = {
  pendingBookings: 0,
  todaysBookings: 0,
  activeMembers: 0,
  pendingTours: 0
};

const defaultFinancials: CommandCenterFinancials = {
  todayRevenueCents: 0,
  overduePaymentsCount: 0,
  failedPaymentsCount: 0
};

export function useCommandCenter(): UseCommandCenterResult {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef<(() => Promise<void>) | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/command-center', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) {
          setData(null);
          return;
        }
        throw new Error('Failed to fetch command center data');
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      console.error('Command center fetch error:', err);
      setError(err.message);
      setData({
        counts: defaultCounts,
        pendingRequests: [],
        todaysBookings: [],
        pendingToursList: [],
        recentActivity: [],
        financials: defaultFinancials,
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString()
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  fetchRef.current = fetchData;

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);

    const handleBookingAction = () => fetchData();
    const handleBookingUpdate = () => fetchData();
    
    window.addEventListener('booking-action-completed', handleBookingAction);
    window.addEventListener('booking-update', handleBookingUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('booking-action-completed', handleBookingAction);
      window.removeEventListener('booking-update', handleBookingUpdate);
    };
  }, [fetchData]);

  const refetch = useCallback(() => {
    fetchRef.current?.();
  }, []);

  return { data, isLoading, error, refetch };
}
