import { useState, useRef } from 'react';
import { useConfirmDialog } from '../../../../components/ConfirmDialog';
import type { BookingRequest } from '../simulator/simulatorTypes';

export function useSimulatorState() {
  const [selectedRequest, setSelectedRequest] = useState<BookingRequest | null>(null);
  const [actionModal, setActionModal] = useState<'approve' | 'decline' | null>(null);
  const [selectedBayId, setSelectedBayId] = useState<number | null>(null);
  const [staffNotes, setStaffNotes] = useState('');
  const [suggestedTime, setSuggestedTime] = useState('');
  const [declineAvailableSlots, setDeclineAvailableSlots] = useState<string[]>([]);
  const [declineSlotsLoading, setDeclineSlotsLoading] = useState(false);
  const [declineSlotsError, setDeclineSlotsError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityStatus, setAvailabilityStatus] = useState<'checking' | 'available' | 'conflict' | null>(null);
  const [conflictDetails, setConflictDetails] = useState<string | null>(null);
  const [showTrackmanConfirm, setShowTrackmanConfirm] = useState(false);
  const [showManualBooking, setShowManualBooking] = useState(false);
  const [prefillResourceId, setPrefillResourceId] = useState<number | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | null>(null);
  const [prefillStartTime, setPrefillStartTime] = useState<string | null>(null);
  const [scheduledFilter, setScheduledFilter] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [trackmanModal, setTrackmanModal] = useState<{ isOpen: boolean; booking: BookingRequest | null }>({ isOpen: false, booking: null });
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [bookingSheet, setBookingSheet] = useState<{
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
  }>({ isOpen: false, trackmanBookingId: null });
  const [cancelConfirmModal, setCancelConfirmModal] = useState<{
    isOpen: boolean;
    booking: BookingRequest | null;
    hasTrackman: boolean;
    isCancelling: boolean;
    showSuccess: boolean;
  }>({ isOpen: false, booking: null, hasTrackman: false, isCancelling: false, showSuccess: false });
  const [staffManualBookingModalOpen, setStaffManualBookingModalOpen] = useState(false);
  const [staffManualBookingDefaults, setStaffManualBookingDefaults] = useState<{
    startTime?: string;
    date?: string;
  }>({});
  const [actionInProgress, setActionInProgress] = useState<Record<string, string>>({});
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const calendarColRef = useRef<HTMLDivElement>(null);
  const [queueMaxHeight, setQueueMaxHeight] = useState<number | null>(null);

  return {
    selectedRequest, setSelectedRequest,
    actionModal, setActionModal,
    selectedBayId, setSelectedBayId,
    staffNotes, setStaffNotes,
    suggestedTime, setSuggestedTime,
    declineAvailableSlots, setDeclineAvailableSlots,
    declineSlotsLoading, setDeclineSlotsLoading,
    declineSlotsError, setDeclineSlotsError,
    isProcessing, setIsProcessing,
    error, setError,
    availabilityStatus, setAvailabilityStatus,
    conflictDetails, setConflictDetails,
    showTrackmanConfirm, setShowTrackmanConfirm,
    showManualBooking, setShowManualBooking,
    prefillResourceId, setPrefillResourceId,
    prefillDate, setPrefillDate,
    prefillStartTime, setPrefillStartTime,
    scheduledFilter, setScheduledFilter,
    showDatePicker, setShowDatePicker,
    isSyncing, setIsSyncing,
    lastRefresh, setLastRefresh,
    trackmanModal, setTrackmanModal,
    confirm, ConfirmDialogComponent,
    bookingSheet, setBookingSheet,
    cancelConfirmModal, setCancelConfirmModal,
    staffManualBookingModalOpen, setStaffManualBookingModalOpen,
    staffManualBookingDefaults, setStaffManualBookingDefaults,
    actionInProgress, setActionInProgress,
    qrScannerOpen, setQrScannerOpen,
    calendarColRef,
    queueMaxHeight, setQueueMaxHeight,
  };
}
