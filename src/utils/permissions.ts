import { 
  normalizeTierName, 
  TierName,
} from '../../shared/constants/tiers';

export type BaseTier = TierName;

export function getBaseTier(tierName: string): BaseTier | null {
  return normalizeTierName(tierName);
}


export type MembershipTier = BaseTier;
