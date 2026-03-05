import { getSettingValue } from '../settingsHelper';

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
  'pending': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'declined': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'suspended': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'expired': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'froze': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'frozen': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'past_due': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'pastdue': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'paymentfailed': HUBSPOT_STAGE_IDS.PAYMENT_DECLINED,
  'terminated': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'cancelled': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'non-member': HUBSPOT_STAGE_IDS.CLOSED_LOST,
  'nonmember': HUBSPOT_STAGE_IDS.CLOSED_LOST,
};

// Valid HubSpot membership_status options: Froze, Active, Declined, Non-Member, trialing, Expired, past_due, Suspended, Terminated, Pending
export type ContactMembershipStatus = 'Active' | 'trialing' | 'past_due' | 'Pending' | 'Declined' | 'Suspended' | 'Expired' | 'Froze' | 'Terminated' | 'Non-Member';

export type BillingProvider = 'Stripe' | 'MindBody' | 'Manual';

export const MINDBODY_TO_CONTACT_STATUS_MAP: Record<string, ContactMembershipStatus> = {
  'active': 'Active',
  'trialing': 'trialing',
  'past_due': 'past_due',
  'pending': 'Pending',
  'declined': 'Declined',
  'suspended': 'Suspended',
  'expired': 'Expired',
  'froze': 'Froze',
  'frozen': 'Froze',
  'terminated': 'Terminated',
  'cancelled': 'Terminated',
  'non-member': 'Non-Member',
};

export const DB_STATUS_TO_HUBSPOT_STATUS: Record<string, ContactMembershipStatus> = {
  'active': 'Active',
  'trialing': 'trialing',
  'past_due': 'past_due',
  'inactive': 'Suspended',
  'cancelled': 'Terminated',
  'expired': 'Expired',
  'terminated': 'Terminated',
  'former_member': 'Terminated',
  'pending': 'Pending',
  'suspended': 'Suspended',
  'frozen': 'Froze',
  'non-member': 'Non-Member',
  'deleted': 'Terminated',
};

export const DB_BILLING_PROVIDER_TO_HUBSPOT: Record<string, string> = {
  'stripe': 'stripe',
  'mindbody': 'mindbody',
  'manual': 'manual',
  'comped': 'Comped',
  'none': 'None',
  'family_addon': 'stripe',
};

// Map app tier slugs to HubSpot membership_tier dropdown options
export const DB_TIER_TO_HUBSPOT: Record<string, string> = {
  'core': 'Core Membership',
  'core membership': 'Core Membership',
  'core-founding': 'Core Membership Founding Members',
  'core_founding': 'Core Membership Founding Members',
  'core membership founding members': 'Core Membership Founding Members',
  'premium': 'Premium Membership',
  'premium membership': 'Premium Membership',
  'premium-founding': 'Premium Membership Founding Members',
  'premium_founding': 'Premium Membership Founding Members',
  'premium membership founding members': 'Premium Membership Founding Members',
  'social': 'Social Membership',
  'social membership': 'Social Membership',
  'social-founding': 'Social Membership Founding Members',
  'social_founding': 'Social Membership Founding Members',
  'social membership founding members': 'Social Membership Founding Members',
  'vip': 'VIP Membership',
  'vip membership': 'VIP Membership',
  'corporate': 'Corporate Membership',
  'corporate membership': 'Corporate Membership',
  'group-lessons': 'Group Lessons Membership',
  'group_lessons': 'Group Lessons Membership',
  'group lessons': 'Group Lessons Membership',
  'group lessons membership': 'Group Lessons Membership',
};

export const INACTIVE_STATUSES = ['pending', 'declined', 'suspended', 'expired', 'froze', 'frozen'];
export const CHURNED_STATUSES = ['terminated', 'cancelled', 'non-member'];
export const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export async function getHubSpotPipelineId(): Promise<string> {
  return getSettingValue('hubspot.pipeline_id', MEMBERSHIP_PIPELINE_ID);
}

export async function getHubSpotStageId(stageName: keyof typeof HUBSPOT_STAGE_IDS): Promise<string> {
  const keyMap: Record<string, string> = {
    DAY_PASS_TOUR_REQUEST: 'hubspot.stage.day_pass_tour_request',
    TOUR_BOOKED: 'hubspot.stage.tour_booked',
    VISITED_DAY_PASS: 'hubspot.stage.visited_day_pass',
    APPLICATION_SUBMITTED: 'hubspot.stage.application_submitted',
    BILLING_SETUP: 'hubspot.stage.billing_setup',
    CLOSED_WON_ACTIVE: 'hubspot.stage.closed_won_active',
    PAYMENT_DECLINED: 'hubspot.stage.payment_declined',
    CLOSED_LOST: 'hubspot.stage.closed_lost',
  };
  const settingKey = keyMap[stageName];
  if (!settingKey) return HUBSPOT_STAGE_IDS[stageName];
  return getSettingValue(settingKey, HUBSPOT_STAGE_IDS[stageName]);
}

export async function getDbStatusToHubSpotMapping(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [dbStatus, defaultVal] of Object.entries(DB_STATUS_TO_HUBSPOT_STATUS)) {
    result[dbStatus] = await getSettingValue(`hubspot.status.${dbStatus}`, defaultVal);
  }
  return result;
}

export async function getTierToHubSpotMapping(): Promise<Record<string, string>> {
  const baseTiers: Record<string, string> = {
    'core': 'Core Membership',
    'core-founding': 'Core Membership Founding Members',
    'premium': 'Premium Membership',
    'premium-founding': 'Premium Membership Founding Members',
    'social': 'Social Membership',
    'social-founding': 'Social Membership Founding Members',
    'vip': 'VIP Membership',
    'corporate': 'Corporate Membership',
    'group-lessons': 'Group Lessons Membership',
  };

  const result: Record<string, string> = {};
  for (const [slug, defaultLabel] of Object.entries(baseTiers)) {
    const label = await getSettingValue(`hubspot.tier.${slug}`, defaultLabel);
    result[slug] = label;
    result[slug.replace(/-/g, '_')] = label;
    result[slug.replace(/-/g, ' ')] = label;
    const longName = `${slug.replace(/-/g, ' ')} membership`;
    if (longName !== slug) result[longName] = label;
  }
  return result;
}
