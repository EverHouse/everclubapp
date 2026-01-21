export { MemberService, USAGE_LEDGER_MEMBER_JOIN, USAGE_LEDGER_MEMBER_JOIN_WITH_BOOKING } from './MemberService';
export { memberCache } from './memberCache';
export type {
  MemberRecord,
  StaffRecord,
  MemberRole,
  BillingMemberMatch,
  MemberLookupOptions,
  IdentifierType,
  ResolvedIdentifier
} from './memberTypes';
export {
  isUUID,
  isEmail,
  detectIdentifierType,
  normalizeEmail
} from './memberTypes';
export {
  syncMemberTierFromStripe,
  syncMemberStatusFromStripe,
  getTierFromPriceId,
  validateTierConsistency
} from './tierSync';
export type { TierSyncResult } from './tierSync';
