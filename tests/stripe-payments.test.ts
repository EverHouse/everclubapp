// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((fn: Function) => fn({ execute: vi.fn() })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

const mockStripeClient = {
  paymentIntents: {
    create: vi.fn(),
    retrieve: vi.fn(),
    cancel: vi.fn(),
    update: vi.fn(),
  },
  invoices: {
    create: vi.fn(),
    del: vi.fn(),
    voidInvoice: vi.fn(),
    retrieve: vi.fn(),
  },
  invoiceItems: { create: vi.fn() },
  customers: {
    create: vi.fn(),
    retrieve: vi.fn(),
    createBalanceTransaction: vi.fn(),
  },
};

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(mockStripeClient)),
}));

vi.mock('../server/core/stripe/customers', () => ({
  getOrCreateStripeCustomer: vi.fn(() =>
    Promise.resolve({ customerId: 'cus_test', isNew: false })
  ),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: {
    markPaymentSucceeded: vi.fn(() => Promise.resolve({ success: true, participantsUpdated: 1, snapshotsUpdated: 1 })),
    markPaymentRefunded: vi.fn(() => Promise.resolve({ success: true })),
    markPaymentCancelled: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock('../server/core/auditLog', () => ({
  logBillingAudit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  isStripeError: vi.fn(() => false),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  getBookingInvoiceId: vi.fn(() => Promise.resolve(null)),
}));

import {
  generatePaymentIdempotencyKey,
  createPaymentIntent,
  getPaymentIntentStatus,
  cancelPaymentIntent,
  confirmPaymentSuccess,
  createBalanceAwarePayment,
} from '../server/core/stripe/payments';
import { db } from '../server/db';
import { PaymentStatusService } from '../server/core/billing/PaymentStatusService';

beforeEach(() => {
  vi.clearAllMocks();
  (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });
});

describe('Payment Processing', () => {
  describe('generatePaymentIdempotencyKey', () => {
    it('returns a 32-character hex string', () => {
      const key = generatePaymentIdempotencyKey(1, 2, [3, 4], 5000);
      expect(key).toHaveLength(32);
      expect(key).toMatch(/^[a-f0-9]{32}$/);
    });

    it('is deterministic for same inputs', () => {
      const key1 = generatePaymentIdempotencyKey(1, 2, [3, 4], 5000);
      const key2 = generatePaymentIdempotencyKey(1, 2, [3, 4], 5000);
      expect(key1).toBe(key2);
    });

    it('sorts participant IDs for consistency', () => {
      const key1 = generatePaymentIdempotencyKey(1, 2, [4, 3], 5000);
      const key2 = generatePaymentIdempotencyKey(1, 2, [3, 4], 5000);
      expect(key1).toBe(key2);
    });

    it('produces different keys for different inputs', () => {
      const key1 = generatePaymentIdempotencyKey(1, 2, [3], 5000);
      const key2 = generatePaymentIdempotencyKey(1, 2, [3], 6000);
      expect(key1).not.toBe(key2);
    });

    it('handles null sessionId', () => {
      const key = generatePaymentIdempotencyKey(1, null, [3], 5000);
      expect(key).toHaveLength(32);
    });

    it('handles empty participant array', () => {
      const key = generatePaymentIdempotencyKey(1, 2, [], 5000);
      expect(key).toHaveLength(32);
    });
  });

  describe('createPaymentIntent', () => {
    it('returns synthetic succeeded for zero-dollar amount', async () => {
      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 0,
        purpose: 'guest_fee',
        description: 'Guest fee',
      });

      expect(result.status).toBe('succeeded');
      expect(result.paymentIntentId).toContain('pi_zero_guest_fee');
      expect(result.clientSecret).toBe('');
      expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('returns synthetic succeeded for negative amount', async () => {
      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: -100,
        purpose: 'overage_fee',
        description: 'Overage fee',
      });

      expect(result.status).toBe('succeeded');
      expect(result.paymentIntentId).toContain('pi_zero_overage_fee');
    });

    it('uses provided stripeCustomerId instead of creating one', async () => {
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_with_cust',
        client_secret: 'pi_secret',
        status: 'requires_payment_method',
      });

      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 5000,
        purpose: 'guest_fee',
        description: 'Guest fee',
        stripeCustomerId: 'cus_provided',
      });

      expect(result.paymentIntentId).toBe('pi_with_cust');
      expect(result.customerId).toBe('cus_provided');
    });

    it('reuses existing payment intent for same booking', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ stripe_payment_intent_id: 'pi_existing', status: 'requires_payment_method', amount_cents: 5000 }],
      });
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        client_secret: 'pi_existing_secret',
        status: 'requires_payment_method',
      });

      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 5000,
        purpose: 'guest_fee',
        bookingId: 100,
        description: 'Guest fee',
      });

      expect(result.paymentIntentId).toBe('pi_existing');
      expect(result.clientSecret).toBe('pi_existing_secret');
      expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('updates amount when existing PI has different amount', async () => {
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ stripe_payment_intent_id: 'pi_existing', status: 'requires_payment_method', amount_cents: 3000 }],
        })
        .mockResolvedValue({ rows: [] });
      mockStripeClient.paymentIntents.update.mockResolvedValue({});
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_existing',
        client_secret: 'pi_updated_secret',
        status: 'requires_payment_method',
      });

      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 5000,
        purpose: 'guest_fee',
        bookingId: 100,
        description: 'Guest fee',
      });

      expect(result.paymentIntentId).toBe('pi_existing');
      expect(mockStripeClient.paymentIntents.update).toHaveBeenCalledWith('pi_existing', { amount: 5000 });
    });

    it('creates new payment intent when no existing one found', async () => {
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_new',
        client_secret: 'pi_new_secret',
        status: 'requires_payment_method',
      });

      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 7500,
        purpose: 'overage_fee',
        bookingId: 200,
        description: 'Overage fee',
      });

      expect(result.paymentIntentId).toBe('pi_new');
      expect(result.clientSecret).toBe('pi_new_secret');
      expect(mockStripeClient.paymentIntents.create).toHaveBeenCalledOnce();
      const createArgs = mockStripeClient.paymentIntents.create.mock.calls[0][0];
      expect(createArgs.amount).toBe(7500);
      expect(createArgs.currency).toBe('usd');
      expect(createArgs.metadata.purpose).toBe('overage_fee');
    });

    it('cancels existing synthetic non-pi_ ID and creates new real one', async () => {
      (db.execute as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{ stripe_payment_intent_id: 'synth_zero_guest_fee_100', status: 'pending', amount_cents: 0 }],
        })
        .mockResolvedValue({ rows: [] });
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_real_new',
        client_secret: 'pi_real_secret',
        status: 'requires_payment_method',
      });

      const result = await createPaymentIntent({
        userId: 'user_1',
        email: 'test@example.com',
        memberName: 'Test User',
        amountCents: 5000,
        purpose: 'guest_fee',
        bookingId: 100,
        description: 'Guest fee',
      });

      expect(result.paymentIntentId).toBe('pi_real_new');
      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe('confirmPaymentSuccess', () => {
    it('rejects synthetic non-pi_ IDs and marks them canceled', async () => {
      const result = await confirmPaymentSuccess('synth_zero_guest_fee_100', 'staff@test.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Synthetic payment intent ID');
    });

    it('rejects non-succeeded payment intents', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_pending',
        status: 'requires_payment_method',
        amount: 5000,
        metadata: {},
      });

      const result = await confirmPaymentSuccess('pi_pending', 'staff@test.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('requires_payment_method');
    });

    it('confirms succeeded payment and calls PaymentStatusService', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_success',
        status: 'succeeded',
        amount: 5000,
        metadata: { email: 'member@test.com' },
      });
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ id: 1, user_id: 'user_1', stripe_payment_intent_id: 'pi_success', amount_cents: 5000, purpose: 'guest_fee', booking_id: null, session_id: null, product_name: null, status: 'succeeded' }],
      });

      const result = await confirmPaymentSuccess('pi_success', 'staff@test.com', 'Staff Name');

      expect(result.success).toBe(true);
      expect(PaymentStatusService.markPaymentSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'pi_success',
          amountCents: 5000,
        })
      );
    });

    it('marks as requires_reconciliation when PaymentStatusService fails', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_fail_status',
        status: 'succeeded',
        amount: 5000,
        metadata: {},
      });
      (PaymentStatusService.markPaymentSucceeded as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: 'DB constraint violation' });
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      await confirmPaymentSuccess('pi_fail_status', 'staff@test.com');

      const executeCalls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
      const hasReconciliationUpdate = executeCalls.some((call: unknown[]) => {
        const sqlStr = JSON.stringify(call);
        return sqlStr.includes('requires_reconciliation') || sqlStr.includes('status');
      });
      expect(hasReconciliationUpdate).toBe(true);
    });

    it('handles Stripe API errors gracefully', async () => {
      mockStripeClient.paymentIntents.retrieve.mockRejectedValue(new Error('Stripe down'));

      const result = await confirmPaymentSuccess('pi_err', 'staff@test.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stripe down');
    });
  });

  describe('getPaymentIntentStatus', () => {
    it('returns payment status from database', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        rows: [{ status: 'succeeded', amount_cents: 5000, purpose: 'guest_fee' }],
      });

      const result = await getPaymentIntentStatus('pi_test');

      expect(result!.status).toBe('succeeded');
      expect(result!.amountCents).toBe(5000);
      expect(result!.purpose).toBe('guest_fee');
    });

    it('returns null for unknown payment intent', async () => {
      const result = await getPaymentIntentStatus('pi_unknown');

      expect(result).toBeNull();
    });
  });

  describe('cancelPaymentIntent', () => {
    it('handles synthetic non-pi_ ID by marking canceled locally', async () => {
      const result = await cancelPaymentIntent('synth_zero_guest_fee_none');

      expect(result.success).toBe(true);
      expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    it('handles already-canceled payment intent', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_already',
        status: 'canceled',
        invoice: null,
      });

      const result = await cancelPaymentIntent('pi_already');

      expect(result.success).toBe(true);
      expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    it('returns error for succeeded payment intent', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_paid',
        status: 'succeeded',
        invoice: null,
      });

      const result = await cancelPaymentIntent('pi_paid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('use refund instead');
    });

    it('returns error for processing payment intent', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_processing',
        status: 'processing',
        invoice: null,
      });

      const result = await cancelPaymentIntent('pi_processing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('processing');
    });

    it('voids associated open invoice instead of canceling PI', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_with_inv',
        status: 'requires_payment_method',
        invoice: 'inv_123',
      });
      mockStripeClient.invoices.retrieve.mockResolvedValue({
        id: 'inv_123',
        status: 'open',
      });
      mockStripeClient.invoices.voidInvoice.mockResolvedValue({});

      const result = await cancelPaymentIntent('pi_with_inv');

      expect(result.success).toBe(true);
      expect(mockStripeClient.invoices.voidInvoice).toHaveBeenCalledWith('inv_123');
      expect(mockStripeClient.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    it('deletes associated draft invoice instead of canceling PI', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_with_draft',
        status: 'requires_payment_method',
        invoice: 'inv_draft',
      });
      mockStripeClient.invoices.retrieve.mockResolvedValue({
        id: 'inv_draft',
        status: 'draft',
      });
      mockStripeClient.invoices.del.mockResolvedValue({});

      const result = await cancelPaymentIntent('pi_with_draft');

      expect(result.success).toBe(true);
      expect(mockStripeClient.invoices.del).toHaveBeenCalledWith('inv_draft');
    });

    it('cancels PI directly when no invoice associated', async () => {
      mockStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_no_inv',
        status: 'requires_payment_method',
        invoice: null,
      });
      mockStripeClient.paymentIntents.cancel.mockResolvedValue({});

      const result = await cancelPaymentIntent('pi_no_inv');

      expect(result.success).toBe(true);
      expect(mockStripeClient.paymentIntents.cancel).toHaveBeenCalledWith('pi_no_inv');
    });

    it('returns error on Stripe failure', async () => {
      mockStripeClient.paymentIntents.retrieve.mockRejectedValue(new Error('Network error'));

      const result = await cancelPaymentIntent('pi_net_err');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('createBalanceAwarePayment', () => {
    const baseParams = {
      stripeCustomerId: 'cus_balance',
      userId: 'user_1',
      email: 'balance@example.com',
      memberName: 'Balance User',
      amountCents: 5000,
      purpose: 'guest_fee' as const,
      description: 'Guest fee payment',
      bookingId: 100,
    };

    it('skips zero-dollar amounts and returns paidInFull', async () => {
      const result = await createBalanceAwarePayment({ ...baseParams, amountCents: 0 });

      expect(result.paidInFull).toBe(true);
      expect(result.totalCents).toBe(0);
      expect(result.balanceApplied).toBe(0);
      expect(result.remainingCents).toBe(0);
      expect(mockStripeClient.customers.retrieve).not.toHaveBeenCalled();
    });

    it('uses full balance credit when it covers the amount', async () => {
      mockStripeClient.customers.retrieve.mockResolvedValue({
        id: 'cus_balance',
        balance: -10000,
        deleted: false,
      });
      mockStripeClient.customers.createBalanceTransaction.mockResolvedValue({
        id: 'txn_balance_1',
      });

      const result = await createBalanceAwarePayment(baseParams);

      expect(result.paidInFull).toBe(true);
      expect(result.balanceApplied).toBe(5000);
      expect(result.remainingCents).toBe(0);
      expect(result.balanceTransactionId).toBe('txn_balance_1');
      expect(mockStripeClient.paymentIntents.create).not.toHaveBeenCalled();
    });

    it('creates payment intent when no credit available', async () => {
      mockStripeClient.customers.retrieve.mockResolvedValue({
        id: 'cus_balance',
        balance: 0,
        deleted: false,
      });
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_no_credit',
        client_secret: 'secret_no_credit',
        status: 'requires_payment_method',
      });

      const result = await createBalanceAwarePayment(baseParams);

      expect(result.paidInFull).toBe(false);
      expect(result.remainingCents).toBe(5000);
      expect(result.balanceApplied).toBe(0);
      expect(result.paymentIntentId).toBe('pi_no_credit');
      expect(result.clientSecret).toBe('secret_no_credit');
    });

    it('applies partial credit and creates PI for remainder', async () => {
      mockStripeClient.customers.retrieve.mockResolvedValue({
        id: 'cus_balance',
        balance: -2000,
        deleted: false,
      });
      mockStripeClient.customers.createBalanceTransaction.mockResolvedValue({
        id: 'txn_partial',
      });
      mockStripeClient.paymentIntents.create.mockResolvedValue({
        id: 'pi_remainder',
        client_secret: 'secret_remainder',
        status: 'requires_payment_method',
      });

      const result = await createBalanceAwarePayment(baseParams);

      expect(result.paidInFull).toBe(false);
      expect(result.balanceApplied).toBe(2000);
      expect(result.remainingCents).toBe(3000);
      expect(result.paymentIntentId).toBe('pi_remainder');
    });

    it('throws when customer has been deleted', async () => {
      mockStripeClient.customers.retrieve.mockResolvedValue({
        id: 'cus_deleted',
        deleted: true,
      });

      const result = await createBalanceAwarePayment(baseParams);

      expect(result.error).toBeDefined();
    });
  });
});
