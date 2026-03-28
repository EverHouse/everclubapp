export {
  getStripeDeclineMessage,
  describeFee,
  finalizeInvoiceWithPi,
  retrieveInvoicePaymentIntent,
  handleExistingInvoicePayment,
} from '../../../core/billing/paymentTypes';

export type {
  BookingRow,
  ParticipantRow,
  SnapshotRow,
  IdRow,
  StripeInvoiceExpanded,
  FinalizeResult,
} from '../../../core/billing/paymentTypes';

export interface UserRow {
  id: string;
  stripe_customer_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

export interface StripeCustomerIdRow {
  stripe_customer_id: string | null;
}

export interface BalanceParticipantRow {
  participant_id: number;
  session_id: number;
  participant_type: string;
  display_name: string | null;
  payment_status: string | null;
  cached_fee_cents: number;
  session_date: string;
  start_time: string;
  end_time: string;
  resource_name: string | null;
  ledger_fee: string;
  owner_email?: string;
}

export interface GuestBalanceRow {
  participant_id: number;
  session_id: number;
  participant_type: string;
  display_name: string | null;
  payment_status: string | null;
  cached_fee_cents: number;
  session_date: string;
  start_time: string;
  end_time: string;
  resource_name: string | null;
  owner_email: string;
}

export interface UncachedSessionRow {
  session_id: number;
}

export interface SessionDataRow {
  session_date: string;
  resource_name: string | null;
  participant_type: string | null;
  display_name: string | null;
}

export interface UnfilledRow {
  session_id: number;
  session_date: string;
  start_time: string;
  end_time: string;
  resource_name: string | null;
  declared_player_count: string;
  non_owner_count: string;
}

export interface BalancePayParticipantRow {
  participant_id: number;
  session_id: number;
  cached_fee_cents: number;
  ledger_fee: string;
  pending_snapshot_count: string;
  total_snapshot_count: string;
}

export interface BalancePayGuestRow {
  participant_id: number;
  session_id: number;
  cached_fee_cents: number;
  pending_snapshot_count: string;
  total_snapshot_count: string;
}
