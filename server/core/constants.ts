export const BOOKING_STATUS = {
  PENDING: 'pending',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  CONFIRMED: 'confirmed',
  ATTENDED: 'attended',
  CANCELLED: 'cancelled',
  DECLINED: 'declined',
  CANCELLATION_PENDING: 'cancellation_pending',
} as const;

export const ACTIVE_BOOKING_STATUSES = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.APPROVED,
  BOOKING_STATUS.CONFIRMED,
] as const;

export const CONFIRMED_BOOKING_STATUSES = [
  BOOKING_STATUS.APPROVED,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.ATTENDED,
] as const;

export const PAYMENT_PURPOSE = {
  GUEST_FEE: 'guest_fee',
  OVERAGE_FEE: 'overage_fee',
  ONE_TIME_PURCHASE: 'one_time_purchase',
  BOOKING_FEE: 'booking_fee',
  PREPAYMENT: 'prepayment',
} as const;

export const VALID_PAYMENT_PURPOSES = [
  PAYMENT_PURPOSE.GUEST_FEE,
  PAYMENT_PURPOSE.OVERAGE_FEE,
  PAYMENT_PURPOSE.ONE_TIME_PURCHASE,
] as const;

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  REQUIRES_PAYMENT_METHOD: 'requires_payment_method',
  REQUIRES_ACTION: 'requires_action',
  REQUIRES_CONFIRMATION: 'requires_confirmation',
  SUCCEEDED: 'succeeded',
  CANCELED: 'canceled',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
} as const;

export const STALE_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.REQUIRES_PAYMENT_METHOD,
  PAYMENT_STATUS.REQUIRES_ACTION,
  PAYMENT_STATUS.REQUIRES_CONFIRMATION,
] as const;

export const RETRYABLE_PAYMENT_STATUSES = [
  PAYMENT_STATUS.REQUIRES_PAYMENT_METHOD,
  PAYMENT_STATUS.REQUIRES_CONFIRMATION,
  PAYMENT_STATUS.REQUIRES_ACTION,
] as const;

export const PARTICIPANT_PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  WAIVED: 'waived',
  REFUNDED: 'refunded',
} as const;

export const MIN_CHARGE_CENTS = 50;
export const MAX_CHARGE_CENTS = 99_999_999;
export const MAX_DURATION_MINUTES = 480;
export const MAX_QUERY_LIMIT = 500;
export const MIDNIGHT_HOUR = 24;
export const STALE_SNAPSHOT_MINUTES = 30;
export const LATE_CANCEL_HOURS = 1;
export const UNLIMITED_TIER_THRESHOLD = 999;
export const MAX_PARTICIPANTS_PER_BOOKING = 3;
export const CLEANUP_BATCH_LIMIT = 25;
export const CLEANUP_PARALLEL_CHUNK_SIZE = 5;
export const MAX_CLEANUP_LIMIT = 100;
export const STRIPE_METADATA_MAX_LENGTH = 490;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;
