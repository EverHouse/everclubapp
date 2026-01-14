import { db } from '../../db';
import { discountRules } from '../../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

export async function getApplicableDiscounts(memberTags: string[]): Promise<{ tag: string; percent: number }[]> {
  if (!memberTags || memberTags.length === 0) {
    return [];
  }
  
  const rules = await db.select()
    .from(discountRules)
    .where(and(
      inArray(discountRules.discountTag, memberTags),
      eq(discountRules.isActive, true)
    ));
  
  return rules.map(r => ({ tag: r.discountTag, percent: r.discountPercent }));
}

export async function calculateTotalDiscount(memberTags: string[]): Promise<{ totalPercent: number; appliedRules: string[] }> {
  const discounts = await getApplicableDiscounts(memberTags);
  
  if (discounts.length === 0) {
    return { totalPercent: 0, appliedRules: [] };
  }
  
  const maxDiscount = discounts.reduce((max, d) => d.percent > max.percent ? d : max, discounts[0]);
  
  return {
    totalPercent: Math.min(maxDiscount.percent, 100),
    appliedRules: [maxDiscount.tag]
  };
}
