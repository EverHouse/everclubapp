import React from 'react';
import MemberBillingTab from '../admin/MemberBillingTab';
import type { GuestVisit } from './memberProfileTypes';

interface BillingTabProps {
  memberEmail: string;
  memberId: any;
  displayedTier: string;
  onTierUpdate: (newTier: string) => void;
  guestPassInfo: any | null;
  guestHistory: GuestVisit[];
  guestCheckInsHistory: any[];
  purchases: any[];
}

const BillingTab: React.FC<BillingTabProps> = ({
  memberEmail,
  memberId,
  displayedTier,
  onTierUpdate,
  guestPassInfo,
  guestHistory,
  guestCheckInsHistory,
  purchases,
}) => {
  return (
    <div className="space-y-4">
      <div 
        className="animate-slide-up-stagger"
        style={{ '--stagger-index': 0 } as React.CSSProperties}
      >
        <MemberBillingTab 
          memberEmail={memberEmail} 
          memberId={memberId} 
          currentTier={displayedTier}
          onTierUpdate={onTierUpdate}
          guestPassInfo={guestPassInfo}
          guestHistory={guestHistory}
          guestCheckInsHistory={guestCheckInsHistory}
          purchases={purchases}
        />
      </div>
    </div>
  );
};

export default BillingTab;
