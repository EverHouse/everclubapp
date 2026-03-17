import { useQuery } from '@tanstack/react-query';
import { fetchWithCredentials } from './useFetch';
import { bookingsKeys, simulatorKeys } from './adminKeys';

interface BookingRequest {
  id: number | string;
  user_email: string | null;
  user_name: string | null;
  resource_id: number | null;
  bay_name: string | null;
  resource_preference: string | null;
  request_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  notes: string | null;
  status: string;
  staff_notes: string | null;
  suggested_time: string | null;
  created_at: string | null;
  source?: string;
  resource_name?: string;
  first_name?: string;
  last_name?: string;
  tier?: string | null;
  trackman_booking_id?: string | null;
  has_unpaid_fees?: boolean;
  total_owed?: number;
}

interface Resource {
  id: number;
  name: string;
  type: string;
  description: string | null;
}

interface AvailabilityBlock {
  id: number;
  resourceId: number;
  blockDate: string;
  startTime: string;
  endTime: string;
  blockType: string;
  notes: string | null;
  closureTitle?: string | null;
}

interface CalendarClosure {
  id: number;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  affectedAreas: string | null;
  reason: string | null;
}

export { bookingsKeys, simulatorKeys };

export function useResources() {
  return useQuery({
    queryKey: bookingsKeys.resources(),
    queryFn: () => fetchWithCredentials<Resource[]>('/api/resources'),
    staleTime: 1000 * 60 * 10,
  });
}

export function useAvailabilityBlocks(date: string, resourceId?: number) {
  return useQuery({
    queryKey: bookingsKeys.availability(date, resourceId),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('date', date);
      if (resourceId) params.append('resourceId', String(resourceId));
      return fetchWithCredentials<AvailabilityBlock[]>(`/api/availability-blocks?${params.toString()}`);
    },
    enabled: !!date,
  });
}

export function useCalendarClosures() {
  return useQuery({
    queryKey: bookingsKeys.closures(),
    queryFn: () => fetchWithCredentials<CalendarClosure[]>('/api/closures'),
    staleTime: 1000 * 60 * 5,
  });
}

interface Bay {
  id: number;
  name: string;
  description: string;
}

interface PendingBooking {
  id: number;
  user_email: string;
  first_name?: string;
  last_name?: string;
  resource_name?: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  status: string;
  created_at: string | null;
}

interface MemberContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  tier: string | null;
  status?: string;
  manuallyLinkedEmails?: string[];
}

export function useAllBookingRequests() {
  return useQuery({
    queryKey: simulatorKeys.allRequests(),
    queryFn: () => fetchWithCredentials<BookingRequest[]>('/api/booking-requests?include_all=true'),
    staleTime: 1000 * 30,
  });
}

export function usePendingBookings() {
  return useQuery({
    queryKey: simulatorKeys.pendingBookings(),
    queryFn: () => fetchWithCredentials<PendingBooking[]>('/api/pending-bookings'),
    staleTime: 1000 * 30,
  });
}

export function useApprovedBookings(startDate: string, endDate: string) {
  return useQuery({
    queryKey: simulatorKeys.approvedBookings(startDate, endDate),
    queryFn: () => fetchWithCredentials<BookingRequest[]>(`/api/approved-bookings?start_date=${startDate}&end_date=${endDate}`),
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 30,
  });
}

export function useBays() {
  return useQuery({
    queryKey: simulatorKeys.bays(),
    queryFn: () => fetchWithCredentials<Bay[]>('/api/bays'),
    staleTime: 1000 * 60 * 10,
  });
}

export function useMemberContacts(status?: string) {
  return useQuery({
    queryKey: simulatorKeys.memberContacts(status),
    queryFn: async () => {
      const url = status ? `/api/hubspot/contacts?status=${status}` : '/api/hubspot/contacts';
      const rawData = await fetchWithCredentials<MemberContact[] | { contacts: MemberContact[] }>(url);
      return Array.isArray(rawData) ? rawData : (rawData.contacts || []);
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useFeeEstimate(bookingId: number | string | null, options?: { enabled?: boolean }) {
  const isEnabled = (options?.enabled ?? true) && !!bookingId;
  return useQuery({
    queryKey: simulatorKeys.feeEstimate(bookingId ?? ''),
    queryFn: async () => {
      const res = await fetch(`/api/fee-estimate?bookingId=${bookingId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch fee estimate');
      return res.json() as Promise<{
        totalFee: number;
        ownerTier: string | null;
        perPersonMins: number;
        feeBreakdown: {
          overageMinutes: number;
          overageFee: number;
          guestCount: number;
          guestPassesRemaining: number;
          guestsUsingPasses: number;
          guestsCharged: number;
          guestFees: number;
          guestFeePerUnit?: number;
        };
        note: string;
      }>;
    },
    enabled: isEnabled,
    staleTime: 30_000,
    retry: 1,
  });
}
