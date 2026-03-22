import { type BaseTier } from './permissions';
import { normalizeTierName } from '../../shared/constants/tiers';

export type { BaseTier };

export interface TierColor {
  bg: string;
  text: string;
  border: string;
}

export const VISITOR_COLORS: TierColor = { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' };

/**
 * Bootstrap-only fallback tier colors. These are used until dynamic colors
 * are loaded from the membership_tiers DB table via setDynamicTierColors().
 * Prefer DB-sourced wallet_pass_bg_color / wallet_pass_foreground_color values.
 */
export const TIER_COLORS: Record<BaseTier, TierColor> = {
  VIP: { bg: '#E5E4E2', text: '#374151', border: '#C0C0C0' },
  Premium: { bg: '#D4AF37', text: '#1a1a1a', border: '#B8960C' },
  Corporate: { bg: '#374151', text: '#FFFFFF', border: '#4B5563' },
  Core: { bg: '#293515', text: '#FFFFFF', border: '#3d4f20' },
  Social: { bg: '#CCB8E4', text: '#293515', border: '#B8A0D4' },
};

const _dynamicTierColors: Record<string, TierColor> = {};

export function setDynamicTierColors(
  tiers: Array<{
    name: string;
    wallet_pass_bg_color?: string | null;
    wallet_pass_foreground_color?: string | null;
    wallet_pass_label_color?: string | null;
  }>
): void {
  for (const key of Object.keys(_dynamicTierColors)) {
    delete _dynamicTierColors[key];
  }
  for (const tier of tiers) {
    if (tier.wallet_pass_bg_color && /^#[0-9A-Fa-f]{6}$/.test(tier.wallet_pass_bg_color)) {
      const bg = tier.wallet_pass_bg_color;
      const text = (tier.wallet_pass_foreground_color && /^#[0-9A-Fa-f]{6}$/.test(tier.wallet_pass_foreground_color))
        ? tier.wallet_pass_foreground_color
        : (isLightTierBackground(bg) ? '#1a1a1a' : '#FFFFFF');
      const border = darkenHex(bg, 0.15);
      _dynamicTierColors[tier.name] = { bg, text, border };
    }
  }
}

function darkenHex(hex: string, factor: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function parseTierString(tierString: string): { tier: BaseTier | null; tags: string[] } {
  return { 
    tier: normalizeTierName(tierString), 
    tags: [] 
  };
}

export function getTierColor(tier: string | null | undefined): TierColor {
  if (!tier) return VISITOR_COLORS;
  const { tier: baseTier } = parseTierString(tier);
  if (!baseTier) return VISITOR_COLORS;
  return _dynamicTierColors[baseTier] || TIER_COLORS[baseTier] || VISITOR_COLORS;
}

export function isLightTierBackground(hexColor: string): boolean {
  if (typeof hexColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hexColor)) return false;
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

export function getDisplayTier(tierString: string): BaseTier | null {
  const { tier } = parseTierString(tierString);
  return tier;
}

export function isSocialTier(tierString: string | null | undefined): boolean {
  if (!tierString) return false;
  return normalizeTierName(tierString)?.toLowerCase() === 'social';
}

export function isCorporateTier(tierString: string | null | undefined): boolean {
  if (!tierString) return false;
  return normalizeTierName(tierString)?.toLowerCase() === 'corporate';
}

export function isStaffTier(tierString: string | null | undefined): boolean {
  if (!tierString) return false;
  const normalized = normalizeTierName(tierString);
  return normalized?.toLowerCase() === 'staff' || tierString.toLowerCase() === 'staff';
}
