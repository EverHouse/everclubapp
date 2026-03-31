// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sharedStripeClient } = vi.hoisted(() => ({
  sharedStripeClient: {
    invoices: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      del: vi.fn(),
      finalizeInvoice: vi.fn(),
      voidInvoice: vi.fn(),
      list: vi.fn(),
      pay: vi.fn(),
    },
    invoiceItems: { create: vi.fn() },
    customers: { retrieve: vi.fn(), createBalanceTransaction: vi.fn() },
    paymentIntents: { retrieve: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    update: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(sharedStripeClient)),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/websocket', () => ({
  broadcastBookingInvoiceUpdate: vi.fn(),
}));

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id' },
  notifications: {},
}));

vi.mock('../shared/models/notifications', () => ({
  notifications: {},
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  PRICING: { guestFee: 5000, memberFee: 0 },
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  markPaymentRefunded: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../shared/constants/statuses', () => ({
  BOOKING_STATUS: { APPROVED: 'approved', PENDING: 'pending', CANCELLED: 'cancelled' },
  PARTICIPANT_TYPE: { MEMBER: 'member', GUEST: 'guest' },
  RESOURCE_TYPE: { SIMULATOR: 'simulator', CONFERENCE_ROOM: 'conference_room' },
  PAYMENT_STATUS: { PAID: 'paid', WAIVED: 'waived', PENDING: 'pending', REFUNDED: 'refunded' },
}));

import {
  getBookingInvoiceId,
  getBookingInvoiceStatus,
  buildInvoiceDescription,
  isBookingInvoicePaid,
  checkBookingPaymentStatus,
} from '../server/core/billing/bookingInvoiceService';
import { db } from '../server/db';

const mockDb = db as {
  execute: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockResolvedValue({ rows: [] });
});

describe('Booking Invoice Service', () => {
  describe('getBookingInvoiceId', () => {
    it('returns invoice ID when booking has one', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: 'inv_booking_1' }],
      });

      const result = await getBookingInvoiceId(100);

      expect(result).toBe('inv_booking_1');
    });

    it('returns null when booking has no invoice', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: null }],
      });

      const result = await getBookingInvoiceId(100);

      expect(result).toBeNull();
    });

    it('returns null when booking does not exist', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await getBookingInvoiceId(999);

      expect(result).toBeNull();
    });
  });

  describe('getBookingInvoiceStatus', () => {
    it('returns null when booking has no invoice', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [{ stripe_invoice_id: null }] });

      const result = await getBookingInvoiceStatus(100);

      expect(result).toBeNull();
    });

    it('returns invoice status from Stripe', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: 'inv_status_1' }],
      });
      sharedStripeClient.invoices.retrieve.mockResolvedValue({
        id: 'inv_status_1',
        status: 'paid',
        amount_due: 5000,
      });

      const result = await getBookingInvoiceStatus(100);

      expect(result).toEqual({
        invoiceId: 'inv_status_1',
        status: 'paid',
        amountDue: 5000,
      });
    });

    it('returns null on Stripe retrieval failure', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: 'inv_gone' }],
      });
      sharedStripeClient.invoices.retrieve.mockRejectedValue(new Error('Not found'));

      const result = await getBookingInvoiceStatus(100);

      expect(result).toBeNull();
    });
  });

  describe('buildInvoiceDescription', () => {
    it('builds description with trackman booking ID', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const desc = await buildInvoiceDescription(100, '12345');

      expect(desc).toContain('TM-12345');
      expect(desc).toContain('Booking');
    });

    it('builds description without trackman booking ID', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const desc = await buildInvoiceDescription(100, null);

      expect(desc).toContain('#100');
      expect(desc).toContain('fees');
    });

    it('includes resource and date info when booking details exist', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ request_date: '2025-06-15', start_time: '14:00', end_time: '15:00', resource_name: 'Bay 1' }],
      });

      const desc = await buildInvoiceDescription(100, null);

      expect(desc).toContain('Bay 1');
      expect(desc).toContain('#100');
    });
  });

  describe('isBookingInvoicePaid', () => {
    it('returns locked=false when no invoice exists', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: null }],
      });

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(false);
    });

    it('returns locked=true when invoice is paid', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: 'inv_paid' }],
      });
      sharedStripeClient.invoices.retrieve.mockResolvedValue({
        id: 'inv_paid',
        status: 'paid',
      });

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(true);
      expect(result.invoiceId).toBe('inv_paid');
      expect(result.reason).toContain('paid');
    });

    it('returns locked=false when invoice is not paid', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ stripe_invoice_id: 'inv_draft' }],
      });
      sharedStripeClient.invoices.retrieve.mockResolvedValue({
        id: 'inv_draft',
        status: 'draft',
      });

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(false);
    });

    it('falls back to fee snapshot when Stripe fails', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: 'inv_err' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, total_cents: 5000 }] });
      sharedStripeClient.invoices.retrieve.mockRejectedValue(new Error('Stripe down'));

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(true);
      expect(result.reason).toContain('snapshot');
    });

    it('returns locked=false on Stripe failure with no snapshot', async () => {
      mockDb.execute
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: 'inv_err2' }] })
        .mockResolvedValueOnce({ rows: [] });
      sharedStripeClient.invoices.retrieve.mockRejectedValue(new Error('Stripe down'));

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(false);
    });

    it('returns locked=true on DB failure as precaution', async () => {
      mockDb.execute.mockRejectedValue(new Error('DB down'));

      const result = await isBookingInvoicePaid(100);

      expect(result.locked).toBe(true);
      expect(result.reason).toContain('precaution');
    });
  });

  describe('checkBookingPaymentStatus', () => {
    it('returns hasPaidFees and hasCompletedSnapshot when participants are paid', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ paid_count: '3', total_with_fees: '3', pending_count: '0' }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, total_cents: 15000 }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const result = await checkBookingPaymentStatus({
        bookingId: 100,
        sessionId: 200,
      });

      expect(result.hasPaidFees).toBe(true);
      expect(result.pendingFeeCount).toBe(0);
      expect(result.paidCount).toBe(3);
      expect(result.hasCompletedSnapshot).toBe(true);
    });

    it('returns pending fees when some are unpaid', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ paid_count: '1', total_with_fees: '3', pending_count: '2' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkBookingPaymentStatus({
        bookingId: 100,
        sessionId: 200,
      });

      expect(result.allPaid).toBe(false);
      expect(result.pendingFeeCount).toBe(2);
      expect(result.hasCompletedSnapshot).toBe(false);
    });

    it('returns zero counts when no participants exist', async () => {
      mockDb.execute
        .mockResolvedValueOnce({
          rows: [{ paid_count: '0', total_with_fees: '0', pending_count: '0' }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await checkBookingPaymentStatus({
        bookingId: 100,
        sessionId: 200,
      });

      expect(result.paidCount).toBe(0);
      expect(result.totalWithFees).toBe(0);
    });
  });
});
