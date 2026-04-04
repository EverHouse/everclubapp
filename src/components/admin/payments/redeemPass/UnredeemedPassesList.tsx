import React from 'react';
import WalkingGolferSpinner from '../../../WalkingGolferSpinner';
import type { UnredeemedPass } from './types';
import { formatPassType } from './types';
import Icon from '../../../icons/Icon';

interface UnredeemedPassesListProps {
  unredeemedPasses: UnredeemedPass[];
  isLoadingUnredeemed: boolean;
  showUnredeemedSection: boolean;
  confirmingRefundId: string | null;
  refundingId: string | null;
  redeemingId: string | null;
  formatDate: (dateStr: string) => string;
  handleRedeem: (passId: string) => void;
  handleRefund: (passId: string) => void;
  setConfirmingRefundId: (id: string | null) => void;
  setShowUnredeemedSection: (show: boolean) => void;
}

const UnredeemedPassesList: React.FC<UnredeemedPassesListProps> = ({
  unredeemedPasses,
  isLoadingUnredeemed,
  showUnredeemedSection,
  confirmingRefundId,
  refundingId,
  redeemingId,
  formatDate,
  handleRedeem,
  handleRefund,
  setConfirmingRefundId,
  setShowUnredeemedSection,
}) => {
  if (!showUnredeemedSection) return null;

  return (
    <div className="mt-6 pt-4 border-t border-primary/10 dark:border-white/10">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon name="local_activity" className="text-amber-600 dark:text-amber-400" />
          <h4 className="font-semibold text-primary dark:text-white">Recent Unredeemed Passes</h4>
          {unredeemedPasses.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full">
              {unredeemedPasses.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowUnredeemedSection(false)}
          className="p-1.5 hover:bg-primary/10 dark:hover:bg-white/10 rounded-lg transition-colors"
          title="Hide section"
        >
          <Icon name="close" className="text-sm text-primary/40 dark:text-white/40" />
        </button>
      </div>
      
      {isLoadingUnredeemed ? (
        <div className="flex items-center justify-center py-6">
          <WalkingGolferSpinner size="sm" variant="auto" />
        </div>
      ) : unredeemedPasses.length === 0 ? (
        <div className="flex flex-col items-center text-center py-6">
          <Icon name="local_activity" className="text-3xl text-primary/20 dark:text-white/20 mb-2" />
          <p className="text-sm text-primary/50 dark:text-white/50">No unredeemed passes</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {unredeemedPasses.map(pass => {
            const guestName = [pass.purchaserFirstName, pass.purchaserLastName].filter(Boolean).join(' ');
            return (
              <div
                key={pass.id}
                className="p-3 rounded-xl bg-white/50 dark:bg-white/5 border border-primary/10 dark:border-white/10 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm text-primary dark:text-white truncate">
                      {guestName || pass.purchaserEmail}
                    </p>
                    <span className="px-2 py-0.5 text-xs font-medium bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-full flex-shrink-0">
                      {pass.remainingUses} left
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-primary/60 dark:text-white/60 truncate">
                      {formatPassType(pass.productType)}
                    </p>
                    <span className="text-xs text-primary/40 dark:text-white/40">•</span>
                    <p className="text-xs text-primary/40 dark:text-white/40 flex-shrink-0">
                      {formatDate(pass.purchasedAt)}
                    </p>
                  </div>
                  {guestName && (
                    <p className="text-xs text-primary/40 dark:text-white/40 truncate">{pass.purchaserEmail}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {confirmingRefundId === pass.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRefund(pass.id)}
                        disabled={refundingId === pass.id}
                        className="px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {refundingId === pass.id ? (
                          <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                        ) : (
                          <Icon name="check" className="text-sm" />
                        )}
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmingRefundId(null)}
                        className="px-2 py-1.5 rounded-lg bg-primary/10 dark:bg-white/10 text-primary dark:text-white text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setConfirmingRefundId(pass.id)}
                        disabled={redeemingId === pass.id || refundingId === pass.id}
                        className="px-2 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        title="Refund this pass"
                      >
                        <Icon name="undo" className="text-sm" />
                        Refund
                      </button>
                      <button
                        onClick={() => handleRedeem(pass.id)}
                        disabled={redeemingId === pass.id}
                        className="px-3 py-1.5 rounded-lg bg-teal-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {redeemingId === pass.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        ) : (
                          <Icon name="check" className="text-base" />
                        )}
                        Redeem
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UnredeemedPassesList;
