import { BookingContextType, FetchedContext, ManageModeRosterData } from './bookingSheetTypes';

interface BookingActionsProps {
  bookingId?: number;
  bookingStatus?: string;
  fetchedContext?: FetchedContext | null;
  bookingContext?: BookingContextType;
  rosterData?: ManageModeRosterData | null;
  onCheckIn?: (bookingId: number) => void;
  onReschedule?: (booking: { id: number; request_date: string; start_time: string; end_time: string; resource_id: number; resource_name?: string; user_name?: string; user_email?: string }) => void;
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
  onReschedule,
  onCancelBooking,
  ownerName,
  ownerEmail,
  bayName,
}: BookingActionsProps) {
  const effectiveStatus = bookingStatus || fetchedContext?.bookingStatus;

  if (!(onCheckIn || onReschedule || onCancelBooking) || !bookingId) {
    return null;
  }

  return (
    <>
      <div className="flex gap-2">
        {onCheckIn && effectiveStatus !== 'attended' && effectiveStatus !== 'cancelled' && (
          <button
            onClick={() => onCheckIn(bookingId)}
            disabled={!!(rosterData?.financialSummary && rosterData.financialSummary.grandTotal > 0 && !rosterData.financialSummary.allPaid)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
              rosterData?.financialSummary && rosterData.financialSummary.grandTotal > 0 && !rosterData.financialSummary.allPaid
                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            <span className="material-symbols-outlined text-sm">how_to_reg</span>
            Check In
          </button>
        )}
        {onReschedule && effectiveStatus !== 'cancelled' && (
          <button
            onClick={() => onReschedule({
              id: bookingId,
              request_date: bookingContext?.requestDate || fetchedContext?.bookingDate || '',
              start_time: bookingContext?.startTime || '',
              end_time: bookingContext?.endTime || '',
              resource_id: bookingContext?.resourceId || fetchedContext?.resourceId || 0,
              resource_name: bookingContext?.resourceName || bayName || fetchedContext?.bayName,
              user_name: ownerName || fetchedContext?.ownerName,
              user_email: ownerEmail || fetchedContext?.ownerEmail,
            })}
            className="flex-1 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">event_repeat</span>
            Reschedule
          </button>
        )}
        {onCancelBooking && effectiveStatus !== 'cancelled' && effectiveStatus !== 'cancellation_pending' && (
          <button
            onClick={() => onCancelBooking(bookingId)}
            className="flex-1 py-2 px-3 rounded-lg border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">cancel</span>
            Cancel Booking
          </button>
        )}
      </div>
      {onCheckIn && effectiveStatus !== 'attended' && effectiveStatus !== 'cancelled' && 
        rosterData?.financialSummary && rosterData.financialSummary.grandTotal > 0 && !rosterData.financialSummary.allPaid && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-xs">info</span>
          Payment must be collected before check-in
        </p>
      )}
    </>
  );
}

export default BookingActions;
