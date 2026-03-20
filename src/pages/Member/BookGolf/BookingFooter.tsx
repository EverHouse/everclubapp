import React from 'react';
import { haptic } from '../../../utils/haptics';
import WalkingGolferSpinner from '../../../components/WalkingGolferSpinner';
import FeeBreakdownCard from '../../../components/shared/FeeBreakdownCard';
import Icon from '../../../components/icons/Icon';

interface BookingFooterProps {
  canBook: boolean;
  isBooking: boolean;
  isDark: boolean;
  activeTab: 'simulator' | 'conference';
  conferencePaymentRequired: boolean;
  conferenceOverageFee: number;
  handleConfirm: () => void;
  estimatedFees: {
    overageFee: number;
    overageMinutes: number;
    guestFees: number;
    guestsCharged: number;
    guestsUsingPasses: number;
    guestFeePerUnit: number;
    totalFee: number;
    passesRemainingAfter: number;
  };
  guestFeeDollars: number;
  guestPassInfo: { passes_remaining: number; passes_total: number } | undefined;
  effectiveUserTier: string | undefined;
  requestButtonRef: React.RefObject<HTMLDivElement | null>;
  feeRef: (el: HTMLElement | null) => void;
}

const BookingFooter: React.FC<BookingFooterProps> = ({
  canBook, isBooking, isDark, activeTab, conferencePaymentRequired, conferenceOverageFee,
  handleConfirm, estimatedFees, guestFeeDollars, guestPassInfo, effectiveUserTier,
  requestButtonRef, feeRef,
}) => {
  return (
    <>
      {canBook && (
        <div ref={requestButtonRef} className="fixed bottom-24 left-0 right-0 z-20 px-4 sm:px-6 flex flex-col items-center w-full max-w-lg sm:max-w-xl lg:max-w-2xl mx-auto animate-in slide-in-from-bottom-4 duration-normal gap-2">
          <div ref={feeRef} className="w-full flex flex-col gap-2">
            {activeTab === 'conference' && conferencePaymentRequired && conferenceOverageFee > 0 && (
              <div className={`w-full px-3 sm:px-4 py-3 rounded-xl backdrop-blur-md border flex items-start gap-3 ${isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
                <Icon name="payments" className={`text-lg flex-shrink-0 mt-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                      Overage Fee: ${(conferenceOverageFee / 100).toFixed(2)}
                    </span>
                  </div>
                  <p className={`text-xs ${isDark ? 'text-white/60' : 'text-primary/60'}`}>
                    This booking exceeds your daily allowance. Your account credit will be charged automatically when you book.
                  </p>
                </div>
              </div>
            )}
            {activeTab === 'conference' && (
              <FeeBreakdownCard
                overageFee={estimatedFees.overageFee}
                overageMinutes={estimatedFees.overageMinutes}
                guestFees={estimatedFees.guestFees}
                guestsCharged={estimatedFees.guestsCharged}
                guestsUsingPasses={estimatedFees.guestsUsingPasses}
                guestFeePerUnit={estimatedFees.guestFeePerUnit || guestFeeDollars}
                totalFee={estimatedFees.totalFee}
                passesRemainingAfter={guestPassInfo ? estimatedFees.passesRemainingAfter : undefined}
                passesTotal={guestPassInfo?.passes_total}
                tierLabel={effectiveUserTier}
                resourceType="conference"
                isDark={isDark}
              />
            )}
          </div>
          <button
            onClick={() => { haptic.heavy(); handleConfirm(); }}
            disabled={isBooking}
            className="w-full py-4 rounded-xl font-bold text-lg shadow-glow transition-all duration-fast flex items-center justify-center gap-2 bg-accent text-primary hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 focus:ring-2 focus:ring-white focus:outline-none"
          >
            {isBooking ? (
              <><WalkingGolferSpinner size="sm" /><span>Booking...</span></>
            ) : activeTab === 'conference' && conferencePaymentRequired ? (
              <><Icon name="payments" className="text-xl" /><span>Book & Pay ${(conferenceOverageFee / 100).toFixed(2)}</span></>
            ) : activeTab === 'conference' ? (
              <><span>Book Conference Room</span><Icon name="arrow_forward" className="text-xl" /></>
            ) : (
              <><span>Request Booking</span><Icon name="arrow_forward" className="text-xl" /></>
            )}
          </button>
        </div>
      )}

    </>
  );
};

export default BookingFooter;
