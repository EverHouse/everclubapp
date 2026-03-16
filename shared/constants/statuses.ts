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
