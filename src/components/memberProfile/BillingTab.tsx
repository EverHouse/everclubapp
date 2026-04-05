import type { GuestPassInfo, GuestCheckInItem } from './memberProfileTypes';
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import MemberBillingTab from '../admin/MemberBillingTab';
import { springPresets } from '../../utils/motion';
import type { GuestVisit } from './memberProfileTypes';

interface BillingTabProps {
  memberEmail: string;
  memberId: string | number;
  displayedTier: string;
  onTierUpdate: (newTier: string) => void;
  onMemberUpdated?: () => void;
  onDrawerClose?: () => void;
  guestPassInfo: GuestPassInfo | null;
  guestHistory: GuestVisit[];
  guestCheckInsHistory: GuestCheckInItem[];
}

const BillingTab: React.FC<BillingTabProps> = ({
  memberEmail,
  memberId,
  displayedTier,
  onTierUpdate,
  onMemberUpdated,
  onDrawerClose,
  guestPassInfo,
  guestHistory,
  guestCheckInsHistory,
}) => {
  const prefersReduced = useReducedMotion();
  return (
    <div className="space-y-4">
      <motion.div 
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={prefersReduced ? { duration: 0 } : springPresets.gentle}
      >
        <MemberBillingTab 
          memberEmail={memberEmail} 
          memberId={String(memberId)} 
          currentTier={displayedTier}
          onTierUpdate={onTierUpdate}
          onMemberUpdated={onMemberUpdated}
          onDrawerClose={onDrawerClose}
          guestPassInfo={guestPassInfo ? { remainingPasses: guestPassInfo.remainingPasses, totalUsed: guestPassInfo.usedPasses } : undefined}
          guestHistory={guestHistory}
          guestCheckInsHistory={guestCheckInsHistory.map(c => ({ id: c.id, guestName: c.guest_name ?? null, checkInDate: c.check_in_date }))}
        />
      </motion.div>
    </div>
  );
};

export default BillingTab;
