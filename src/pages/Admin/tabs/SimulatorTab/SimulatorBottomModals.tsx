import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { TrackmanBookingModal } from '../../../../components/staff-command-center/modals/TrackmanBookingModal';
import { UnifiedBookingSheet } from '../../../../components/staff-command-center/modals/UnifiedBookingSheet';
import { StaffManualBookingModal } from '../../../../components/staff-command-center/modals/StaffManualBookingModal';
import ManualBookingModal from '../simulator/MemberSearchPopover';
import { useBookingActions } from '../../../../hooks/useBookingActions';
import { BOOKING_STATUS } from '../../../../../shared/constants/statuses';
import { putWithCredentials } from '../../../../hooks/queries/useFetch';
import { simulatorKeys } from '../../../../hooks/queries/adminKeys';
import type { BookingRequest as CommandCenterBookingRequest } from '../../../../components/staff-command-center/types';
import type { BookingRequest, Resource, ManualBookingResult } from '../simulator/simulatorTypes';
import type { ToastType } from '../../../../components/Toast';

export interface SimulatorBottomModalsProps {
  trackmanModal: { isOpen: boolean; booking: BookingRequest | null };
  setTrackmanModal: (state: { isOpen: boolean; booking: BookingRequest | null }) => void;
  handleTrackmanConfirm: (bookingId: number | string, trackmanBookingId: string) => Promise<void>;
  handleDevConfirm: (bookingId: number | string) => Promise<void>;
  staffManualBookingModalOpen: boolean;
  setStaffManualBookingModalOpen: (open: boolean) => void;
  staffManualBookingDefaults: { startTime?: string; date?: string };
  setStaffManualBookingDefaults: (defaults: { startTime?: string; date?: string }) => void;
  bookingSheet: {
    isOpen: boolean;
    trackmanBookingId: string | null;
    bayName?: string;
    bookingDate?: string;
    timeSlot?: string;
    matchedBookingId?: number;
    currentMemberName?: string;
    currentMemberEmail?: string;
    isRelink?: boolean;
    importedName?: string;
    notes?: string;
    bookingId?: number | null;
    mode?: 'assign' | 'manage';
    ownerName?: string;
    ownerEmail?: string;
    declaredPlayerCount?: number;
    bookingStatus?: string;
    bookingContext?: { requestDate?: string; startTime?: string; endTime?: string; resourceId?: number; resourceName?: string; durationMinutes?: number; notes?: string };
    ownerMembershipStatus?: string | null;
  };
  setBookingSheet: (sheet: { isOpen: boolean; trackmanBookingId: string | null }) => void;
  showManualBooking: boolean;
  setShowManualBooking: (show: boolean) => void;
  prefillResourceId: number | null;
  setPrefillResourceId: (id: number | null) => void;
  prefillDate: string | null;
  setPrefillDate: (date: string | null) => void;
  prefillStartTime: string | null;
  setPrefillStartTime: (time: string | null) => void;
  resources: Resource[];
  handleRefresh: () => void;
  showToast: (message: string, type?: ToastType, duration?: number, key?: string) => void;
  confirm: (opts: { title: string; message: string; confirmText: string; variant: string }) => Promise<boolean>;
  actualUserEmail: string | undefined;
  userEmail: string | undefined;
  queryClient: QueryClient;
  calendarStartDate: string;
  calendarEndDate: string;
}

const SimulatorBottomModals: React.FC<SimulatorBottomModalsProps> = ({
  trackmanModal,
  setTrackmanModal,
  handleTrackmanConfirm,
  handleDevConfirm,
  staffManualBookingModalOpen,
  setStaffManualBookingModalOpen,
  staffManualBookingDefaults,
  setStaffManualBookingDefaults,
  bookingSheet,
  setBookingSheet,
  showManualBooking,
  setShowManualBooking,
  prefillResourceId,
  setPrefillResourceId,
  prefillDate,
  setPrefillDate,
  prefillStartTime,
  setPrefillStartTime,
  resources,
  handleRefresh,
  showToast,
  confirm,
  actualUserEmail,
  userEmail,
  queryClient,
  calendarStartDate,
  calendarEndDate,
}) => {
  const { checkInWithToast, revertToApprovedWithToast } = useBookingActions();

  return (
    <>
      {showManualBooking && (
        <ManualBookingModal
          resources={resources}
          defaultResourceId={prefillResourceId || undefined}
          defaultDate={prefillDate || undefined}
          defaultStartTime={prefillStartTime || undefined}
          onClose={() => { setShowManualBooking(false); setPrefillResourceId(null); setPrefillDate(null); setPrefillStartTime(null); }}
          onSuccess={(booking?: ManualBookingResult) => {
            setShowManualBooking(false);
            setPrefillResourceId(null);
            setPrefillDate(null);
            setPrefillStartTime(null);
            if (booking) {
              queryClient.invalidateQueries({ queryKey: simulatorKeys.approvedBookings(calendarStartDate, calendarEndDate) });
            }
            window.dispatchEvent(new CustomEvent('booking-action-completed'));
            setTimeout(() => handleRefresh(), 500);
          }}
        />
      )}
      <TrackmanBookingModal
        isOpen={trackmanModal.isOpen}
        onClose={() => setTrackmanModal({ isOpen: false, booking: null })}
        booking={trackmanModal.booking as unknown as CommandCenterBookingRequest | null}
        onConfirm={handleTrackmanConfirm}
        onDevConfirm={handleDevConfirm}
      />
      <StaffManualBookingModal
        isOpen={staffManualBookingModalOpen}
        onClose={() => {
          setStaffManualBookingModalOpen(false);
          setStaffManualBookingDefaults({});
        }}
        defaultStartTime={staffManualBookingDefaults.startTime}
        defaultDate={staffManualBookingDefaults.date}
      />
      <UnifiedBookingSheet
        isOpen={bookingSheet.isOpen}
        onClose={() => setBookingSheet({ isOpen: false, trackmanBookingId: null })}
        mode={bookingSheet.mode || 'assign'}
        trackmanBookingId={bookingSheet.trackmanBookingId}
        bayName={bookingSheet.bayName}
        bookingDate={bookingSheet.bookingDate}
        timeSlot={bookingSheet.timeSlot}
        matchedBookingId={bookingSheet.matchedBookingId}
        currentMemberName={bookingSheet.currentMemberName}
        currentMemberEmail={bookingSheet.currentMemberEmail}
        isRelink={bookingSheet.isRelink}
        importedName={bookingSheet.importedName}
        notes={bookingSheet.notes}
        bookingId={bookingSheet.bookingId || undefined}
        ownerName={bookingSheet.ownerName}
        ownerEmail={bookingSheet.ownerEmail}
        declaredPlayerCount={bookingSheet.declaredPlayerCount}
        onSuccess={(options) => {
          if (!options?.markedAsEvent) {
            showToast(bookingSheet.isRelink ? 'Booking owner changed' : 'Trackman booking linked to member', 'success');
          }
          handleRefresh();
        }}
        onRosterUpdated={() => handleRefresh()}
        bookingStatus={bookingSheet.bookingStatus}
        bookingContext={bookingSheet.bookingContext}
        ownerMembershipStatus={bookingSheet.ownerMembershipStatus}
        onCancelBooking={async (bookingId) => {
          const confirmed = await confirm({
            title: 'Cancel Booking',
            message: 'Are you sure you want to cancel this booking?',
            confirmText: 'Cancel Booking',
            variant: 'warning'
          });
          if (!confirmed) return;
          try {
            await putWithCredentials(`/api/booking-requests/${bookingId}`, {
              status: BOOKING_STATUS.CANCELLED,
              staff_notes: 'Cancelled from booking sheet',
              cancelled_by: actualUserEmail || userEmail
            });
            showToast('Booking cancelled successfully', 'success');
            setBookingSheet({ isOpen: false, trackmanBookingId: null });
            handleRefresh();
          } catch (err: unknown) {
            showToast((err instanceof Error ? err.message : String(err)) || 'Failed to cancel booking', 'error');
          }
        }}
        onCheckIn={async (bookingId, targetStatus) => {
          const result = await checkInWithToast(bookingId, { status: targetStatus || BOOKING_STATUS.ATTENDED });
          if (result.success) {
            handleRefresh();
          }
        }}
        onRevertToApproved={async (bookingId) => {
          const result = await revertToApprovedWithToast(bookingId);
          if (result?.success) {
            handleRefresh();
          }
        }}
      />
    </>
  );
};

export default SimulatorBottomModals;
