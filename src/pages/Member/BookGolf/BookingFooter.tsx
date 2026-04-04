import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import MotionButton from '../../../components/ui/MotionButton';
import WalkingGolferSpinner from '../../../components/WalkingGolferSpinner';
import FeeBreakdownCard from '../../../components/shared/FeeBreakdownCard';
import Icon from '../../../components/icons/Icon';

const feeSpring = { type: 'spring' as const, stiffness: 400, damping: 28, mass: 0.8 };
const instantTransition = { duration: 0 };

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
  dailySimMinutes?: number;
  requestButtonRef: React.RefObject<HTMLDivElement | null>;
  feeRef: React.RefObject<HTMLDivElement | null>;
}

const BookingFooter: React.FC<BookingFooterProps> = ({
  canBook, isBooking, isDark, activeTab, conferencePaymentRequired, conferenceOverageFee,
  handleConfirm, estimatedFees, guestFeeDollars, guestPassInfo, effectiveUserTier,
  dailySimMinutes, requestButtonRef, feeRef,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const feeReveal = {
    initial: { height: 0, y: prefersReducedMotion ? 0 : 16, scale: prefersReducedMotion ? 1 : 0.97 },
    animate: { height: 'auto', y: 0, scale: 1 },
    exit: { height: 0, y: prefersReducedMotion ? 0 : -8, scale: prefersReducedMotion ? 1 : 0.97 },
    transition: prefersReducedMotion ? instantTransition : feeSpring,
  };

  return (
    <>
      {canBook && (
        <div ref={requestButtonRef} className="fixed bottom-24 left-0 right-0 z-20 px-4 sm:px-6 flex flex-col items-center w-full max-w-lg sm:max-w-xl lg:max-w-2xl mx-auto animate-in slide-in-from-bottom-4 duration-normal gap-2">
          <div ref={feeRef} className="w-full flex flex-col gap-2">
            <AnimatePresence>
              {activeTab === 'conference' && conferencePaymentRequired && conferenceOverageFee > 0 && (
                <motion.div key="overage-fee" {...feeReveal} className={`overflow-hidden w-full px-3 sm:px-4 py-3 rounded-xl backdrop-blur-md border flex items-start gap-3 ${isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
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
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {activeTab === 'conference' && (
                <motion.div key="fee-breakdown" {...feeReveal} className="overflow-hidden">
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
                    hasDailyAllowance={dailySimMinutes !== undefined && dailySimMinutes > 0}
                    resourceType="conference"
                    isDark={isDark}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <MotionButton
            hapticType="heavy"
            onClick={handleConfirm}
            disabled={isBooking}
            className="w-full py-4 rounded-xl font-bold text-lg shadow-glow flex items-center justify-center gap-2 bg-accent text-primary disabled:opacity-50 focus:ring-2 focus:ring-white focus:outline-none"
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
          </MotionButton>
        </div>
      )}

    </>
  );
};

export default BookingFooter;
