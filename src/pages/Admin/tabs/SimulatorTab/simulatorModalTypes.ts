import type { BookingRequest, Resource } from '../simulator/simulatorTypes';

export interface CancelConfirmModalState {
  isOpen: boolean;
  booking: BookingRequest | null;
  hasTrackman: boolean;
  isCancelling: boolean;
  showSuccess: boolean;
}

export interface FeeEstimate {
  ownerTier?: string | null;
  totalFee: number;
  note?: string;
  feeBreakdown: {
    overageFee: number;
    overageMinutes: number;
    guestCount: number;
    guestsUsingPasses: number;
    guestsCharged: number;
    guestFeePerUnit?: number;
    guestFees: number;
    guestPassesRemaining: number;
  };
}

export interface SimulatorModalsProps {
  selectedRequest: BookingRequest | null;
  actionModal: 'approve' | 'decline' | null;
  setActionModal: (modal: 'approve' | 'decline' | null) => void;
  setSelectedRequest: (req: BookingRequest | null) => void;
  error: string | null;
  setError: (err: string | null) => void;
  showTrackmanConfirm: boolean;
  setShowTrackmanConfirm: (show: boolean) => void;
  cancelConfirmModal: CancelConfirmModalState;
  setCancelConfirmModal: (state: CancelConfirmModalState) => void;
  feeEstimate: FeeEstimate | undefined;
  isFetchingFeeEstimate: boolean;
  resources: Resource[];
  selectedBayId: number | null;
  setSelectedBayId: (id: number) => void;
  availabilityStatus: 'checking' | 'available' | 'conflict' | null;
  conflictDetails: string | null;
  staffNotes: string;
  setStaffNotes: (notes: string) => void;
  suggestedTime: string | null;
  setSuggestedTime: (time: string) => void;
  declineAvailableSlots: string[];
  declineSlotsLoading: boolean;
  declineSlotsError: string | null;
  isProcessing: boolean;
  guestFeeDollars: number;
  initiateApproval: () => void;
  handleApprove: () => void;
  handleDecline: () => void;
  performCancellation: () => void;
}
