import { useState, useEffect } from 'react';
import { BookingContextType, FetchedContext, ManageModeRosterData } from './bookingSheetTypes';
import { BookingStatusDropdown } from '../../../components/BookingStatusDropdown';

interface BookingActionsProps {
  bookingId?: number;
  bookingStatus?: string;
  fetchedContext?: FetchedContext | null;
  bookingContext?: BookingContextType;
  rosterData?: ManageModeRosterData | null;
  onCheckIn?: (bookingId: number, targetStatus?: 'attended' | 'no_show') => void | Promise<void>;
  onReschedule?: (booking: { id: number; requestDate: string; startTime: string; endTime: string; resourceId: number; resourceName?: string; userName?: string; userEmail?: string }) => void;
  onCancelBooking?: (bookingId: number) => void;
  ownerName?: string;
  ownerEmail?: string;
  bayName?: string;
}

export function BookingActions({
  bookingId,
  bookingStatus,
  fetchedContext,
  bookingContext,
  rosterData,
  onCheckIn,
  onReschedule: _onReschedule,
  onCancelBooking,
  ownerName,
  ownerEmail,
  bayName,
}: BookingActionsProps) {
  const [checkingIn, setCheckingIn] = useState(false);
  const [localStatus, setLocalStatus] = useState<'attended' | 'no_show' | null>(null);
  
  const effectiveStatus = localStatus || bookingStatus || fetchedContext?.bookingStatus;

  useEffect(() => {
    setCheckingIn(false);
    setLocalStatus(null);
  }, [bookingId]);

  const handleCheckIn = async (targetStatus?: 'attended' | 'no_show') => {
    if (!bookingId || !onCheckIn) return;
    
    setCheckingIn(true);
    try {
      const result = onCheckIn(bookingId, targetStatus);
      if (result instanceof Promise) {
        await result;
      }
      setLocalStatus(targetStatus || 'attended');
      setCheckingIn(false);
    } catch (error) {
      setCheckingIn(false);
      console.error('Check-in failed:', error);
    }
  };

  if (!(onCheckIn || onCancelBooking) || !bookingId) {
    return null;
  }

  const isPaymentPending = !!(rosterData?.financialSummary && rosterData.financialSummary.grandTotal > 0 && !rosterData.financialSummary.allPaid);

  return (
    <>
      <div className="flex gap-2">
        {onCheckIn && effectiveStatus !== 'attended' && effectiveStatus !== 'no_show' && effectiveStatus !== 'cancelled' && (
          <div className="flex-1">
            <BookingStatusDropdown
              currentStatus="check_in"
              onStatusChange={(status) => handleCheckIn(status)}
              disabled={checkingIn || isPaymentPending}
              loading={checkingIn}
              size="md"
              menuDirection="up"
            />
          </div>
        )}
        {effectiveStatus === 'attended' && (
          <div className="flex-1">
            <BookingStatusDropdown
              currentStatus="attended"
              onStatusChange={(status) => handleCheckIn(status)}
              disabled={checkingIn}
              loading={checkingIn}
              size="md"
              menuDirection="up"
            />
          </div>
        )}
        {effectiveStatus === 'no_show' && (
          <div className="flex-1">
            <BookingStatusDropdown
              currentStatus="no_show"
              onStatusChange={(status) => handleCheckIn(status)}
              disabled={checkingIn}
              loading={checkingIn}
              size="md"
              menuDirection="up"
            />
          </div>
        )}
        {onCancelBooking && effectiveStatus !== 'cancelled' && effectiveStatus !== 'cancellation_pending' && effectiveStatus !== 'no_show' && effectiveStatus !== 'attended' && (
          <button
            onClick={() => onCancelBooking(bookingId)}
            className="tactile-btn flex-1 py-2 px-3 rounded-lg border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">cancel</span>
            Cancel Booking
          </button>
        )}
      </div>
      {onCheckIn && effectiveStatus !== 'attended' && effectiveStatus !== 'no_show' && effectiveStatus !== 'cancelled' &&
        isPaymentPending && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-xs">info</span>
          Payment must be collected before check-in
        </p>
      )}
    </>
  );
}

export default BookingActions;
