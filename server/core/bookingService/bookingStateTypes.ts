export interface CancelResult {
  success: boolean;
  status: 'cancelled' | 'cancellation_pending';
  bookingId: number;
  bookingData: {
    userEmail: string;
    userName: string | null;
    resourceId: number | null;
    requestDate: string;
    startTime: string;
    durationMinutes: number | null;
    calendarEventId: string | null;
    sessionId: number | null;
    trackmanBookingId: string | null;
  };
  sideEffectErrors?: string[];
  alreadyCancelled?: boolean;
  isLateCancel?: boolean;
  error?: string;
  statusCode?: number;
}

export interface SideEffectsManifest {
  stripeRefunds: Array<{ paymentIntentId: string; type: 'refund' | 'cancel'; idempotencyKey: string; amountCents?: number }>;
  stripeSnapshotRefunds: Array<{ paymentIntentId: string; idempotencyKey: string; amountCents?: number }>;
  balanceRefunds: Array<{ stripeCustomerId: string; amountCents: number; bookingId: number; balanceRecordId: string; description: string }>;
  guestPassRefunds: Array<{ ownerEmail: string; guestDisplayName?: string }>;
  invoiceVoid: { bookingId: number } | null;
  calendarDeletion: { eventId: string; resourceId: number | null } | null;
  notifications: {
    staffNotification?: { title: string; message: string };
    memberNotification?: { userEmail: string; title: string; message: string; type: 'booking_cancelled' | 'cancellation_pending'; relatedId: number; relatedType: string };
    memberPush?: { email: string; title: string; body: string };
    memberWebSocket?: { email: string; title: string; message: string; bookingId: number };
  };
  trackmanSlotCleanup: { resourceId: number; slotDate: string; startTime: string; durationMinutes: number | null } | null;
  availabilityBroadcast: { resourceId?: number; resourceType: string; date: string } | null;
  bookingEvent: { bookingId: number; memberEmail: string; status: string; actionBy: string; bookingDate: string; startTime: string } | null;
}

export interface BookingRecord {
  id: number;
  userEmail: string;
  userName: string | null;
  resourceId: number | null;
  requestDate: string;
  startTime: string;
  durationMinutes: number | null;
  status: string | null;
  calendarEventId: string | null;
  sessionId: number | null;
  trackmanBookingId: string | null;
  staffNotes: string | null;
}

export interface FeeSnapshotRow {
  id: number;
  stripe_payment_intent_id: string;
  snapshot_status: string;
  total_cents: number;
}

export interface BalancePaymentRow {
  stripe_payment_intent_id: string;
  stripe_customer_id: string;
  amount_cents: number;
}
