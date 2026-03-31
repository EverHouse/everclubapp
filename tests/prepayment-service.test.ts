// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/stripe/customers', () => ({
  getOrCreateStripeCustomer: vi.fn(() =>
    Promise.resolve({ customerId: 'cus_prepay', isNew: false })
  ),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  createDraftInvoiceForBooking: vi.fn(),
}));

import { createPrepaymentIntent } from '../server/core/billing/prepaymentService';
import { createDraftInvoiceForBooking } from '../server/core/billing/bookingInvoiceService';
import { db } from '../server/db';

const mockCreateDraftInvoice = createDraftInvoiceForBooking as ReturnType<typeof vi.fn>;
const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Prepayment Service', () => {
  const baseParams = {
    sessionId: 10,
    bookingId: 100,
    userId: 'user_1',
    userEmail: 'member@example.com',
    userName: 'Test Member',
    totalFeeCents: 5000,
    feeBreakdown: { overageCents: 2500, guestCents: 2500 },
  };

  describe('createPrepaymentIntent', () => {
    it('returns null when totalFeeCents is 0', async () => {
      const result = await createPrepaymentIntent({ ...baseParams, totalFeeCents: 0 });

      expect(result).toBeNull();
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it('returns null when totalFeeCents is negative', async () => {
      const result = await createPrepaymentIntent({ ...baseParams, totalFeeCents: -100 });

      expect(result).toBeNull();
    });

    it('returns null for invalid email', async () => {
      const result = await createPrepaymentIntent({ ...baseParams, userEmail: 'invalid' });

      expect(result).toBeNull();
    });

    it('returns null for empty email', async () => {
      const result = await createPrepaymentIntent({ ...baseParams, userEmail: '' });

      expect(result).toBeNull();
    });

    it('skips staff members (exempt from fees)', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'staff@example.com', user_name: 'Staff' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'Staff', tier: 'Staff', unlimited_access: false }] });

      const result = await createPrepaymentIntent({
        ...baseParams,
        userEmail: 'staff@example.com',
      });

      expect(result).toBeNull();
    });

    it('skips admin users', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'admin@example.com', user_name: 'Admin' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'admin', tier: 'Admin', unlimited_access: false }] });

      const result = await createPrepaymentIntent({
        ...baseParams,
        userEmail: 'admin@example.com',
      });

      expect(result).toBeNull();
    });

    it('skips users with unlimited access', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'vip@example.com', user_name: 'VIP' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'member', tier: 'Platinum', unlimited_access: true }] });

      const result = await createPrepaymentIntent({
        ...baseParams,
        userEmail: 'vip@example.com',
      });

      expect(result).toBeNull();
    });

    it('skips unmatched bookings without assigned member', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: true, user_email: null, user_name: null }] });

      const result = await createPrepaymentIntent({
        ...baseParams,
        userEmail: 'member@example.com',
      });

      expect(result).toBeNull();
    });

    it('skips when draft invoice already exists', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'member@example.com', user_name: 'Member' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'member', tier: 'Gold', unlimited_access: false }] })
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: 'inv_existing' }] });

      const result = await createPrepaymentIntent(baseParams);

      expect(result).toBeNull();
    });

    it('creates prepayment intent for eligible member', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'member@example.com', user_name: 'Member' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'member', tier: 'Gold', unlimited_access: false }] })
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: null }] })
        .mockResolvedValueOnce({ rows: [{ resource_type: 'simulator' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_booking_id: 'TM-123' }] })
        .mockResolvedValueOnce({
          rows: [
            { id: 5, participant_type: 'owner', display_name: 'Member', cached_fee_cents: '2500' },
            { id: 6, participant_type: 'guest', display_name: 'Guest', cached_fee_cents: '2500' },
          ],
        });

      mockCreateDraftInvoice.mockResolvedValue({ invoiceId: 'inv_prepay' });

      const result = await createPrepaymentIntent(baseParams);

      expect(result).not.toBeNull();
      expect(result!.invoiceId).toBe('inv_prepay');
      expect(result!.paidInFull).toBe(false);
      expect(mockCreateDraftInvoice).toHaveBeenCalledOnce();
    });

    it('uses fallback line items when no participants found', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'member@example.com', user_name: 'Member' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'member', tier: 'Gold', unlimited_access: false }] })
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: null }] })
        .mockResolvedValueOnce({ rows: [{ resource_type: 'simulator' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_booking_id: null }] })
        .mockResolvedValueOnce({ rows: [] });

      mockCreateDraftInvoice.mockResolvedValue({ invoiceId: 'inv_fallback' });

      const result = await createPrepaymentIntent(baseParams);

      expect(result).not.toBeNull();
      expect(result!.invoiceId).toBe('inv_fallback');
      const call = mockCreateDraftInvoice.mock.calls[0][0];
      expect(call.feeLineItems.length).toBeGreaterThan(0);
    });

    it('returns null on invoice creation error', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'member@example.com', user_name: 'Member' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'member', tier: 'Gold', unlimited_access: false }] })
        .mockResolvedValueOnce({ rows: [{ stripe_invoice_id: null }] })
        .mockResolvedValueOnce({ rows: [{ resource_type: 'simulator' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_booking_id: null }] })
        .mockResolvedValueOnce({ rows: [] });

      mockCreateDraftInvoice.mockRejectedValue(new Error('Stripe error'));

      const result = await createPrepaymentIntent(baseParams);

      expect(result).toBeNull();
    });

    it('skips golf_instructor role', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ is_unmatched: false, user_email: 'instructor@example.com', user_name: 'Pro' }] })
        .mockResolvedValueOnce({ rows: [{ role: 'golf_instructor', tier: 'Instructor', unlimited_access: false }] });

      const result = await createPrepaymentIntent({
        ...baseParams,
        userEmail: 'instructor@example.com',
      });

      expect(result).toBeNull();
    });
  });
});
