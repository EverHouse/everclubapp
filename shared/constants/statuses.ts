export const BOOKING_STATUS = {
  PENDING: 'pending',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  CANCELLATION_PENDING: 'cancellation_pending',
  ATTENDED: 'attended',
  NO_SHOW: 'no_show',
  CHECKED_IN: 'checked_in',
} as const;

export type BookingStatus = typeof BOOKING_STATUS[keyof typeof BOOKING_STATUS];

export const BOOKING_STATUSES: BookingStatus[] = Object.values(BOOKING_STATUS);

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.PENDING_APPROVAL,
  BOOKING_STATUS.APPROVED,
  BOOKING_STATUS.CONFIRMED,
];
export const COMPLETED_BOOKING_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.ATTENDED,
  BOOKING_STATUS.CHECKED_IN,
];
export const CANCELLED_BOOKING_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.DECLINED,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.CANCELLATION_PENDING,
  BOOKING_STATUS.NO_SHOW,
];
export const TERMINAL_BOOKING_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.DECLINED,
  BOOKING_STATUS.CANCELLATION_PENDING,
];

export const MEMBERSHIP_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  GRACE_PERIOD: 'grace_period',
  PAUSED: 'paused',
  PENDING: 'pending',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  INACTIVE: 'inactive',
  EXPIRED: 'expired',
  TERMINATED: 'terminated',
  FROZEN: 'frozen',
  FORMER_MEMBER: 'former_member',
  NON_MEMBER: 'non-member',
  ARCHIVED: 'archived',
  MERGED: 'merged',
  UNPAID: 'unpaid',
  UNKNOWN: 'unknown',
} as const;

export type MembershipStatus = typeof MEMBERSHIP_STATUS[keyof typeof MEMBERSHIP_STATUS];

export const ACTIVE_MEMBERSHIP_STATUSES: MembershipStatus[] = [
  MEMBERSHIP_STATUS.ACTIVE,
  MEMBERSHIP_STATUS.TRIALING,
  MEMBERSHIP_STATUS.PAST_DUE,
];

export const FORMER_MEMBERSHIP_STATUSES: MembershipStatus[] = [
  MEMBERSHIP_STATUS.TERMINATED,
  MEMBERSHIP_STATUS.EXPIRED,
  MEMBERSHIP_STATUS.SUSPENDED,
  MEMBERSHIP_STATUS.CANCELLED,
  MEMBERSHIP_STATUS.FROZEN,
  MEMBERSHIP_STATUS.INACTIVE,
  MEMBERSHIP_STATUS.FORMER_MEMBER,
];

export const INACTIVE_MEMBERSHIP_STATUSES: MembershipStatus[] = [
  MEMBERSHIP_STATUS.CANCELLED,
  MEMBERSHIP_STATUS.SUSPENDED,
  MEMBERSHIP_STATUS.INACTIVE,
  MEMBERSHIP_STATUS.UNPAID,
  MEMBERSHIP_STATUS.TERMINATED,
  MEMBERSHIP_STATUS.PAUSED,
];

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  WAIVED: 'waived',
} as const;

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

export const PARTICIPANT_TYPE = {
  OWNER: 'owner',
  MEMBER: 'member',
  GUEST: 'guest',
} as const;

export type ParticipantType = typeof PARTICIPANT_TYPE[keyof typeof PARTICIPANT_TYPE];

export const RESOURCE_TYPE = {
  GOLF_SIMULATOR: 'golf_simulator',
  SIMULATOR: 'simulator',
  CONFERENCE_ROOM: 'conference_room',
} as const;

export type ResourceType = typeof RESOURCE_TYPE[keyof typeof RESOURCE_TYPE];

export const RECONCILIATION_STATUS = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  ADJUSTED: 'adjusted',
} as const;

export type ReconciliationStatus = typeof RECONCILIATION_STATUS[keyof typeof RECONCILIATION_STATUS];

export const NOTIFICATION_TYPES = [
  'booking',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'booking_reminder',
  'event',
  'event_reminder',
  'announcement',
  'guest_pass',
  'wellness',
  'system',
  'welcome'
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export const RSVP_STATUSES = [
  'confirmed',
  'cancelled',
  'waitlisted'
] as const;

export type RSVPStatus = typeof RSVP_STATUSES[number];

export const EVENT_CATEGORIES = [
  'Social',
  'Golf',
  'Wellness',
  'Business',
  'Member',
  'Community'
] as const;

export type EventCategory = typeof EVENT_CATEGORIES[number];

export const USER_ROLES = ['member', 'staff', 'admin'] as const;
export type UserRole = typeof USER_ROLES[number];

export const TOUR_STATUS = {
  SCHEDULED: 'scheduled',
  PENDING: 'pending',
  CHECKED_IN: 'checked_in',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const;

export type TourStatus = typeof TOUR_STATUS[keyof typeof TOUR_STATUS];

export const INVITE_STATUS = {
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type InviteStatus = typeof INVITE_STATUS[keyof typeof INVITE_STATUS];

export const MIGRATION_STATUS = {
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
} as const;

export type MigrationStatus = typeof MIGRATION_STATUS[keyof typeof MIGRATION_STATUS];

export const FEE_SNAPSHOT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  REQUIRES_ACTION: 'requires_action',
  PAID: 'paid',
  CREDIT_ADJUSTED: 'credit_adjusted',
} as const;

export type FeeSnapshotStatus = typeof FEE_SNAPSHOT_STATUS[keyof typeof FEE_SNAPSHOT_STATUS];

export const DAY_PASS_STATUS = {
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
} as const;

export type DayPassStatus = typeof DAY_PASS_STATUS[keyof typeof DAY_PASS_STATUS];

export const CONFERENCE_PREPAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
} as const;

export type ConferencePrepaymentStatus = typeof CONFERENCE_PREPAYMENT_STATUS[keyof typeof CONFERENCE_PREPAYMENT_STATUS];

export const TERMINAL_PAYMENT_STATUS = {
  SUCCEEDED: 'succeeded',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
  CANCELED: 'canceled',
} as const;

export type TerminalPaymentStatus = typeof TERMINAL_PAYMENT_STATUS[keyof typeof TERMINAL_PAYMENT_STATUS];

export const STRIPE_PAYMENT_INTENT_STATUS = {
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
  CANCELLED: 'cancelled',
  REQUIRES_ACTION: 'requires_action',
  REQUIRES_PAYMENT_METHOD: 'requires_payment_method',
  REFUNDED: 'refunded',
  REFUNDING: 'refunding',
} as const;

export type StripePaymentIntentStatus = typeof STRIPE_PAYMENT_INTENT_STATUS[keyof typeof STRIPE_PAYMENT_INTENT_STATUS];

export const HUBSPOT_PAYMENT_STATUS = {
  CURRENT: 'current',
  OVERDUE: 'overdue',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
} as const;

export type HubspotPaymentStatus = typeof HUBSPOT_PAYMENT_STATUS[keyof typeof HUBSPOT_PAYMENT_STATUS];

export const HUBSPOT_LINE_ITEM_STATUS = {
  PENDING: 'pending',
  SYNCED: 'synced',
  ERROR: 'error',
} as const;

export type HubspotLineItemStatus = typeof HUBSPOT_LINE_ITEM_STATUS[keyof typeof HUBSPOT_LINE_ITEM_STATUS];

export const FORM_SUBMISSION_STATUS = {
  NEW: 'new',
  REVIEWED: 'reviewed',
  CONTACTED: 'contacted',
  INVITED: 'invited',
  CONVERTED: 'converted',
  CLOSED: 'closed',
  SPAM: 'spam',
} as const;

export type FormSubmissionStatus = typeof FORM_SUBMISSION_STATUS[keyof typeof FORM_SUBMISSION_STATUS];

export const BUG_REPORT_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const;

export type BugReportStatus = typeof BUG_REPORT_STATUS[keyof typeof BUG_REPORT_STATUS];

export const WELLNESS_ENROLLMENT_STATUS = {
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  WAITLISTED: 'waitlisted',
} as const;

export type WellnessEnrollmentStatus = typeof WELLNESS_ENROLLMENT_STATUS[keyof typeof WELLNESS_ENROLLMENT_STATUS];

export const COMMUNICATION_LOG_STATUS = {
  SENT: 'sent',
  RECEIVED: 'received',
  SCHEDULED: 'scheduled',
  DRAFT: 'draft',
} as const;

export type CommunicationLogStatus = typeof COMMUNICATION_LOG_STATUS[keyof typeof COMMUNICATION_LOG_STATUS];

export const HUBSPOT_SYNC_QUEUE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SUPERSEDED: 'superseded',
  DEAD: 'dead',
} as const;

export type HubspotSyncQueueStatus = typeof HUBSPOT_SYNC_QUEUE_STATUS[keyof typeof HUBSPOT_SYNC_QUEUE_STATUS];

export const LEGACY_IMPORT_JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type LegacyImportJobStatus = typeof LEGACY_IMPORT_JOB_STATUS[keyof typeof LEGACY_IMPORT_JOB_STATUS];

export const TRACKMAN_UNMATCHED_STATUS = {
  UNMATCHED: 'unmatched',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
} as const;

export type TrackmanUnmatchedStatus = typeof TRACKMAN_UNMATCHED_STATUS[keyof typeof TRACKMAN_UNMATCHED_STATUS];
