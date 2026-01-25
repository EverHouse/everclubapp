import { TIER_HIERARCHY } from '../../../shared/constants/tiers';

export function redactEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [localPart, domain] = email.split('@');
  const prefix = localPart.slice(0, 2);
  return `${prefix}***@${domain}`;
}

export function getTierRank(tier: string): number {
  return TIER_HIERARCHY[tier as keyof typeof TIER_HIERARCHY] || 1;
}
