export interface GuestHistoryItem {
  id: number;
  guestName: string | null;
  guestEmail: string | null;
  visitDate: string;
  startTime: string;
  resourceName: string | null;
}

export interface GuestCheckInItem {
  id: number;
  guestName: string | null;
  checkInDate: string;
}

export interface MemberBillingTabProps {
  memberEmail: string;
  memberId?: string;
  currentTier?: string;
  onTierUpdate?: (tier: string) => void;
  onMemberUpdated?: () => void;
  onDrawerClose?: () => void;
  guestPassInfo?: { remainingPasses: number; totalUsed: number } | null;
  guestHistory?: GuestHistoryItem[];
  guestCheckInsHistory?: GuestCheckInItem[];
}

export interface Subscription {
  id: string;
  status: string;
  planName?: string;
  planAmount?: number;
  currency?: string;
  interval?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  isPaused?: boolean;
  pausedUntil?: string | null;
  discount?: {
    id: string;
    coupon: {
      id: string;
      name?: string;
      percentOff?: number;
      amountOff?: number;
    };
  } | null;
}

export interface PaymentMethod {
  id: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export interface Invoice {
  id: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
}

export interface FamilyGroup {
  id: number;
  primaryEmail: string;
  primaryName?: string;
  groupName?: string;
  members?: {
    id: number;
    memberEmail: string;
    memberName: string;
    addOnPriceCents: number;
  }[];
}

export interface BillingInfo {
  email: string;
  firstName?: string;
  lastName?: string;
  billingProvider: 'stripe' | 'mindbody' | 'family_addon' | 'comped' | null;
  stripeCustomerId?: string;
  mindbodyClientId?: string;
  hubspotId?: string;
  tier?: string;
  subscriptions?: Subscription[];
  activeSubscription?: Subscription | null;
  paymentMethods?: PaymentMethod[];
  recentInvoices?: Invoice[];
  customerBalance?: number;
  familyGroup?: FamilyGroup | null;
  stripeError?: string;
  familyError?: string;
  billingMigrationRequestedAt?: string;
  migrationStatus?: string | null;
  migrationBillingStartDate?: string | null;
  migrationRequestedBy?: string | null;
  migrationTierSnapshot?: string | null;
  membershipStatus?: string | null;
  subscriptionCreatedBy?: string;
  subscriptionCreatedAt?: string | null;
}

export interface OutstandingData {
  totalOutstandingCents: number;
  totalOutstandingDollars: number;
  items: Array<{
    bookingId: number;
    trackmanBookingId: string | null;
    bookingDate: string;
    startTime: string;
    endTime: string;
    resourceName: string;
    participantId: number;
    participantType: string;
    displayName: string;
    feeCents: number;
    feeDollars: number;
    feeLabel: string;
  }>;
}

export interface MigrationEligibility {
  hasCardOnFile: boolean;
  tierHasStripePrice: boolean;
  cardOnFile?: { brand?: string; last4?: string } | null;
}

export interface CouponOption {
  id: string;
  name: string;
  percentOff: number | null;
  amountOff: number | null;
  duration: string;
}

export const BILLING_PROVIDERS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'mindbody', label: 'Mindbody' },
  { value: 'family_addon', label: 'Family Add-on' },
  { value: 'comped', label: 'Comped' },
];

export const formatDatePacific = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  try {
    const normalizedDate = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
    const d = new Date(normalizedDate);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch {
    return '\u2014';
  }
};

export const formatTime12Hour = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.substring(0, 5).split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
};

