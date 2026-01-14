export const MEMBERSHIP_PIPELINE_ID = process.env.HUBSPOT_MEMBERSHIP_PIPELINE_ID || 'default';

export const HUBSPOT_STAGE_IDS = {
  DAY_PASS_TOUR_REQUEST: '2414796536',
  TOUR_BOOKED: '2413968103',
  VISITED_DAY_PASS: '2414796537',
  APPLICATION_SUBMITTED: '2414797498',
  BILLING_SETUP: '2825519819',
  CLOSED_WON_ACTIVE: 'closedwon',
  PAYMENT_DECLINED: '2825519820',
  CLOSED_LOST: 'closedlost',
};

export const MINDBODY_TO_STAGE_MAP: Record<string, string> = {
  'active': HUBSPOT_STAGE_IDS.CLOSED_WON_ACTIVE,
  'pending': HUBSPOT_STAGE_IDS.BILLING_SETUP,
  'declined': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'suspended': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'expired': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'terminated': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'cancelled': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'froze': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'frozen': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'non-member': HUBSPOT_STAGE_IDS.CLOSED_LOST,
};

export type ContactMembershipStatus = 'active' | 'inactive' | 'former_member';

export const MINDBODY_TO_CONTACT_STATUS_MAP: Record<string, ContactMembershipStatus> = {
  'active': 'active',
  'pending': 'active',
  'declined': 'inactive',
  'suspended': 'inactive',
  'froze': 'inactive',
  'frozen': 'inactive',
  'expired': 'former_member',
  'terminated': 'former_member',
  'cancelled': 'former_member',
  'non-member': 'former_member',
};

export const INACTIVE_STATUSES = ['declined', 'suspended', 'froze', 'frozen'];
export const CHURNED_STATUSES = ['expired', 'terminated', 'cancelled', 'non-member'];
export const ACTIVE_STATUSES = ['active', 'pending'];
