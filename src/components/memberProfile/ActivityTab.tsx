import React from 'react';
import MemberActivityTab from '../admin/MemberActivityTab';

interface ActivityTabProps {
  memberEmail: string;
  filteredBookingHistory: any[];
  filteredBookingRequestsHistory: any[];
  eventRsvpHistory: any[];
  wellnessHistory: any[];
  visitHistory: any[];
}

const ActivityTab: React.FC<ActivityTabProps> = ({
  memberEmail,
  filteredBookingHistory,
  filteredBookingRequestsHistory,
  eventRsvpHistory,
  wellnessHistory,
  visitHistory,
}) => {
  return (
    <div 
      className="animate-slide-up-stagger"
      style={{ '--stagger-index': 0 } as React.CSSProperties}
    >
      <MemberActivityTab
        memberEmail={memberEmail}
        bookingHistory={filteredBookingHistory}
        bookingRequestsHistory={filteredBookingRequestsHistory}
        eventRsvpHistory={eventRsvpHistory}
        wellnessHistory={wellnessHistory}
        visitHistory={visitHistory}
      />
    </div>
  );
};

export default ActivityTab;
