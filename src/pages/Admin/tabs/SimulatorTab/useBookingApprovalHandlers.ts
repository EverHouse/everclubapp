import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthData } from '../../../../contexts/DataContext';
import { useToast } from '../../../../hooks/useToast';
import { bookingsKeys, simulatorKeys } from '../../../../hooks/queries/adminKeys';
import { putWithCredentials } from '../../../../hooks/queries/useFetch';
import type { BookingRequest } from '../simulator/simulatorTypes';
import { BOOKING_STATUS } from '../../../../../shared/constants/statuses';

interface UseBookingApprovalHandlersParams {
  calendarStartDate: string;
  calendarEndDate: string;
  selectedRequest: BookingRequest | null;
  setSelectedRequest: (r: BookingRequest | null) => void;
  setActionModal: (m: 'approve' | 'decline' | null) => void;
  selectedBayId: number | null;
  setSelectedBayId: (id: number | null) => void;
  staffNotes: string;
  setStaffNotes: (s: string) => void;
  suggestedTime: string;
  setSuggestedTime: (s: string) => void;
  setIsProcessing: (p: boolean) => void;
  setError: (e: string | null) => void;
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
}

export function useBookingApprovalHandlers({
  calendarStartDate,
  calendarEndDate,
  selectedRequest,
  setSelectedRequest,
  setActionModal,
  selectedBayId,
  setSelectedBayId,
  staffNotes,
  setStaffNotes,
  suggestedTime,
  setSuggestedTime,
  setIsProcessing,
  setError,
  setShowTrackmanConfirm,
  cancelConfirmModal,
  setCancelConfirmModal,
  setActionInProgress,
}: UseBookingApprovalHandlersParams) {
  const queryClient = useQueryClient();
  const { user, actualUser } = useAuthData();
  const { showToast } = useToast();

  const showCancelConfirmation = useCallback((booking: BookingRequest) => {
    const hasTrackman = !!(booking.trackman_booking_id) || 
      (booking.notes && booking.notes.includes('[Trackman Import ID:'));
    setCancelConfirmModal({
      isOpen: true,
      booking,
      hasTrackman: !!hasTrackman,
      isCancelling: false,
      showSuccess: false
    });
  }, [setCancelConfirmModal]);

  const performCancellation = useCallback(async () => {
    const booking = cancelConfirmModal.booking;
    if (!booking) return;
    
    const bookingKey = `${booking.source || 'booking'}-${booking.id}`;
    setCancelConfirmModal(prev => ({ ...prev, isCancelling: true }));
    
    setActionInProgress(prev => ({ ...prev, [bookingKey]: 'cancelling' }));
    
    await queryClient.cancelQueries({ queryKey: simulatorKeys.allRequests() });
    await queryClient.cancelQueries({ queryKey: simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate) });
    const previousRequests = queryClient.getQueryData(simulatorKeys.allRequests());
    const previousApproved = queryClient.getQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate));
    
    queryClient.setQueryData(simulatorKeys.allRequests(), (old: BookingRequest[] | undefined) => 
      (old || []).map(r => 
        r.id === booking.id && r.source === booking.source 
          ? { ...r, status: BOOKING_STATUS.CANCELLED } 
          : r
      )
    );
    queryClient.setQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate), (old: BookingRequest[] | undefined) => 
      (old || []).filter(b => 
        !(b.id === booking.id && b.source === booking.source)
      )
    );
    
    try {
      await putWithCredentials(`/api/booking-requests/${booking.id}`, { 
        status: BOOKING_STATUS.CANCELLED, 
        source: booking.source,
        cancelled_by: actualUser?.email
      });
      
      showToast('Booking cancelled', 'success');
      
      if (cancelConfirmModal.hasTrackman) {
        setCancelConfirmModal(prev => ({ ...prev, isCancelling: false, showSuccess: true }));
      } else {
        setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false });
      }
    } catch (err: unknown) {
      queryClient.setQueryData(simulatorKeys.allRequests(), previousRequests);
      queryClient.setQueryData(simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate), previousApproved);
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to cancel booking', 'error');
      setCancelConfirmModal({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false });
    } finally {
      setActionInProgress(prev => {
        const next = { ...prev };
        delete next[bookingKey];
        return next;
      });
    }
  }, [cancelConfirmModal.booking, cancelConfirmModal.hasTrackman, queryClient, calendarStartDate, calendarEndDate, actualUser?.email, showToast, setCancelConfirmModal, setActionInProgress]);

  const cancelBookingOptimistic = useCallback(async (
    booking: BookingRequest
  ): Promise<boolean> => {
    showCancelConfirmation(booking);
    return true;
  }, [showCancelConfirmation]);

  const initiateApproval = useCallback(() => {
    if (!selectedRequest) return;
    
    if (selectedRequest.source !== 'booking' && !selectedBayId) {
      setError('Please select a bay');
      return;
    }
    
    setShowTrackmanConfirm(true);
  }, [selectedRequest, selectedBayId, setError, setShowTrackmanConfirm]);

  const handleApprove = useCallback(async () => {
    if (!selectedRequest) return;
    
    const bookingKey = `${selectedRequest.source || 'request'}-${selectedRequest.id}`;
    setIsProcessing(true);
    setError(null);
    
    setActionInProgress(prev => ({ ...prev, [bookingKey]: 'approving' }));
    
    await queryClient.cancelQueries({ queryKey: simulatorKeys.allRequests() });
    const previousRequests = queryClient.getQueryData(simulatorKeys.allRequests());
    
    queryClient.setQueryData(simulatorKeys.allRequests(), (old: BookingRequest[] | undefined) => 
      (old || []).map(r => 
        r.id === selectedRequest.id && r.source === selectedRequest.source 
          ? { ...r, status: BOOKING_STATUS.CONFIRMED } 
          : r
      )
    );
    setShowTrackmanConfirm(false);
    setActionModal(null);
    const approvedRequest = selectedRequest;
    const approvedBayId = selectedBayId;
    const approvedStaffNotes = staffNotes;
    setSelectedRequest(null);
    setSelectedBayId(null);
    setStaffNotes('');
    
    try {
      if (approvedRequest.source === 'booking') {
        await putWithCredentials(`/api/bookings/${approvedRequest.id}/approve`, {});
      } else {
        await putWithCredentials(`/api/booking-requests/${approvedRequest.id}`, {
          status: BOOKING_STATUS.APPROVED,
          resource_id: approvedBayId,
          staff_notes: approvedStaffNotes || null,
          reviewed_by: user?.email
        });
      }
      
      showToast('Booking approved', 'success');
      window.dispatchEvent(new CustomEvent('booking-action-completed'));
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
      queryClient.invalidateQueries({ queryKey: simulatorKeys.all });
    } catch (err: unknown) {
      queryClient.setQueryData(simulatorKeys.allRequests(), previousRequests);
      setError((err instanceof Error ? err.message : String(err)));
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to approve booking', 'error');
    } finally {
      setIsProcessing(false);
      setActionInProgress(prev => {
        const next = { ...prev };
        delete next[bookingKey];
        return next;
      });
    }
  }, [selectedRequest, selectedBayId, staffNotes, queryClient, user?.email, showToast, setIsProcessing, setError, setActionInProgress, setShowTrackmanConfirm, setActionModal, setSelectedRequest, setSelectedBayId, setStaffNotes]);

  const handleDecline = useCallback(async () => {
    if (!selectedRequest) return;
    
    const bookingKey = `${selectedRequest.source || 'request'}-${selectedRequest.id}`;
    setIsProcessing(true);
    setError(null);
    
    const newStatus = selectedRequest.status === BOOKING_STATUS.APPROVED ? BOOKING_STATUS.CANCELLED : BOOKING_STATUS.DECLINED;
    const wasPending = selectedRequest.status === BOOKING_STATUS.PENDING || selectedRequest.status === BOOKING_STATUS.PENDING_APPROVAL;
    
    setActionInProgress(prev => ({ ...prev, [bookingKey]: 'declining' }));
    
    await queryClient.cancelQueries({ queryKey: simulatorKeys.allRequests() });
    const previousRequests = queryClient.getQueryData(simulatorKeys.allRequests());
    
    queryClient.setQueryData(simulatorKeys.allRequests(), (old: BookingRequest[] | undefined) => 
      (old || []).map(r => 
        r.id === selectedRequest.id && r.source === selectedRequest.source 
          ? { ...r, status: newStatus } 
          : r
      )
    );
    const declinedRequest = selectedRequest;
    const declinedStaffNotes = staffNotes;
    const declinedSuggestedTime = suggestedTime;
    setActionModal(null);
    setSelectedRequest(null);
    setStaffNotes('');
    setSuggestedTime('');
    
    try {
      if (declinedRequest.source === 'booking') {
        await putWithCredentials(`/api/bookings/${declinedRequest.id}/decline`, {});
      } else {
        await putWithCredentials(`/api/booking-requests/${declinedRequest.id}`, {
          status: newStatus,
          staff_notes: declinedStaffNotes || null,
          suggested_time: declinedSuggestedTime ? declinedSuggestedTime + ':00' : null,
          reviewed_by: actualUser?.email || user?.email,
          cancelled_by: newStatus === BOOKING_STATUS.CANCELLED ? (actualUser?.email || user?.email) : undefined
        });
      }
      
      const statusLabel = newStatus === BOOKING_STATUS.CANCELLED ? 'cancelled' : 'declined';
      showToast(`Booking ${statusLabel}`, 'success');
      if (wasPending) {
        window.dispatchEvent(new CustomEvent('booking-action-completed'));
      }
      queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
      queryClient.invalidateQueries({ queryKey: simulatorKeys.all });
    } catch (err: unknown) {
      queryClient.setQueryData(simulatorKeys.allRequests(), previousRequests);
      setError((err instanceof Error ? err.message : String(err)));
      showToast((err instanceof Error ? err.message : String(err)) || 'Failed to process request', 'error');
    } finally {
      setIsProcessing(false);
      setActionInProgress(prev => {
        const next = { ...prev };
        delete next[bookingKey];
        return next;
      });
    }
  }, [selectedRequest, staffNotes, suggestedTime, queryClient, actualUser?.email, user?.email, showToast, setIsProcessing, setError, setActionInProgress, setActionModal, setSelectedRequest, setStaffNotes, setSuggestedTime]);

  return {
    showCancelConfirmation,
    performCancellation,
    cancelBookingOptimistic,
    initiateApproval,
    handleApprove,
    handleDecline,
  };
}
