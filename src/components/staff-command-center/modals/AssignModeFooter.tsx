import Icon from '../../icons/Icon';

interface AssignModeFooterProps {
  hasOwner: boolean;
  linking: boolean;
  feeEstimate: { totalCents: number; overageCents: number; guestCents: number } | null;
  isCalculatingFees: boolean;
  isConferenceRoom: boolean;
  onClose: () => void;
  handleFinalizeBooking: () => Promise<void>;
}

export function AssignModeFooter({
  hasOwner,
  linking,
  feeEstimate,
  isCalculatingFees,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isConferenceRoom,
  onClose,
  handleFinalizeBooking,
}: AssignModeFooterProps) {
  return (
    <div className="p-4 space-y-2">
      {feeEstimate && feeEstimate.totalCents > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon name="payments" className="text-amber-600 dark:text-amber-400 text-lg" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Estimated Fees</span>
            </div>
            <span className="text-lg font-bold text-amber-700 dark:text-amber-300">
              ${(feeEstimate.totalCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="mt-1 flex gap-4 text-xs text-amber-600 dark:text-amber-400">
            {feeEstimate.overageCents > 0 && (
              <span>Overage: ${(feeEstimate.overageCents / 100).toFixed(2)}</span>
            )}
            {feeEstimate.guestCents > 0 && (
              <span>Guest fees: ${(feeEstimate.guestCents / 100).toFixed(2)}</span>
            )}
          </div>
        </div>
      )}
      {isCalculatingFees && (
        <div className="mb-3 p-3 rounded-lg bg-gray-50 dark:bg-white/5 flex items-center justify-center gap-2 text-sm text-primary/50 dark:text-white/50">
          <Icon name="progress_activity" className="animate-spin text-sm" />
          Calculating fees...
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="tactile-btn flex-1 py-2.5 px-4 rounded-lg border border-gray-200 dark:border-white/20 text-primary dark:text-white font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleFinalizeBooking}
          disabled={!hasOwner || linking}
          className="tactile-btn flex-1 py-2.5 px-4 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white"
        >
          {linking ? (
            <>
              <Icon name="progress_activity" className="animate-spin text-sm" />
              Assigning...
            </>
          ) : (
            <>
              <Icon name="check_circle" className="text-sm" />
              Assign & Confirm
            </>
          )}
        </button>
      </div>
    </div>
  );
}
