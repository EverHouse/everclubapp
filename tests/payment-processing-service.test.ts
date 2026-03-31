// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    paymentIntents: { retrieve: vi.fn(), update: vi.fn(), create: vi.fn() },
    customers: { retrieve: vi.fn(), createBalanceTransaction: vi.fn() },
    invoices: { create: vi.fn(), retrieve: vi.fn(), finalizeInvoice: vi.fn(), pay: vi.fn() },
    invoiceItems: { create: vi.fn() },
    customerSessions: { create: vi.fn() },
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((fn: Function) => fn({
      execute: vi.fn(() => Promise.resolve({ rows: [] })),
    })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(sharedStripeClient)),
}));

vi.mock('../server/core/stripe', () => ({
  confirmPaymentSuccess: vi.fn(() => Promise.resolve({ success: true })),
  getOrCreateStripeCustomer: vi.fn(() => Promise.resolve({ customerId: 'cus_test', isNew: false })),
  createBalanceAwarePayment: vi.fn(() => Promise.resolve({ paidInFull: false, clientSecret: 'cs_test', paymentIntentId: 'pi_test', totalCents: 5000, balanceApplied: 0, remainingCents: 5000 })),
  cancelPaymentIntent: vi.fn(() => Promise.resolve({ success: true })),
  createPaymentIntent: vi.fn(() => Promise.resolve({ paymentIntentId: 'pi_test', clientSecret: 'cs_test' })),
}));

vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../server/core/stripe/paymentRepository', () => ({
  getPaymentByIntentId: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn(() => Promise.resolve({
    participants: [],
    totals: { totalCents: 5000, guestFeeCents: 5000, overageCents: 0, memberCount: 1, guestCount: 1, overageCount: 0 },
  })),
  applyFeeBreakdownToParticipants: vi.fn(() => Promise.resolve()),
  getEffectivePlayerCount: vi.fn(() => 2),
}));

vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: vi.fn(),
  broadcastBillingUpdate: vi.fn(),
  broadcastBookingInvoiceUpdate: vi.fn(),
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  createDraftInvoiceForBooking: vi.fn(() => Promise.resolve({ invoiceId: 'inv_test', totalCents: 5000 })),
  buildInvoiceDescription: vi.fn(() => Promise.resolve('Booking #100 fees')),
  finalizeAndPayInvoice: vi.fn(() => Promise.resolve({
    invoiceId: 'inv_test', paymentIntentId: 'pi_inv', clientSecret: 'cs_inv', status: 'open',
    paidInFull: false, hostedInvoiceUrl: null, invoicePdf: null, amountFromBalance: 0, amountCharged: 5000,
  })),
  getBookingInvoiceId: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../server/core/billing/paymentTypes', () => ({
  describeFee: vi.fn(() => 'Guest fee'),
  finalizeInvoiceWithPi: vi.fn(() => Promise.resolve()),
  handleExistingInvoicePayment: vi.fn(() => Promise.resolve(null)),
}));

import { processPayFees, processConfirmPayment } from '../server/core/billing/paymentProcessingService';
import { confirmPaymentSuccess } from '../server/core/stripe';
import { db } from '../server/db';

const mockDb = db as {
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe('Payment Processing Service', () => {
  describe('processPayFees', () => {
    it('returns 404 when booking is not found', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await processPayFees({
        bookingId: 999,
        memberEmail: 'test@example.com',
        useAccountBalance: false,
        source: 'member',
      });

      expect(result.status).toBe(404);
      expect((result.body as { error: string }).error).toContain('not found');
    });

    it('returns 400 for cancelled bookings', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          id: 1, session_id: 10, user_email: 'test@example.com',
          user_name: 'Test User', status: 'cancelled',
          trackman_booking_id: null, user_id: 'u1',
          first_name: 'Test', last_name: 'User',
        }],
      });

      const result = await processPayFees({
        bookingId: 1,
        memberEmail: 'test@example.com',
        useAccountBalance: false,
        source: 'member',
      });

      expect(result.status).toBe(400);
      expect((result.body as { error: string }).error).toContain('cancelled');
    });

    it('returns 403 when non-owner tries to pay', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          id: 1, session_id: 10, user_email: 'owner@example.com',
          user_name: 'Owner', status: 'approved',
          trackman_booking_id: null, user_id: 'u1',
          first_name: 'Owner', last_name: 'User',
        }],
      });

      const result = await processPayFees({
        bookingId: 1,
        memberEmail: 'notowner@example.com',
        useAccountBalance: false,
        source: 'member',
      });

      expect(result.status).toBe(403);
      expect((result.body as { error: string }).error).toContain('owner');
    });

    it('returns 400 when booking has no session', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          id: 1, session_id: null, user_email: 'test@example.com',
          user_name: 'Test', status: 'approved',
          trackman_booking_id: null, user_id: 'u1',
          first_name: 'Test', last_name: 'User',
        }],
      });

      const result = await processPayFees({
        bookingId: 1,
        memberEmail: 'test@example.com',
        useAccountBalance: false,
        source: 'member',
      });

      expect(result.status).toBe(400);
      expect((result.body as { error: string }).error).toContain('session');
    });

    it('returns 200 with all-settled when no pending participants', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{
            id: 1, session_id: 10, user_email: 'test@example.com',
            user_name: 'Test', status: 'approved',
            trackman_booking_id: null, user_id: 'u1',
            first_name: 'Test', last_name: 'User',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ total: '2', paid_count: '2', unpaid_with_fees: '0' }],
        })
        .mockResolvedValueOnce({
          rows: [{ stripe_payment_intent_id: 'pi_real_settled' }],
        });

      sharedStripeClient.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_real_settled',
        status: 'succeeded',
      });

      const result = await processPayFees({
        bookingId: 1,
        memberEmail: 'test@example.com',
        useAccountBalance: false,
        source: 'member',
      });

      expect(result.status).toBe(200);
      const body = result.body as { paidInFull: boolean };
      expect(body.paidInFull).toBe(true);
    });
  });

  describe('processConfirmPayment', () => {
    it('returns 404 when booking is not found', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await processConfirmPayment({
        bookingId: 999,
        memberEmail: 'test@example.com',
        paymentIntentId: 'pi_test',
        source: 'member',
      });

      expect(result.status).toBe(404);
      expect(result.body.error).toContain('not found');
    });

    it('returns 403 when non-owner tries to confirm', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{
          id: 1, session_id: 10, user_email: 'owner@example.com', user_name: 'Owner',
        }],
      });

      const result = await processConfirmPayment({
        bookingId: 1,
        memberEmail: 'notowner@example.com',
        paymentIntentId: 'pi_test',
        source: 'member',
      });

      expect(result.status).toBe(403);
      expect(result.body.error).toContain('owner');
    });

    it('returns 404 when payment snapshot not found', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{
            id: 1, session_id: 10, user_email: 'test@example.com', user_name: 'Test',
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await processConfirmPayment({
        bookingId: 1,
        memberEmail: 'test@example.com',
        paymentIntentId: 'pi_missing',
        source: 'member',
      });

      expect(result.status).toBe(404);
      expect(result.body.error).toContain('Payment record not found');
    });

    it('returns 200 when snapshot already completed', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{
            id: 1, session_id: 10, user_email: 'test@example.com', user_name: 'Test',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, participant_fees: '[]', status: 'completed' }],
        });

      const result = await processConfirmPayment({
        bookingId: 1,
        memberEmail: 'test@example.com',
        paymentIntentId: 'pi_done',
        source: 'member',
      });

      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.message).toContain('already confirmed');
    });

    it('confirms payment and updates participants', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{
            id: 1, session_id: 10, user_email: 'test@example.com', user_name: 'Test',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 5,
            participant_fees: JSON.stringify([{ id: 101, amountCents: 5000 }]),
            status: 'pending',
          }],
        })
        .mockResolvedValue({ rows: [] });

      mockDb.transaction.mockImplementation(async (fn: Function) => {
        const tx = { execute: vi.fn(() => Promise.resolve({ rows: [] })) };
        return fn(tx);
      });

      const result = await processConfirmPayment({
        bookingId: 1,
        memberEmail: 'test@example.com',
        paymentIntentId: 'pi_confirm',
        source: 'member',
      });

      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
      expect(confirmPaymentSuccess).toHaveBeenCalledWith(
        'pi_confirm',
        'test@example.com',
        'Test'
      );
    });

    it('returns 400 when confirmPaymentSuccess fails', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{
            id: 1, session_id: 10, user_email: 'test@example.com', user_name: 'Test',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 5,
            participant_fees: JSON.stringify([{ id: 101, amountCents: 5000 }]),
            status: 'pending',
          }],
        })
        .mockResolvedValue({ rows: [] });

      (confirmPaymentSuccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Payment not succeeded',
      });

      const result = await processConfirmPayment({
        bookingId: 1,
        memberEmail: 'test@example.com',
        paymentIntentId: 'pi_fail',
        source: 'member',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBeDefined();
    });
  });
});
