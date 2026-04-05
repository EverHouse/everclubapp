import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { RedemptionSuccess } from './types';
import { formatPassType } from './types';
import { springPresets } from '../../../../utils/motion';
import Icon from '../../../icons/Icon';

interface RedemptionSuccessCardProps {
  redemptionSuccess: RedemptionSuccess;
  onBookGuest?: (guestInfo: { email: string; firstName: string; lastName: string }) => void;
  onClose?: () => void;
  onReset: () => void;
}

const RedemptionSuccessCard: React.FC<RedemptionSuccessCardProps> = ({
  redemptionSuccess,
  onBookGuest,
  onClose,
  onReset,
}) => {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : springPresets.snappy}
      className="p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 dark:bg-green-800/40 flex items-center justify-center">
          <Icon name="check_circle" className="text-2xl text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-green-900 dark:text-green-100 text-lg">Guest Checked In!</h3>
          <p className="text-sm text-green-700 dark:text-green-300 mt-0.5">
            Confirmation email sent with WiFi details
          </p>
        </div>
      </div>
      
      <div className="bg-white dark:bg-black/20 rounded-xl p-4 border border-green-200 dark:border-green-700/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 dark:bg-white/10 flex items-center justify-center">
            <Icon name="person" className="text-primary dark:text-white" />
          </div>
          <div>
            <p className="font-medium text-primary dark:text-white">{redemptionSuccess.passHolder.name || 'Guest'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{redemptionSuccess.passHolder.email}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">{formatPassType(redemptionSuccess.passHolder.productType)}</span>
          <span className="font-medium text-primary dark:text-white">
            {redemptionSuccess.remainingUses} {redemptionSuccess.remainingUses === 1 ? 'use' : 'uses'} remaining
          </span>
        </div>
      </div>
      
      <div className="flex gap-2">
        {onBookGuest && (
          <button
            onClick={() => {
              onBookGuest({
                email: redemptionSuccess.passHolder.email,
                firstName: redemptionSuccess.passHolder.firstName,
                lastName: redemptionSuccess.passHolder.lastName,
              });
              onReset();
              if (onClose) onClose();
            }}
            className="flex-1 py-3 px-4 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="golf_course" className="text-lg" />
            Book Golf for Guest
          </button>
        )}
        <button
          onClick={onReset}
          className={`${onBookGuest ? 'px-4' : 'flex-1'} py-3 rounded-xl bg-green-100 dark:bg-green-800/40 text-green-900 dark:text-green-100 font-medium hover:bg-green-200 dark:hover:bg-green-800/60 transition-colors flex items-center justify-center gap-2`}
        >
          <Icon name="done" className="text-lg" />
          Done
        </button>
      </div>
    </motion.div>
  );
};

export default RedemptionSuccessCard;
