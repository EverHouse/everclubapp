import { logger } from '../core/logger';

export const TIER_SLUGS = ['social', 'core', 'premium', 'corporate', 'vip', 'staff'] as const;
export type TierSlug = typeof TIER_SLUGS[number];

export const CANONICAL_TIER_NAMES: Record<TierSlug, string> = {
  social: 'Social',
  core: 'Core',
  premium: 'Premium',
  corporate: 'Corporate',
  vip: 'VIP',
  staff: 'Staff',
};

const FUZZY_TIER_PATTERNS: { pattern: string; slug: TierSlug }[] = [
  { pattern: 'vip', slug: 'vip' },
  { pattern: 'premium', slug: 'premium' },
  { pattern: 'corporate', slug: 'corporate' },
  { pattern: 'core', slug: 'core' },
  { pattern: 'social', slug: 'social' },
  { pattern: 'staff', slug: 'staff' },
];

export function normalizeTierSlug(rawName: string | null | undefined): TierSlug {
  if (!rawName || typeof rawName !== 'string') {
    logger.warn('[normalizeTierSlug] Empty or invalid tier name, defaulting to social', { rawName });
    return 'social';
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    logger.warn('[normalizeTierSlug] Empty tier name after trim, defaulting to social');
    return 'social';
  }

  const lowered = trimmed.toLowerCase();

  for (const slug of TIER_SLUGS) {
    if (lowered === slug) {
      return slug;
    }
  }

  for (const canonicalName of Object.values(CANONICAL_TIER_NAMES)) {
    if (lowered === canonicalName.toLowerCase()) {
      const matchedSlug = (Object.entries(CANONICAL_TIER_NAMES).find(
        ([, name]) => name.toLowerCase() === lowered
      )?.[0] as TierSlug) || 'social';
      return matchedSlug;
    }
  }

  for (const { pattern, slug } of FUZZY_TIER_PATTERNS) {
    if (lowered.includes(pattern)) {
      logger.warn('[normalizeTierSlug] Fuzzy match used for tier normalization', {
        rawName,
        matchedPattern: pattern,
        normalizedSlug: slug,
      });
      return slug;
    }
  }

  logger.warn('[normalizeTierSlug] No tier match found, defaulting to social', { rawName });
  return 'social';
}

export function normalizeTierName(rawName: string | null | undefined): string {
  const slug = normalizeTierSlug(rawName);
  return CANONICAL_TIER_NAMES[slug];
}

export function isSocialTier(tierName: string | null | undefined): boolean {
  return normalizeTierSlug(tierName) === 'social';
}

export function isStaffTier(tierName: string | null | undefined): boolean {
  return normalizeTierSlug(tierName) === 'staff';
}
