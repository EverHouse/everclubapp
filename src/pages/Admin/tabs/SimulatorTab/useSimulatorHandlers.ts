import { useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthData } from '../../../../contexts/DataContext';
import { getTodayPacific } from '../../../../utils/dateUtils';
import { useToast } from '../../../../components/Toast';
import { useBookingActions } from '../../../../hooks/useBookingActions';
import { parseQrCode } from '../../../../utils/qrCodeParser';
import { bookingsKeys, simulatorKeys } from '../../../../hooks/queries/adminKeys';
import { fetchWithCredentials, putWithCredentials, postWithCredentials } from '../../../../hooks/queries/useFetch';
import type { BookingRequest, AvailabilityBlock } from '../simulator/simulatorTypes';
import { BOOKING_STATUS } from '../../../../../shared/constants/statuses';
import { useBookingApprovalHandlers } from './useBookingApprovalHandlers';

interface UseSimulatorHandlersParams {
  requests: BookingRequest[];
  approvedBookings: BookingRequest[];
  calendarStartDate: string;
  calendarEndDate: string;
  selectedRequest: BookingRequest | null;
  setSelectedRequest: (r: BookingRequest | null) => void;
  actionModal: 'approve' | 'decline' | null;
  setActionModal: (m: 'approve' | 'decline' | null) => void;
  selectedBayId: number | null;
  setSelectedBayId: (id: number | null) => void;
  staffNotes: string;
  setStaffNotes: (s: string) => void;
  suggestedTime: string;
  setSuggestedTime: (s: string) => void;
  isProcessing: boolean;
  setIsProcessing: (p: boolean) => void;
  setError: (e: string | null) => void;
  showTrackmanConfirm: boolean;
  setShowTrackmanConfirm: (s: boolean) => void;
  cancelConfirmModal: {
    isOpen: boolean;
    booking: BookingRequest | null;
    hasTrackman: boolean;
    isCancelling: boolean;
    showSuccess: boolean;
  };
  setCancelConfirmModal: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    booking: BookingRequest | null;
    hasTrackman: boolean;
    isCancelling: boolean;
    showSuccess: boolean;
  }>>;
  setActionInProgress: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setBookingSheet: (sheet: Record<string, unknown>) => void;
  setLastRefresh: (d: Date) => void;
  setQrScannerOpen: (v: boolean) => void;
}

export function useSimulatorHandlers(params: UseSimulatorHandlersParams) {
  const {
    requests,
    approvedBookings,
    calendarStartDate,
    calendarEndDate,
    setBookingSheet,
    setLastRefresh,
    setQrScannerOpen,
  } = params;

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { checkInWithToast, revertToApprovedWithToast } = useBookingActions();
  const checkinInProgressRef = useRef<Set<number>>(new Set());

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
    queryClient.invalidateQueries({ queryKey: simulatorKeys.all });
    setLastRefresh(new Date());
  }, [queryClient, setLastRefresh]);

  const prefetchedDates = useRef(new Set<string>());
  const prefetchDate = useCallback((date: string) => {
    if (prefetchedDates.current.has(date)) return;
    prefetchedDates.current.add(date);
    queryClient.prefetchQuery({
      queryKey: simulatorKeys.approvedBookings(date, date),
      queryFn: () => fetchWithCredentials<BookingRequest[]>(`/api/approved-bookings?start_date=${date}&end_date=${date}`),
      staleTime: 1000 * 30,
    });
    queryClient.prefetchQuery({
      queryKey: bookingsKeys.availability(date),
      queryFn: () => fetchWithCredentials<AvailabilityBlock[]>(`/api/availability-blocks?date=${date}`),
      staleTime: 1000 * 30,
    });
  }, [queryClient]);

  const handleTrackmanConfirm = useCallback(async (bookingId: number | string, trackmanBookingId: string) => {
    const apiId = typeof bookingId === 'string' ? parseInt(String(bookingId).replace('cal_', ''), 10) : bookingId;
    const _booking = requests.find(r => r.id === bookingId);

    await putWithCredentials(`/api/booking-requests/${apiId}`, { 
      status: BOOKING_STATUS.APPROVED,
      trackman_booking_id: trackmanBookingId
    });
    showToast('Booking confirmed with Trackman', 'success');
    window.dispatchEvent(new CustomEvent('booking-action-completed'));
    handleRefresh();
  }, [requests, showToast, handleRefresh]);

  const handleDevConfirm = useCallback(async (bookingId: number | string) => {
    const apiId = typeof bookingId === 'string' ? parseInt(String(bookingId).replace('cal_', ''), 10) : bookingId;
    const data = await postWithCredentials<{ totalFeeCents?: number }>(`/api/admin/bookings/${apiId}/dev-confirm`, {});
    const totalFee = (data.totalFeeCents || 0) / 100;
    showToast(`Confirmed! Total fees: $${totalFee.toFixed(2)}`, 'success');
    window.dispatchEvent(new CustomEvent('booking-action-completed'));
    handleRefresh();
  }, [showToast, handleRefresh]);

  const updateBookingStatusOptimistic = useCallback(async (
    booking: BookingRequest,
    newStatus: 'attended' | 'no_show' | 'cancelled' | 'approved'
  ): Promise<boolean> => {
    const bookingId = typeof booking.id === 'string' 
      ? parseInt(String(booking.id).replace('cal_', ''), 10) 
      : booking.id;
    
    if (newStatus === BOOKING_STATUS.APPROVED) {
      const result = await revertToApprovedWithToast(bookingId);
      await queryClient.invalidateQueries({ queryKey: simulatorKeys.allRequests() });
      await queryClient.invalidateQueries({ queryKey: simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate) });
      return !!result.success;
    }

    if (newStatus === BOOKING_STATUS.ATTENDED && checkinInProgressRef.current.has(bookingId)) {
      return false;
    }
    if (newStatus === BOOKING_STATUS.ATTENDED) {
      checkinInProgressRef.current.add(bookingId);
    }
    
    await queryClient.cancelQueries({ queryKey: simulatorKeys.allRequests() });
    await queryClient.cancelQueries({ queryKey: simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate) });
    const previousRequests = queryClient.getQueryData(simulatorKeys.allRequests());
    const previousApproved = queryClient.getQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate));
    
    queryClient.setQueryData(simulatorKeys.allRequests(), (old: BookingRequest[] | undefined) => 
      (old || []).map(r => 
        r.id === booking.id ? { ...r, status: newStatus } : r
      )
    );
    queryClient.setQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate), (old: BookingRequest[] | undefined) => 
      (old || []).map(b => 
        b.id === booking.id ? { ...b, status: newStatus } : b
      )
    );
    
    try {
      const result = await checkInWithToast(bookingId, { status: newStatus, source: booking.source });
      
      if (!result.success) {
        queryClient.setQueryData(simulatorKeys.allRequests(), previousRequests);
        queryClient.setQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate), previousApproved);
        
        if (result.requiresRoster || result.requiresPayment) {
          setBookingSheet({
            isOpen: true,
            trackmanBookingId: null,
            bookingId,
            mode: 'manage' as const,
          });
        }
        if (newStatus === BOOKING_STATUS.ATTENDED) {
          checkinInProgressRef.current.delete(bookingId);
        }
        return false;
      }
      
      if (newStatus === BOOKING_STATUS.ATTENDED) {
        checkinInProgressRef.current.delete(bookingId);
      }
      queryClient.invalidateQueries({ queryKey: simulatorKeys.allRequests() });
      queryClient.invalidateQueries({ queryKey: simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate) });
      return true;
    } catch (err: unknown) {
      queryClient.setQueryData(simulatorKeys.allRequests(), previousRequests);
      queryClient.setQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate), previousApproved);
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to update status', 'error');
      if (newStatus === BOOKING_STATUS.ATTENDED) {
        checkinInProgressRef.current.delete(bookingId);
      }
      return false;
    }
  }, [queryClient, calendarStartDate, calendarEndDate, showToast, checkInWithToast, revertToApprovedWithToast, setBookingSheet]);

  const handleQrScanSuccess = useCallback(async (decodedText: string) => {
    setQrScannerOpen(false);
    const parsed = parseQrCode(decodedText);

    if (parsed.type === 'member' && parsed.memberId) {
      try {
        showToast('Processing check-in...', 'info');
        const result = await postWithCredentials<{
          success?: boolean;
          alreadyCheckedIn?: boolean;
          hasBooking?: boolean;
          bookingId?: number;
          memberEmail?: string;
          memberName?: string;
          bookingDetails?: { bayName?: string; startTime?: string; endTime?: string };
          error?: string;
        }>('/api/staff/qr-checkin', { memberId: parsed.memberId });

        if (result.success) {
          const isAlreadyCheckedIn = !!result.alreadyCheckedIn;
          if (result.hasBooking && result.bookingId) {
            const bookingId = Number(result.bookingId);
            if (checkinInProgressRef.current.has(bookingId)) return;

            const booking = approvedBookings.find(b => Number(b.id) === bookingId);
            if (booking) {
              await updateBookingStatusOptimistic(booking, BOOKING_STATUS.ATTENDED);
            } else {
              const syntheticBooking: BookingRequest = {
                id: bookingId,
                user_email: result.memberEmail ?? null,
                user_name: result.memberName ?? null,
                resource_id: null,
                bay_name: null,
                resource_preference: null,
                request_date: getTodayPacific(),
                start_time: result.bookingDetails?.startTime || '',
                end_time: result.bookingDetails?.endTime || '',
                duration_minutes: 60,
                notes: null,
                status: BOOKING_STATUS.APPROVED,
                staff_notes: null,
                suggested_time: null,
                created_at: null,
                source: 'booking'
              };
              await updateBookingStatusOptimistic(syntheticBooking, BOOKING_STATUS.ATTENDED);
            }
            if (isAlreadyCheckedIn) {
              showToast('Already checked in — booking marked as attended', 'info');
            }
          } else {
            showToast(`${result.memberName} checked in (no booking found for today)`, 'info');
            handleRefresh();
          }
        } else if (result.alreadyCheckedIn) {
          showToast('This member was already checked in', 'info');
        } else {
          showToast(result.error || 'Check-in failed', 'error');
        }
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to process check-in', 'error');
      }
      return;
    }

    if (parsed.type === 'booking' && parsed.bookingId) {
      const scannedBookingId = parsed.bookingId;
      if (checkinInProgressRef.current.has(scannedBookingId)) return;
      const booking = approvedBookings.find(b => Number(b.id) === scannedBookingId);
      if (booking) {
        await updateBookingStatusOptimistic(booking, BOOKING_STATUS.ATTENDED);
      } else {
        showToast('Processing check-in...', 'info');
        const result = await checkInWithToast(scannedBookingId, { source: 'booking' });
        if (result.success) {
          handleRefresh();
        } else if (result.requiresRoster || result.requiresPayment) {
          setBookingSheet({
            isOpen: true,
            trackmanBookingId: null,
            bookingId: scannedBookingId,
            mode: 'manage' as const,
          });
        }
      }
      return;
    }

    showToast('Invalid QR code format', 'error');
  }, [approvedBookings, showToast, handleRefresh, updateBookingStatusOptimistic, checkInWithToast, setBookingSheet, setQrScannerOpen]);

  const isBookingUnmatched = useCallback((booking: BookingRequest): boolean => {
    const email = (booking.user_email || '').toLowerCase();
    const isPlaceholderEmail = !email || 
      email.includes('@trackman.local') ||
      email.includes('@visitors.evenhouse.club') ||
      email.includes('@visitors.everclub.co') ||
      email.startsWith('unmatched-') ||
      email.startsWith('golfnow-') ||
      email.startsWith('classpass-') ||
      email === 'unmatched@trackman.import';
    
    return booking.is_unmatched === true ||
      isPlaceholderEmail ||
      (booking.user_name || '').includes('Unknown (Trackman)');
  }, []);

  const {
    showCancelConfirmation,
    performCancellation,
    cancelBookingOptimistic,
    initiateApproval,
    handleApprove,
    handleDecline,
  } = useBookingApprovalHandlers(params);

  return {
    handleRefresh,
    prefetchDate,
    handleTrackmanConfirm,
    handleDevConfirm,
    updateBookingStatusOptimistic,
    handleQrScanSuccess,
    showCancelConfirmation,
    performCancellation,
    cancelBookingOptimistic,
    isBookingUnmatched,
    initiateApproval,
    handleApprove,
    handleDecline,
  };
}
