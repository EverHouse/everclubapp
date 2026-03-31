// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    paymentIntents: { list: vi.fn(), retrieve: vi.fn() },
    subscriptions: { list: vi.fn() },
    customers: { retrieve: vi.fn() },
    refunds: { list: vi.fn() },
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(sharedStripeClient)),
}));

vi.mock('../server/core/stripe/payments', () => ({
  confirmPaymentSuccess: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(() => undefined),
  isStripeResourceMissing: vi.fn(() => false),
}));

vi.mock('../../walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn(() => Promise.resolve()),
}));

import {
  reconcileDailyPayments,
  reconcileSubscriptions,
  reconcileDailyRefunds,
} from '../server/core/stripe/reconciliation';
import { confirmPaymentSuccess } from '../server/core/stripe/payments';
import { db } from '../server/db';

const mockDb = db as { execute: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe('Stripe Reconciliation', () => {
  describe('reconcileDailyPayments', () => {
    it('returns zero counts when no succeeded PIs are found', async () => {
      sharedStripeClient.paymentIntents.list.mockResolvedValue({
        data: [],
        has_more: false,
      });

      const result = await reconcileDailyPayments();

      expect(result.totalChecked).toBe(0);
      expect(result.missingPayments).toBe(0);
      expect(result.statusMismatches).toBe(0);
    });

    it('skips PIs that already exist with succeeded status in DB', async () => {
      sharedStripeClient.paymentIntents.list.mockResolvedValue({
        data: [
          { id: 'pi_existing', status: 'succeeded', amount: 5000, currency: 'usd', metadata: { userId: 'u1', purpose: 'guest_fee' } },
        ],
        has_more: false,
      });
      mockDb.execute.mockResolvedValue({
        rows: [{ status: 'succeeded' }],
      });

      const result = await reconcileDailyPayments();

      expect(result.totalChecked).toBe(1);
      expect(result.missingPayments).toBe(0);
      expect(result.statusMismatches).toBe(0);
      expect(confirmPaymentSuccess).not.toHaveBeenCalled();
    });

    it('heals missing payment by inserting and confirming', async () => {
      sharedStripeClient.paymentIntents.list.mockResolvedValue({
        data: [
          { id: 'pi_missing', status: 'succeeded', amount: 7500, currency: 'usd', metadata: { userId: 'user_1', purpose: 'overage_fee' } },
        ],
        has_more: false,
      });
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await reconcileDailyPayments();

      expect(result.totalChecked).toBe(1);
      expect(result.missingPayments).toBe(1);
      expect(confirmPaymentSuccess).toHaveBeenCalledWith('pi_missing', 'system', 'System Reconciler');
    });

    it('heals status mismatch when DB has non-succeeded status', async () => {
      sharedStripeClient.paymentIntents.list.mockResolvedValue({
        data: [
          { id: 'pi_mismatch', status: 'succeeded', amount: 3000, currency: 'usd', metadata: { userId: 'u2', purpose: 'booking_fee' } },
        ],
        has_more: false,
      });
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ status: 'pending' }],
      });

      const result = await reconcileDailyPayments();

      expect(result.statusMismatches).toBe(1);
      expect(result.missingPayments).toBe(0);
      expect(confirmPaymentSuccess).toHaveBeenCalledWith('pi_mismatch', 'system', 'System Reconciler');
    });

    it('ignores non-succeeded payment intents from Stripe', async () => {
      sharedStripeClient.paymentIntents.list.mockResolvedValue({
        data: [
          { id: 'pi_pending', status: 'requires_payment_method', amount: 1000, currency: 'usd', metadata: {} },
          { id: 'pi_canceled', status: 'canceled', amount: 2000, currency: 'usd', metadata: {} },
        ],
        has_more: false,
      });

      const result = await reconcileDailyPayments();

      expect(result.totalChecked).toBe(2);
      expect(result.missingPayments).toBe(0);
      expect(result.statusMismatches).toBe(0);
      expect(confirmPaymentSuccess).not.toHaveBeenCalled();
    });

    it('paginates through multiple pages of results', async () => {
      sharedStripeClient.paymentIntents.list
        .mockResolvedValueOnce({
          data: [
            { id: 'pi_page1', status: 'succeeded', amount: 1000, currency: 'usd', metadata: { userId: 'u1' } },
          ],
          has_more: true,
        })
        .mockResolvedValueOnce({
          data: [
            { id: 'pi_page2', status: 'succeeded', amount: 2000, currency: 'usd', metadata: { userId: 'u2' } },
          ],
          has_more: false,
        });
      mockDb.execute.mockResolvedValue({ rows: [{ status: 'succeeded' }] });

      const result = await reconcileDailyPayments();

      expect(result.totalChecked).toBe(2);
      expect(sharedStripeClient.paymentIntents.list).toHaveBeenCalledTimes(2);
    });

    it('throws on unrecoverable Stripe error', async () => {
      sharedStripeClient.paymentIntents.list.mockRejectedValue(new Error('Stripe 500'));

      await expect(reconcileDailyPayments()).rejects.toThrow('Stripe 500');
    });
  });

  describe('reconcileSubscriptions', () => {
    it('detects members with no active Stripe subscription', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [
          { id: 'user_1', email: 'test@example.com', stripe_customer_id: 'cus_1', tier: 'gold', membership_status: 'active' },
        ],
      });
      sharedStripeClient.subscriptions.list
        .mockResolvedValueOnce({
          data: [{ status: 'canceled' }],
        })
        .mockResolvedValue({ data: [], has_more: false });

      const result = await reconcileSubscriptions();

      expect(result.mismatches).toBeGreaterThanOrEqual(1);
    });

    it('detects tier mismatches and heals them', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [
            { id: 'user_1', email: 'test@example.com', stripe_customer_id: 'cus_1', tier: 'silver', membership_status: 'active' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ slug: 'gold', name: 'Gold' }],
        })
        .mockResolvedValue({ rows: [] });

      sharedStripeClient.subscriptions.list
        .mockResolvedValueOnce({
          data: [{
            status: 'active',
            items: { data: [{ price: { id: 'price_gold' } }] },
          }],
        })
        .mockResolvedValue({ data: [], has_more: false });

      const result = await reconcileSubscriptions();

      expect(result.tierMismatchesHealed).toBeGreaterThanOrEqual(1);
    });

    it('returns zero counts when no members exist', async () => {
      sharedStripeClient.subscriptions.list.mockResolvedValue({ data: [], has_more: false });

      const result = await reconcileSubscriptions();

      expect(result.mismatches).toBe(0);
    });

    it('skips members without stripe_customer_id', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [
          { id: 'user_1', email: 'test@example.com', stripe_customer_id: null, tier: 'gold', membership_status: 'active' },
        ],
      });
      sharedStripeClient.subscriptions.list.mockResolvedValue({ data: [], has_more: false });

      const result = await reconcileSubscriptions();

      expect(sharedStripeClient.subscriptions.list).not.toHaveBeenCalledWith(
        expect.objectContaining({ customer: null })
      );
    });

    it('updates missing stripe_customer_id for existing user', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] });

      sharedStripeClient.subscriptions.list
        .mockResolvedValueOnce({
          data: [{
            id: 'sub_orphan',
            status: 'active',
            customer: { id: 'cus_orphan', email: 'orphan@test.com', name: 'Test User', deleted: false },
            items: { data: [] },
          }],
          has_more: false,
        })
        .mockResolvedValue({ data: [], has_more: false });

      mockDb.execute.mockResolvedValueOnce({
        rows: [{ id: 'user_existing', email: 'orphan@test.com', stripe_customer_id: null }],
      });

      await reconcileSubscriptions();

      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('reconcileDailyRefunds', () => {
    it('returns zero counts when no refunds exist', async () => {
      sharedStripeClient.refunds.list.mockResolvedValue({
        data: [],
        has_more: false,
      });

      const result = await reconcileDailyRefunds();

      expect(result.totalChecked).toBe(0);
      expect(result.missingRefunds).toBe(0);
    });

    it('heals refund when DB still shows payment as succeeded', async () => {
      sharedStripeClient.refunds.list.mockResolvedValue({
        data: [
          {
            id: 're_1',
            status: 'succeeded',
            payment_intent: 'pi_refunded',
            amount: 5000,
            metadata: {},
          },
        ],
        has_more: false,
      });
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ status: 'succeeded', booking_id: 100 }],
        })
        .mockResolvedValue({ rows: [] });
      sharedStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_refunded',
        amount: 5000,
        amount_received: 5000,
        metadata: { email: 'test@example.com' },
      });

      const result = await reconcileDailyRefunds();

      expect(result.totalChecked).toBe(1);
      expect(result.missingRefunds).toBe(1);
    });

    it('skips refund when DB already reflects refunded status', async () => {
      sharedStripeClient.refunds.list.mockResolvedValue({
        data: [
          {
            id: 're_2',
            status: 'succeeded',
            payment_intent: 'pi_already_refunded',
            amount: 3000,
            metadata: {},
          },
        ],
        has_more: false,
      });
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ status: 'refunded', booking_id: null }],
      });

      const result = await reconcileDailyRefunds();

      expect(result.totalChecked).toBe(1);
      expect(result.missingRefunds).toBe(0);
    });

    it('skips non-succeeded refunds', async () => {
      sharedStripeClient.refunds.list.mockResolvedValue({
        data: [
          { id: 're_pending', status: 'pending', payment_intent: 'pi_1', amount: 1000, metadata: {} },
        ],
        has_more: false,
      });

      const result = await reconcileDailyRefunds();

      expect(result.totalChecked).toBe(1);
      expect(result.missingRefunds).toBe(0);
    });
  });
});
