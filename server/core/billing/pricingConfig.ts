/**
 * Centralized pricing configuration - THE ONLY source of truth for fees
 * 
 * All fee calculations MUST import from this file.
 * NEVER hardcode $25 or 2500 cents anywhere else.
 */

export const PRICING = {
  // Overage rates
  OVERAGE_RATE_DOLLARS: 25,
  OVERAGE_RATE_CENTS: 2500,
  OVERAGE_BLOCK_MINUTES: 30,
  
  // Guest fees
  GUEST_FEE_DOLLARS: 25,
  GUEST_FEE_CENTS: 2500,
} as const;

export function calculateOverageCents(overageMinutes: number): number {
  return Math.ceil(overageMinutes / PRICING.OVERAGE_BLOCK_MINUTES) * PRICING.OVERAGE_RATE_CENTS;
}

export function calculateOverageDollars(overageMinutes: number): number {
  return Math.ceil(overageMinutes / PRICING.OVERAGE_BLOCK_MINUTES) * PRICING.OVERAGE_RATE_DOLLARS;
}
