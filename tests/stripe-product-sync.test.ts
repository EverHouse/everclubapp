// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    products: { create: vi.fn(), update: vi.fn(), list: vi.fn() },
    prices: { create: vi.fn(), update: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(sharedStripeClient)),
}));

vi.mock('../server/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNotNull: vi.fn((col: unknown) => col),
}));

vi.mock('../../../shared/schema', () => ({
  membershipTiers: {},
  cafeItems: {},
}));

vi.mock('../server/core/stripe/productHelpers', () => ({
  findExistingStripeProduct: vi.fn(() => Promise.resolve(null)),
  buildPrivilegeMetadata: vi.fn(() => ({ tier_id: '1' })),
  buildMergedMarketingFeatures: vi.fn(() => []),
}));

vi.mock('../server/core/stripe/appOriginTracker', () => ({
  markAppOriginated: vi.fn(),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import {
  syncMembershipTiersToStripe,
  getTierSyncStatus,
  cleanupOrphanStripeProducts,
} from '../server/core/stripe/productSync';
import { findExistingStripeProduct } from '../server/core/stripe/productHelpers';
import { db } from '../server/db';

const mockDb = db as {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

function setupDbSelect(tiers: Record<string, unknown>[]) {
  mockDb.select.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(tiers)),
    })),
  });
}

function setupDbUpdate() {
  mockDb.update.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  });
}

describe('Product and Catalog Sync', () => {
  describe('syncMembershipTiersToStripe - skip logic', () => {
    it('skips tiers with fee product type', async () => {
      setupDbSelect([
        { id: 1, name: 'Overage Fee', slug: 'overage-fee', priceCents: 2500, productType: 'fee', isActive: true },
      ]);

      const result = await syncMembershipTiersToStripe();

      expect(result.skipped).toBe(1);
      expect(result.synced).toBe(0);
      expect(result.results[0].action).toBe('skipped');
    });

    it('skips tiers with no price configured', async () => {
      setupDbSelect([
        { id: 2, name: 'Free Tier', slug: 'free', priceCents: 0, productType: null, isActive: true },
      ]);

      const result = await syncMembershipTiersToStripe();

      expect(result.skipped).toBe(1);
    });

    it('skips one_time and config product types', async () => {
      setupDbSelect([
        { id: 3, name: 'Day Pass', slug: 'day-pass', priceCents: 10000, productType: 'one_time', isActive: true },
        { id: 4, name: 'System Config', slug: 'config', priceCents: 100, productType: 'config', isActive: true },
      ]);

      const result = await syncMembershipTiersToStripe();

      expect(result.skipped).toBe(2);
      expect(result.synced).toBe(0);
    });

    it('returns empty results when no tiers exist', async () => {
      setupDbSelect([]);

      const result = await syncMembershipTiersToStripe();

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('syncMembershipTiersToStripe - existing product update', () => {
    it('updates existing product and handles unchanged price', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 50000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: 'price_gold',
        description: 'Gold membership', billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.retrieve.mockResolvedValue({
        id: 'price_gold', active: true, unit_amount: 50000, recurring: { interval: 'month' },
      });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(result.results[0].action).toBe('updated');
      expect(sharedStripeClient.products.update).toHaveBeenCalledOnce();
      expect(sharedStripeClient.prices.create).not.toHaveBeenCalled();
    });

    it('creates replacement price when amount changes', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 60000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: 'price_gold',
        description: 'Gold', billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.retrieve.mockResolvedValue({
        id: 'price_gold', active: true, unit_amount: 50000, recurring: { interval: 'month' },
      });
      sharedStripeClient.prices.update.mockResolvedValue({});
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_gold_new' });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.prices.update).toHaveBeenCalledWith('price_gold', { active: false });
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
      expect(sharedStripeClient.prices.create.mock.calls[0][0].unit_amount).toBe(60000);
    });

    it('creates replacement price when existing price is inactive', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 50000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: 'price_inactive',
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.retrieve.mockResolvedValue({ id: 'price_inactive', active: false });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_replacement' });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
    });

    it('creates replacement price when price is missing from Stripe', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 50000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: 'price_gone',
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.retrieve.mockRejectedValue(new Error('No such price'));
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_new' });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
    });

    it('creates new price when no stripePriceId exists', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 50000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: null,
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_brand_new' });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(sharedStripeClient.prices.create).toHaveBeenCalledOnce();
      expect(sharedStripeClient.products.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncMembershipTiersToStripe - new product creation', () => {
    it('creates new product and price when no Stripe IDs exist', async () => {
      setupDbSelect([{
        id: 5, name: 'Platinum', slug: 'platinum', priceCents: 100000,
        productType: null, isActive: true,
        stripeProductId: null, stripePriceId: null,
        description: 'Platinum membership', billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.create.mockResolvedValue({ id: 'prod_plat' });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_plat' });
      sharedStripeClient.products.update.mockResolvedValue({});

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(result.results[0].action).toBe('created');
      expect(result.results[0].stripeProductId).toBe('prod_plat');
      expect(result.results[0].stripePriceId).toBe('price_plat');
      expect(sharedStripeClient.products.create).toHaveBeenCalledOnce();
      expect(sharedStripeClient.products.create.mock.calls[0][1]).toHaveProperty('idempotencyKey');
    });

    it('reuses existing Stripe product found by metadata', async () => {
      setupDbSelect([{
        id: 5, name: 'Platinum', slug: 'platinum', priceCents: 100000,
        productType: null, isActive: true,
        stripeProductId: null, stripePriceId: null,
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      (findExistingStripeProduct as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'prod_found' });
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_found' });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_found' });

      const result = await syncMembershipTiersToStripe();

      expect(result.synced).toBe(1);
      expect(result.results[0].stripeProductId).toBe('prod_found');
      expect(sharedStripeClient.products.create).not.toHaveBeenCalled();
    });

    it('records failure when Stripe API errors', async () => {
      setupDbSelect([{
        id: 5, name: 'Platinum', slug: 'platinum', priceCents: 100000,
        productType: null, isActive: true,
        stripeProductId: null, stripePriceId: null,
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      sharedStripeClient.products.create.mockRejectedValue(new Error('Stripe down'));

      const result = await syncMembershipTiersToStripe();

      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
    });
  });

  describe('syncMembershipTiersToStripe - idempotency', () => {
    it('uses deterministic idempotency keys for product creation', async () => {
      setupDbSelect([{
        id: 7, name: 'Silver', slug: 'silver', priceCents: 30000,
        productType: null, isActive: true,
        stripeProductId: null, stripePriceId: null,
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.create.mockResolvedValue({ id: 'prod_silver' });
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_silver' });
      sharedStripeClient.products.update.mockResolvedValue({});

      await syncMembershipTiersToStripe();

      expect(sharedStripeClient.products.create.mock.calls[0][1].idempotencyKey).toBe('product_tier_7_silver');
    });

    it('uses price_replace_changed key when price amount differs', async () => {
      setupDbSelect([{
        id: 1, name: 'Gold', slug: 'gold', priceCents: 60000,
        productType: null, isActive: true,
        stripeProductId: 'prod_gold', stripePriceId: 'price_old',
        description: null, billingInterval: 'month',
        highlightedFeatures: null, allFeatures: null,
      }]);
      setupDbUpdate();
      sharedStripeClient.products.update.mockResolvedValue({ id: 'prod_gold' });
      sharedStripeClient.prices.retrieve.mockResolvedValue({
        id: 'price_old', active: true, unit_amount: 50000, recurring: { interval: 'month' },
      });
      sharedStripeClient.prices.update.mockResolvedValue({});
      sharedStripeClient.prices.create.mockResolvedValue({ id: 'price_new' });

      await syncMembershipTiersToStripe();

      const priceKey = sharedStripeClient.prices.create.mock.calls[0][1].idempotencyKey;
      expect(priceKey).toContain('price_replace_changed');
      expect(priceKey).toContain('60000');
    });
  });

  describe('getTierSyncStatus', () => {
    it('returns sync status for all tiers', async () => {
      setupDbSelect([
        { id: 1, name: 'Gold', slug: 'gold', priceCents: 50000, stripeProductId: 'prod_gold', stripePriceId: 'price_gold', isActive: true },
        { id: 2, name: 'Silver', slug: 'silver', priceCents: 30000, stripeProductId: null, stripePriceId: null, isActive: true },
      ]);

      const result = await getTierSyncStatus();

      expect(result).toHaveLength(2);
      expect(result[0].hasStripeProduct).toBe(true);
      expect(result[1].hasStripeProduct).toBe(false);
    });

    it('returns empty array when no tiers exist', async () => {
      setupDbSelect([]);
      const result = await getTierSyncStatus();
      expect(result).toHaveLength(0);
    });
  });

  describe('cleanupOrphanStripeProducts', () => {
    it('returns zero counts when no orphan products exist', async () => {
      setupDbSelect([
        { id: 1, name: 'Gold', slug: 'gold', stripeProductId: 'prod_gold', isActive: true },
      ]);
      sharedStripeClient.products.list.mockResolvedValue({
        data: [{ id: 'prod_gold', name: 'Gold', metadata: { source: 'ever_house_app', tier_id: '1' } }],
        has_more: false,
      });

      const result = await cleanupOrphanStripeProducts();

      expect(result.success).toBe(true);
      expect(result.archived).toBe(0);
    });

    it('archives orphan product from app with inactive tier', async () => {
      setupDbSelect([
        { id: 1, name: 'Gold', slug: 'gold', stripeProductId: 'prod_gold', isActive: true },
      ]);
      sharedStripeClient.products.list.mockResolvedValue({
        data: [
          { id: 'prod_gold', name: 'Gold', metadata: { source: 'ever_house_app', tier_id: '1' } },
          { id: 'prod_old', name: 'Old Tier', metadata: { source: 'ever_house_app', tier_id: '99' } },
        ],
        has_more: false,
      });
      sharedStripeClient.products.update.mockResolvedValue({});

      const result = await cleanupOrphanStripeProducts();

      expect(result.archived).toBe(1);
      expect(sharedStripeClient.products.update).toHaveBeenCalledWith('prod_old', { active: false });
    });

    it('skips app products without tier_id metadata', async () => {
      setupDbSelect([]);
      sharedStripeClient.products.list.mockResolvedValue({
        data: [
          { id: 'prod_manual', name: 'Manual Product', metadata: { source: 'ever_house_app' } },
        ],
        has_more: false,
      });

      const result = await cleanupOrphanStripeProducts();

      expect(result.skipped).toBe(1);
      expect(result.archived).toBe(0);
    });

    it('archives duplicate product matching tier name but not linked', async () => {
      setupDbSelect([
        { id: 1, name: 'Gold', slug: 'gold', stripeProductId: 'prod_gold', isActive: true },
      ]);
      sharedStripeClient.products.list.mockResolvedValue({
        data: [
          { id: 'prod_gold', name: 'Gold', metadata: {} },
          { id: 'prod_dup', name: 'Gold Membership', metadata: {} },
        ],
        has_more: false,
      });
      sharedStripeClient.products.update.mockResolvedValue({});

      const result = await cleanupOrphanStripeProducts();

      expect(result.archived).toBe(1);
      expect(result.results[0].reason).toContain('Duplicate');
    });

    it('records error when archiving fails', async () => {
      setupDbSelect([]);
      sharedStripeClient.products.list.mockResolvedValue({
        data: [
          { id: 'prod_err', name: 'Old Product', metadata: { source: 'ever_house_app', tier_id: '50' } },
        ],
        has_more: false,
      });
      sharedStripeClient.products.update.mockRejectedValue(new Error('Archive failed'));

      const result = await cleanupOrphanStripeProducts();

      expect(result.errors).toBe(1);
      expect(result.results[0].action).toBe('error');
    });

    it('paginates through multiple pages of products', async () => {
      setupDbSelect([]);
      sharedStripeClient.products.list
        .mockResolvedValueOnce({
          data: [{ id: 'prod_1', name: 'Page1', metadata: { source: 'ever_house_app', tier_id: '90' } }],
          has_more: true,
        })
        .mockResolvedValueOnce({
          data: [{ id: 'prod_2', name: 'Page2', metadata: { source: 'ever_house_app', tier_id: '91' } }],
          has_more: false,
        });
      sharedStripeClient.products.update.mockResolvedValue({});

      const result = await cleanupOrphanStripeProducts();

      expect(sharedStripeClient.products.list).toHaveBeenCalledTimes(2);
      expect(result.archived).toBe(2);
    });
  });
});
