// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    subscriptionItems: { create: vi.fn(), del: vi.fn() },
    coupons: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
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
    transaction: vi.fn((fn: Function) => fn({
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
      insert: vi.fn(),
    })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((...args: unknown[]) => args), {
    join: vi.fn((...args: unknown[]) => args),
  }),
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNotNull: vi.fn((col: unknown) => col),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(() => undefined),
  isStripeResourceMissing: vi.fn(() => false),
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

vi.mock('../server/utils/tierUtils', () => ({
  normalizeTierName: vi.fn((t: string) => {
    const map: Record<string, string> = { gold: 'gold', silver: 'silver', platinum: 'platinum', 'invalid-tier': '' };
    return map[t.toLowerCase()] || null;
  }),
}));

vi.mock('../shared/models/hubspot-billing', () => ({
  billingGroups: { id: 'id', primaryEmail: 'primary_email' },
  groupMembers: { id: 'id', billingGroupId: 'billing_group_id', isActive: 'is_active', memberEmail: 'member_email', tierName: 'tier_name' },
  familyAddOnProducts: { id: 'id', isActive: 'is_active', tierName: 'tier_name' },
}));

vi.mock('../server/core/stripe/groupBillingCrud', () => ({
  getCorporateVolumePrice: vi.fn(() => 50000),
  getOrCreateFamilyCoupon: vi.fn(() => Promise.resolve('FAMILY20')),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  getCorporateVolumeTiers: vi.fn(() => []),
  getCorporateBasePrice: vi.fn(() => 50000),
  getFamilyDiscountPercent: vi.fn(() => 20),
}));

vi.mock('../server/core/hubspot/members', () => ({
  findOrCreateHubSpotContact: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn(() => Promise.resolve(null)),
}));

import { addGroupMember } from '../server/core/stripe/groupBillingMembers';
import { removeGroupMember } from '../server/core/stripe/groupBillingOperations';
import { db } from '../server/db';

const mockDb = db as {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe('Group Member Operations', () => {
  describe('addGroupMember', () => {
    it('rejects invalid tier names', async () => {
      const result = await addGroupMember({
        billingGroupId: 1,
        memberEmail: 'test@example.com',
        memberTier: 'invalid-tier',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to resolve tier');
    });

    it('rejects member who is already active in a billing group', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: 10, isActive: true, memberEmail: 'exists@example.com' }])),
          })),
        })),
      });

      const result = await addGroupMember({
        billingGroupId: 1,
        memberEmail: 'exists@example.com',
        memberTier: 'gold',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already part of a billing group');
    });

    it('rejects user who belongs to a different billing group', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      mockDb.execute.mockResolvedValueOnce({
        rows: [{ id: 5, billing_group_id: 99, stripe_subscription_id: null, membership_status: 'active' }],
      });

      const result = await addGroupMember({
        billingGroupId: 1,
        memberEmail: 'other-group@example.com',
        memberTier: 'gold',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in a billing group');
    });

    it('rejects user who has their own active subscription', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      mockDb.execute.mockResolvedValueOnce({
        rows: [{ id: 5, billing_group_id: null, stripe_subscription_id: 'sub_own', membership_status: 'active' }],
      });

      const result = await addGroupMember({
        billingGroupId: 1,
        memberEmail: 'subscribed@example.com',
        memberTier: 'gold',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('own active subscription');
    });

    it('rejects when no add-on product exists for the tier', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      mockDb.select.mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const result = await addGroupMember({
        billingGroupId: 1,
        memberEmail: 'new@example.com',
        memberTier: 'gold',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No add-on product found');
    });

    it('rejects when billing group is not found', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([{ id: 1, stripePriceId: 'price_1', priceCents: 30000 }])),
            })),
          })),
        })
        .mockReturnValueOnce({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        });

      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await addGroupMember({
        billingGroupId: 999,
        memberEmail: 'new@example.com',
        memberTier: 'gold',
        addedBy: 'admin',
        addedByName: 'Admin User',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Billing group not found');
    });
  });

  describe('removeGroupMember', () => {
    it('returns error when member is not found', async () => {
      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          execute: vi.fn(() => Promise.resolve({ rows: [] })),
        };
        return fn(tx);
      });

      const result = await removeGroupMember({
        memberId: 999,
        removedBy: 'admin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when member is already inactive', async () => {
      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          execute: vi.fn(() => Promise.resolve({
            rows: [{ id: 1, member_email: 'test@example.com', stripe_subscription_item_id: null, is_active: false, billing_group_id: 1 }],
          })),
        };
        return fn(tx);
      });

      const result = await removeGroupMember({
        memberId: 1,
        removedBy: 'admin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already inactive');
    });

    it('successfully removes member without Stripe subscription item', async () => {
      const txExecute = vi.fn()
        .mockResolvedValueOnce({
          rows: [{ id: 1, member_email: 'test@example.com', stripe_subscription_item_id: null, is_active: true, billing_group_id: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = { execute: txExecute };
        return fn(tx);
      });

      const result = await removeGroupMember({
        memberId: 1,
        removedBy: 'admin',
      });

      expect(result.success).toBe(true);
      expect(sharedStripeClient.subscriptionItems.del).not.toHaveBeenCalled();
    });

    it('removes member and deletes Stripe subscription item', async () => {
      const txExecute = vi.fn()
        .mockResolvedValueOnce({
          rows: [{ id: 1, member_email: 'test@example.com', stripe_subscription_item_id: 'si_123', is_active: true, billing_group_id: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = { execute: txExecute };
        return fn(tx);
      });

      sharedStripeClient.subscriptionItems.del.mockResolvedValue({});

      const result = await removeGroupMember({
        memberId: 1,
        removedBy: 'admin',
      });

      expect(result.success).toBe(true);
      expect(sharedStripeClient.subscriptionItems.del).toHaveBeenCalledWith('si_123');
    });

    it('rolls back DB changes when Stripe subscription item deletion fails', async () => {
      const txExecute = vi.fn()
        .mockResolvedValueOnce({
          rows: [{ id: 2, member_email: 'test@example.com', stripe_subscription_item_id: 'si_fail', is_active: true, billing_group_id: 1 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = { execute: txExecute };
        return fn(tx);
      });

      sharedStripeClient.subscriptionItems.del.mockRejectedValue(new Error('Stripe error'));
      mockDb.execute.mockResolvedValue({ rows: [] });

      const result = await removeGroupMember({
        memberId: 2,
        removedBy: 'admin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot remove billing');
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });
});
