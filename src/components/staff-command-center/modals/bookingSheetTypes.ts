export interface BookingMember {
  id: number;
  bookingId: number;
  userEmail: string | null;
  slotNumber: number;
  isPrimary: boolean;
  linkedAt: string | null;
  linkedBy: string | null;
  memberName: string;
  tier: string | null;
  membershipStatus?: string | null;
  isStaff?: boolean;
  fee: number;
  feeNote: string;
  guestInfo?: { guestId: number; guestName: string; guestEmail: string; fee: number; feeNote: string; usedGuestPass: boolean } | null;
}

export interface BookingGuest {
  id: number;
  bookingId: number;
  guestName: string | null;
  guestEmail: string | null;
  slotNumber: number;
  fee: number;
  feeNote: string;
}

export interface ValidationInfo {
  expectedPlayerCount: number;
  actualPlayerCount: number;
  filledMemberSlots: number;
  guestCount: number;
  playerCountMismatch: boolean;
  emptySlots: number;
}

export interface FinancialSummary {
  ownerOverageFee: number;
  guestFeesWithoutPass: number;
  totalOwnerOwes: number;
  totalPlayersOwe: number;
  grandTotal: number;
  playerBreakdown: Array<{ name: string; tier: string | null; fee: number; feeNote: string; membershipStatus?: string | null }>;
  allPaid?: boolean;
}

export interface BookingContextType {
  requestDate?: string;
  startTime?: string;
  endTime?: string;
  resourceId?: number;
  resourceName?: string;
  durationMinutes?: number;
  notes?: string;
  trackmanCustomerNotes?: string;
}

export interface ManageModeRosterData {
  members: BookingMember[];
  guests: BookingGuest[];
  validation: ValidationInfo;
  ownerGuestPassesRemaining: number;
  tierLimits?: { guest_passes_per_month: number };
  guestPassContext?: { passesBeforeBooking: number; passesUsedThisBooking: number };
  financialSummary?: FinancialSummary;
  bookingNotes?: { notes: string | null; staffNotes: string | null; trackmanNotes: string | null };
  sessionId?: number;
  ownerId?: string;
  isOwnerStaff?: boolean;
}

export interface MemberMatchWarning {
  slotNumber: number;
  guestData: { guestName: string; guestEmail: string; guestPhone?: string };
  memberMatch: { email: string; name: string; tier: string; status: string; note: string };
}

export interface FetchedContext {
  bayName?: string;
  bookingDate?: string;
  timeSlot?: string;
  trackmanBookingId?: string;
  bookingStatus?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerUserId?: string;
  durationMinutes?: number;
  resourceId?: number;
  notes?: string;
}

export const isPlaceholderEmail = (email: string): boolean => {
  if (!email) return true;
  const lower = email.toLowerCase();
  return lower.includes('@visitors.evenhouse.club') || 
         lower.includes('@trackman.local') || 
         lower.startsWith('classpass-') ||
         lower.startsWith('golfnow-') ||
         lower.startsWith('lesson-') ||
         lower.startsWith('unmatched-');
};
