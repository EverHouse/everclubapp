// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStripeClient = {
  subscriptions: {
    create: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
  },
  coupons: { retrieve: vi.fn() },
  prices: { retrieve: vi.fn() },
  products: { list: vi.fn() },
  paymentIntents: { create: vi.fn(), update: vi.fn() },
  customers: { retrieve: vi.fn() },
};

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(mockStripeClient)),
}));

vi.mock('../server/core/stripe/customers', () => ({
  listCustomerPaymentMethods: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  isStripeError: vi.fn((e: unknown) => !!(e && typeof e === 'object' && 'type' in e)),
}));

vi.mock('../server/types/stripe-helpers', () => ({
  isExpandedProduct: vi.fn((p: unknown) => !!(p && typeof p === 'object' && 'name' in p)),
}));

import {
  createSubscription,
  cancelSubscription,
  listCustomerSubscriptions,
  getSubscription,
  pauseSubscription,
  resumeSubscription,
  changeSubscriptionTier,
} from '../server/core/stripe/subscriptions';
import { listCustomerPaymentMethods } from '../server/core/stripe/customers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Subscription Lifecycle', () => {
  describe('createSubscription', () => {
    it('creates a subscription and returns result', async () => {
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        items: { data: [{ current_period_end: 1700000000, current_period_start: 1697000000 }] },
        latest_invoice: { id: 'inv_1', status: 'paid', amount_due: 0, payment_intent: null },
        pending_setup_intent: null,
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
      });

      expect(result.success).toBe(true);
      expect(result.subscription?.subscriptionId).toBe('sub_123');
      expect(result.subscription?.status).toBe('active');
      expect(mockStripeClient.subscriptions.create).toHaveBeenCalledOnce();
    });

    it('returns clientSecret when invoice has payment_intent', async () => {
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_456',
        status: 'incomplete',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: {
          id: 'inv_2',
          status: 'open',
          amount_due: 5000,
          payment_intent: { id: 'pi_789', client_secret: 'pi_secret_xyz', metadata: {} },
        },
        pending_setup_intent: null,
      });
      mockStripeClient.paymentIntents.update.mockResolvedValue({});

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
      });

      expect(result.success).toBe(true);
      expect(result.subscription?.clientSecret).toBe('pi_secret_xyz');
      expect(result.subscription?.amountDue).toBe(5000);
    });

    it('applies coupon when provided', async () => {
      mockStripeClient.coupons.retrieve.mockResolvedValue({ percent_off: 20 });
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_coupon',
        status: 'active',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: { id: 'inv_c', amount_due: 4000, payment_intent: null },
        pending_setup_intent: null,
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
        couponId: 'coupon_20off',
      });

      expect(result.success).toBe(true);
      const createCall = mockStripeClient.subscriptions.create.mock.calls[0][0];
      expect(createCall.discounts).toEqual([{ coupon: 'coupon_20off' }]);
    });

    it('handles 100% off coupon as fully comped', async () => {
      mockStripeClient.coupons.retrieve.mockResolvedValue({ percent_off: 100 });
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_comped',
        status: 'active',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: { id: 'inv_comp', amount_due: 0, payment_intent: null },
        pending_setup_intent: null,
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
        couponId: 'coupon_100off',
      });

      expect(result.success).toBe(true);
      const createCall = mockStripeClient.subscriptions.create.mock.calls[0][0];
      expect(createCall.payment_behavior).toBe('allow_incomplete');
    });

    it('handles trial subscription with setup intent', async () => {
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_trial',
        status: 'trialing',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: { id: 'inv_t', amount_due: 0, payment_intent: null },
        pending_setup_intent: { id: 'seti_1', client_secret: 'seti_secret_abc' },
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
        trialPeriodDays: 14,
      });

      expect(result.success).toBe(true);
      expect(result.subscription?.clientSecret).toBe('seti_secret_abc');
      expect(result.subscription?.status).toBe('trialing');
    });

    it('uses allow_incomplete when customer has card on file', async () => {
      (listCustomerPaymentMethods as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'pm_card1' }]);
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_card',
        status: 'active',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: { id: 'inv_c', amount_due: 5000, payment_intent: null },
        pending_setup_intent: null,
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
      });

      expect(result.success).toBe(true);
      const createCall = mockStripeClient.subscriptions.create.mock.calls[0][0];
      expect(createCall.payment_behavior).toBe('allow_incomplete');
      expect(createCall.default_payment_method).toBe('pm_card1');
    });

    it('returns error on Stripe failure', async () => {
      mockStripeClient.subscriptions.create.mockRejectedValue(new Error('Card declined'));

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card declined');
    });

    it('creates a fallback payment intent when none exists but invoice has amount due', async () => {
      mockStripeClient.subscriptions.create.mockResolvedValue({
        id: 'sub_fb',
        status: 'incomplete',
        items: { data: [{ current_period_end: 1700000000 }] },
        latest_invoice: { id: 'inv_fb', amount_due: 3000, currency: 'usd', payment_intent: null },
        pending_setup_intent: null,
      });
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_fallback',
        client_secret: 'pi_fb_secret',
      });

      const result = await createSubscription({
        customerId: 'cus_123',
        priceId: 'price_abc',
      });

      expect(result.success).toBe(true);
      expect(result.subscription?.clientSecret).toBe('pi_fb_secret');
      expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledOnce();
    });
  });

  describe('cancelSubscription', () => {
    it('cancels a subscription successfully', async () => {
      mockStripeClient.subscriptions.cancel.mockResolvedValue({});

      const result = await cancelSubscription('sub_123');

      expect(result.success).toBe(true);
      expect(mockStripeClient.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    });

    it('returns error on failure', async () => {
      mockStripeClient.subscriptions.cancel.mockRejectedValue(new Error('Not found'));

      const result = await cancelSubscription('sub_missing');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getSubscription', () => {
    it('retrieves subscription details', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_get',
        status: 'active',
        customer: 'cus_abc',
        cancel_at_period_end: false,
        canceled_at: null,
        items: {
          data: [{
            price: { id: 'price_1', product: { id: 'prod_1', name: 'Gold', deleted: false } },
            current_period_start: 1697000000,
            current_period_end: 1700000000,
          }],
        },
      });

      const result = await getSubscription('sub_get');

      expect(result.success).toBe(true);
      expect(result.subscription?.id).toBe('sub_get');
      expect(result.subscription?.productName).toBe('Gold');
      expect(result.subscription?.cancelAtPeriodEnd).toBe(false);
    });

    it('returns error for non-existent subscription', async () => {
      mockStripeClient.subscriptions.retrieve.mockRejectedValue(new Error('No such subscription'));

      const result = await getSubscription('sub_fake');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No such subscription');
    });
  });

  describe('pauseSubscription', () => {
    it('pauses a subscription with duration', async () => {
      mockStripeClient.subscriptions.update.mockResolvedValue({});

      const result = await pauseSubscription('sub_123', 30);

      expect(result.success).toBe(true);
      expect(result.resumeDate).toBeInstanceOf(Date);
      expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith('sub_123', expect.objectContaining({
        pause_collection: expect.objectContaining({
          behavior: 'mark_uncollectible',
        }),
      }));
    });

    it('pauses with explicit resume date', async () => {
      mockStripeClient.subscriptions.update.mockResolvedValue({});
      const resumeAt = new Date('2026-06-01');

      const result = await pauseSubscription('sub_123', 30, resumeAt);

      expect(result.success).toBe(true);
      expect(result.resumeDate).toEqual(resumeAt);
    });

    it('returns error on failure', async () => {
      mockStripeClient.subscriptions.update.mockRejectedValue(new Error('Subscription not pausable'));

      const result = await pauseSubscription('sub_123', 30);

      expect(result.success).toBe(false);
    });
  });

  describe('resumeSubscription', () => {
    it('resumes a paused subscription', async () => {
      mockStripeClient.subscriptions.update.mockResolvedValue({});

      const result = await resumeSubscription('sub_123');

      expect(result.success).toBe(true);
      expect(mockStripeClient.subscriptions.update).toHaveBeenCalledWith('sub_123', expect.objectContaining({
        pause_collection: null,
      }));
    });

    it('returns error on failure', async () => {
      mockStripeClient.subscriptions.update.mockRejectedValue(new Error('Not paused'));

      const result = await resumeSubscription('sub_123');

      expect(result.success).toBe(false);
    });
  });

  describe('changeSubscriptionTier', () => {
    const baseSub = {
      id: 'sub_tier',
      items: { data: [{ id: 'si_1' }] },
      default_payment_method: null,
      customer: 'cus_tier',
    };

    it('performs immediate upgrade with proration', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue(baseSub);
      mockStripeClient.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: 'pm_cust' },
      });
      mockStripeClient.subscriptions.update.mockResolvedValue({});

      const result = await changeSubscriptionTier('sub_tier', 'price_new', true);

      expect(result.success).toBe(true);
      const updateCall = mockStripeClient.subscriptions.update.mock.calls[0][1];
      expect(updateCall.proration_behavior).toBe('always_invoice');
      expect(updateCall.items[0].price).toBe('price_new');
    });

    it('performs scheduled downgrade without proration', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue(baseSub);
      mockStripeClient.customers.retrieve.mockResolvedValue({
        deleted: false,
        invoice_settings: { default_payment_method: null },
      });
      (listCustomerPaymentMethods as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      mockStripeClient.subscriptions.update.mockResolvedValue({});

      const result = await changeSubscriptionTier('sub_tier', 'price_lower', false);

      expect(result.success).toBe(true);
      const updateCall = mockStripeClient.subscriptions.update.mock.calls[0][1];
      expect(updateCall.proration_behavior).toBe('none');
    });

    it('uses subscription default_payment_method for upgrade', async () => {
      mockStripeClient.subscriptions.retrieve.mockResolvedValue({
        ...baseSub,
        default_payment_method: 'pm_sub_default',
      });
      mockStripeClient.subscriptions.update.mockResolvedValue({});

      const result = await changeSubscriptionTier('sub_tier', 'price_new', true);

      expect(result.success).toBe(true);
      const updateCall = mockStripeClient.subscriptions.update.mock.calls[0][1];
      expect(updateCall.default_payment_method).toBe('pm_sub_default');
    });

    it('returns error on failure', async () => {
      mockStripeClient.subscriptions.retrieve.mockRejectedValue(new Error('Stripe error'));

      const result = await changeSubscriptionTier('sub_tier', 'price_new', true);

      expect(result.success).toBe(false);
    });
  });

  describe('listCustomerSubscriptions', () => {
    it('lists subscriptions for a customer', async () => {
      mockStripeClient.subscriptions.list.mockResolvedValue({
        data: [{
          id: 'sub_list1',
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: null,
          pause_collection: null,
          pending_update: null,
          items: {
            data: [{
              price: { id: 'price_1', product: 'prod_1', unit_amount: 5000, currency: 'usd', recurring: { interval: 'month' } },
              current_period_start: 1697000000,
              current_period_end: 1700000000,
            }],
          },
        }],
      });
      mockStripeClient.products.list.mockResolvedValue({
        data: [{ id: 'prod_1', name: 'Gold Membership' }],
      });

      const result = await listCustomerSubscriptions('cus_list');

      expect(result.success).toBe(true);
      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions![0].productName).toBe('Gold Membership');
      expect(result.subscriptions![0].planAmount).toBe(5000);
    });

    it('returns CUSTOMER_NOT_FOUND for invalid customer', async () => {
      const err = new Error('No such customer: cus_invalid') as Error & { type: string };
      err.type = 'StripeInvalidRequestError';
      mockStripeClient.subscriptions.list.mockRejectedValue(err);

      const result = await listCustomerSubscriptions('cus_invalid');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('CUSTOMER_NOT_FOUND');
    });
  });
});
