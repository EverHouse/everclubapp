import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import Icon from '../../icons/Icon';
import { springPresets, noMotion } from '../../../utils/motion';

const buttonTap = { scale: 0.97 };
const buttonSpring = springPresets.buttonPress;

const feeVariants = {
  initial: { opacity: 0, scaleY: 0 },
  animate: { opacity: 1, scaleY: 1, transition: springPresets.ease },
  exit: { opacity: 0, scaleY: 0, transition: { duration: 0.2 } },
};

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
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="p-4 space-y-2">
      <AnimatePresence mode="wait">
        {feeEstimate && feeEstimate.totalCents > 0 && (
          <motion.div
            key="fee-estimate"
            variants={feeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            {...(prefersReducedMotion ? { transition: noMotion } : {})}
            style={{ transformOrigin: 'top center' }}
            className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 overflow-hidden"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {isCalculatingFees && (
          <motion.div
            key="calculating"
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0 }}
            style={{ transformOrigin: 'top center' }}
            className="mb-3 p-3 rounded-lg bg-gray-50 dark:bg-white/5 flex items-center justify-center gap-2 text-sm text-primary/50 dark:text-white/50 overflow-hidden"
          >
            <Icon name="progress_activity" className="animate-spin text-sm" />
            Calculating fees...
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex gap-3">
        <motion.button
          whileTap={prefersReducedMotion ? undefined : buttonTap}
          transition={prefersReducedMotion ? noMotion : buttonSpring}
          onClick={onClose}
          className="tactile-btn flex-1 py-2.5 px-4 rounded-lg border border-gray-200 dark:border-white/20 text-primary dark:text-white font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          Cancel
        </motion.button>
        <motion.button
          whileTap={!hasOwner || linking || prefersReducedMotion ? undefined : buttonTap}
          transition={prefersReducedMotion ? noMotion : buttonSpring}
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
        </motion.button>
      </div>
    </div>
  );
}
