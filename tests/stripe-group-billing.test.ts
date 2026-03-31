// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
    subscriptionItems: { create: vi.fn(), del: vi.fn() },
    products: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
    prices: { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
    coupons: { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() },
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn((fn: Function) => fn({ execute: vi.fn() })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNotNull: vi.fn((col: unknown) => col),
  ilike: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(() => undefined),
  isStripeResourceMissing: vi.fn((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e) {
      return (e as { code: string }).code === 'resource_missing';
    }
    return false;
  }),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toTextArrayLiteral: vi.fn((arr: string[]) => `{${arr.join(',')}}`),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(sharedStripeClient)),
}));

vi.mock('../server/core/stripe/appOriginTracker', () => ({
  markAppOriginated: vi.fn(),
}));

vi.mock('../shared/models/hubspot-billing', () => ({
  billingGroups: { id: 'id', primaryEmail: 'primary_email' },
  groupMembers: { id: 'id', billingGroupId: 'billing_group_id', isActive: 'is_active', memberEmail: 'member_email' },
  familyAddOnProducts: { id: 'id', isActive: 'is_active' },
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  getCorporateVolumeTiers: vi.fn(() => [
    { minMembers: 1, priceCents: 50000 },
    { minMembers: 6, priceCents: 45000 },
    { minMembers: 16, priceCents: 40000 },
    { minMembers: 31, priceCents: 35000 },
  ]),
  getCorporateBasePrice: vi.fn(() => 50000),
  getFamilyDiscountPercent: vi.fn(() => 20),
  updateFamilyDiscountPercent: vi.fn(),
}));

import {
  getCorporateVolumePrice,
  getOrCreateFamilyCoupon,
  syncGroupAddOnProductsToStripe,
  getBillingGroupByPrimaryEmail,
  createBillingGroup,
  deleteBillingGroup,
} from '../server/core/stripe/groupBillingCrud';
import { db } from '../server/db';

const mockDb = db as {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe('Group Billing', () => {
  describe('getCorporateVolumePrice', () => {
    it('returns base price for 1 member', () => {
      expect(getCorporateVolumePrice(1)).toBe(50000);
    });

    it('returns base price for 5 members', () => {
      expect(getCorporateVolumePrice(5)).toBe(50000);
    });

    it('returns tier 2 price for 6 members', () => {
      expect(getCorporateVolumePrice(6)).toBe(45000);
    });

    it('returns tier 2 price for 15 members', () => {
      expect(getCorporateVolumePrice(15)).toBe(45000);
    });

    it('returns tier 3 price for 16 members', () => {
      expect(getCorporateVolumePrice(16)).toBe(40000);
    });

    it('returns tier 4 price for 31+ members', () => {
      expect(getCorporateVolumePrice(31)).toBe(35000);
      expect(getCorporateVolumePrice(100)).toBe(35000);
    });
  });

  describe('getOrCreateFamilyCoupon', () => {
    it('retrieves existing FAMILY20 coupon and updates discount percent', async () => {
      sharedStripeClient.coupons.retrieve.mockResolvedValue({
        id: 'FAMILY20',
        percent_off: 25,
      });

      const couponId = await getOrCreateFamilyCoupon();

      expect(couponId).toBe('FAMILY20');
      expect(sharedStripeClient.coupons.create).not.toHaveBeenCalled();
    });

    it('creates FAMILY20 coupon when it does not exist', async () => {
      const notFoundErr = Object.assign(new Error('No such coupon'), { code: 'resource_missing' });
      sharedStripeClient.coupons.retrieve.mockRejectedValue(notFoundErr);
      sharedStripeClient.coupons.create.mockResolvedValue({
        id: 'FAMILY20',
        percent_off: 20,
      });

      const couponId = await getOrCreateFamilyCoupon();

      expect(couponId).toBe('FAMILY20');
      expect(sharedStripeClient.coupons.create).toHaveBeenCalledOnce();
      const createArgs = sharedStripeClient.coupons.create.mock.calls[0][0];
      expect(createArgs.id).toBe('FAMILY20');
      expect(createArgs.percent_off).toBe(20);
      expect(createArgs.duration).toBe('forever');
    });

    it('throws on non-resource_missing Stripe errors', async () => {
      sharedStripeClient.coupons.retrieve.mockRejectedValue(new Error('Stripe API down'));

      await expect(getOrCreateFamilyCoupon()).rejects.toThrow('Stripe API down');
    });
  });

  describe('syncGroupAddOnProductsToStripe', () => {
    it('syncs add-on products that have no Stripe IDs yet', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            { id: 1, tierName: 'Gold', displayName: 'Gold Add-on', description: 'Gold tier add-on', priceCents: 30000, billingInterval: 'month', stripeProductId: null, stripePriceId: null, isActive: true },
          ])),
        })),
      });
      sharedStripeClient.products.create.mockResolvedValue({ id: 'prod_addon1' });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_addon1' });
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });

      const result = await syncGroupAddOnProductsToStripe();

      expect(result.success).toBe(true);
      expect(result.synced).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(sharedStripeClient.products.create).toHaveBeenCalledOnce();
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
    });

    it('skips product creation when stripeProductId already exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            { id: 1, tierName: 'Gold', displayName: 'Gold Add-on', description: 'desc', priceCents: 30000, billingInterval: 'month', stripeProductId: 'prod_existing', stripePriceId: null, isActive: true },
          ])),
        })),
      });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_new' });
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });

      const result = await syncGroupAddOnProductsToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.products.create).not.toHaveBeenCalled();
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
    });

    it('recreates inactive price', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            { id: 1, tierName: 'Gold', displayName: 'Gold Add-on', description: 'desc', priceCents: 30000, billingInterval: 'month', stripeProductId: 'prod_1', stripePriceId: 'price_inactive', isActive: true },
          ])),
        })),
      });
      sharedStripeClient.prices.retrieve.mockResolvedValue({ id: 'price_inactive', active: false });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_replacement' });
      mockDb.update.mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });

      const result = await syncGroupAddOnProductsToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
    });

    it('returns errors for individual product sync failures', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            { id: 1, tierName: 'Gold', displayName: 'Gold Add-on', description: 'desc', priceCents: 30000, billingInterval: 'month', stripeProductId: null, stripePriceId: null, isActive: true },
          ])),
        })),
      });
      sharedStripeClient.products.create.mockRejectedValue(new Error('Stripe error'));

      const result = await syncGroupAddOnProductsToStripe();

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Gold');
    });

    it('returns success with no syncs for empty add-on list', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });

      const result = await syncGroupAddOnProductsToStripe();

      expect(result.success).toBe(true);
      expect(result.synced).toBe(0);
    });
  });

  describe('getBillingGroupByPrimaryEmail', () => {
    it('returns null when no group found for email', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const result = await getBillingGroupByPrimaryEmail('nobody@example.com');

      expect(result).toBeNull();
    });

    it('returns group with members when found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: 1,
              primaryEmail: 'owner@example.com',
              groupName: 'Family Group',
              primaryStripeSubscriptionId: 'sub_1',
              isActive: true,
              type: 'family',
              maxSeats: null,
              companyName: null,
            }])),
          })),
        })),
      }).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([
            { id: 10, memberEmail: 'member1@example.com', memberTier: 'gold', relationship: 'spouse', addOnPriceCents: 30000, isActive: true, addedAt: new Date() },
          ])),
        })),
      });

      mockDb.execute.mockResolvedValueOnce({
        rows: [{ first_name: 'John', last_name: 'Doe' }],
      }).mockResolvedValueOnce({
        rows: [{ email: 'member1@example.com', first_name: 'Jane', last_name: 'Doe' }],
      });

      const result = await getBillingGroupByPrimaryEmail('owner@example.com');

      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
      expect(result!.type).toBe('family');
      expect(result!.members).toHaveLength(1);
      expect(result!.members[0].memberEmail).toBe('member1@example.com');
      expect(result!.totalMonthlyAmount).toBe(30000);
    });
  });

  describe('createBillingGroup', () => {
    it('returns error when group already exists for email', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: 1, primaryEmail: 'existing@test.com' }])),
          })),
        })),
      });

      const result = await createBillingGroup({
        primaryEmail: 'existing@test.com',
        createdBy: 'admin',
        createdByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('catches errors and returns generic failure message', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.reject(new Error('DB error'))),
          })),
        })),
      });

      const result = await createBillingGroup({
        primaryEmail: 'dup@test.com',
        createdBy: 'admin',
        createdByName: 'Admin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation failed. Please try again.');
    });
  });

  describe('deleteBillingGroup', () => {
    it('returns not found when group does not exist', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const result = await deleteBillingGroup(999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('prevents deletion when active Stripe subscription exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{
              id: 1,
              primaryStripeSubscriptionId: 'sub_active',
              isActive: true,
            }])),
          })),
        })),
      });

      const result = await deleteBillingGroup(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('subscription');
    });
  });
});
