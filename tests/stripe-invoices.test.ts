// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoiceResponseBase = {
  status: 'draft',
  customer: 'cus_123',
  amount_due: 5000,
  amount_paid: 0,
  currency: 'usd',
  customer_email: 'test@example.com',
  description: 'Test invoice',
  hosted_invoice_url: null,
  invoice_pdf: null,
  created: 1700000000,
  due_date: null,
  status_transitions: { paid_at: null },
  lines: { data: [] },
};

const mockStripeClient = {
  invoices: {
    create: vi.fn(),
    createPreview: vi.fn(),
    finalizeInvoice: vi.fn(),
    sendInvoice: vi.fn(),
    pay: vi.fn(),
    voidInvoice: vi.fn(),
    del: vi.fn(),
    list: vi.fn(),
    retrieve: vi.fn(),
  },
  invoiceItems: { create: vi.fn() },
  paymentIntents: { create: vi.fn() },
};

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve(mockStripeClient)),
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  isStripeResourceMissing: vi.fn((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e) {
      return (e as { code: string }).code === 'resource_missing';
    }
    return false;
  }),
}));

import {
  createInvoice,
  finalizeAndSendInvoice,
  listCustomerInvoices,
  voidInvoice,
} from '../server/core/stripe/invoices';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Invoice and Billing', () => {
  describe('createInvoice', () => {
    it('creates an invoice with price-based items', async () => {
      mockStripeClient.invoices.create.mockResolvedValue({ id: 'inv_test', ...invoiceResponseBase });
      mockStripeClient.invoiceItems.create.mockResolvedValue({ id: 'ii_1' });
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_test', ...invoiceResponseBase });

      const result = await createInvoice({
        customerId: 'cus_123',
        items: [{ priceId: 'price_abc', quantity: 2 }],
        description: 'Test invoice',
      });

      expect(result.success).toBe(true);
      expect(result.invoice?.id).toBe('inv_test');
      expect(result.invoice?.amountDue).toBe(5000);
      expect(result.invoice?.currency).toBe('usd');
      expect(mockStripeClient.invoices.create).toHaveBeenCalledOnce();
      expect(mockStripeClient.invoiceItems.create).toHaveBeenCalledOnce();
    });

    it('creates an invoice with custom amount items', async () => {
      mockStripeClient.invoices.create.mockResolvedValue({ id: 'inv_custom', ...invoiceResponseBase, amount_due: 2500, description: 'Overage fee' });
      mockStripeClient.invoiceItems.create.mockResolvedValue({ id: 'ii_2' });
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_custom', ...invoiceResponseBase, amount_due: 2500, description: 'Overage fee' });

      const result = await createInvoice({
        customerId: 'cus_123',
        items: [{ amountCents: 2500, description: 'Overage 30 min' }],
        description: 'Overage fee',
      });

      expect(result.success).toBe(true);
      expect(result.invoice?.id).toBe('inv_custom');
      expect(result.invoice?.amountDue).toBe(2500);
    });

    it('rejects empty items array', async () => {
      const result = await createInvoice({
        customerId: 'cus_123',
        items: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one invoice item is required');
      expect(mockStripeClient.invoices.create).not.toHaveBeenCalled();
    });

    it('handles Stripe errors gracefully', async () => {
      mockStripeClient.invoices.create.mockRejectedValue(new Error('Customer not found'));

      const result = await createInvoice({
        customerId: 'cus_missing',
        items: [{ amountCents: 1000, description: 'Test' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });

    it('uses idempotency keys for invoice creation', async () => {
      mockStripeClient.invoices.create.mockResolvedValue({ id: 'inv_idemp', ...invoiceResponseBase });
      mockStripeClient.invoiceItems.create.mockResolvedValue({ id: 'ii_3' });
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_idemp', ...invoiceResponseBase });

      await createInvoice({
        customerId: 'cus_123',
        items: [{ priceId: 'price_abc' }],
        description: 'Test',
      });

      const call = mockStripeClient.invoices.create.mock.calls[0];
      expect(call[1]).toHaveProperty('idempotencyKey');
    });

    it('creates multiple line items for an invoice', async () => {
      mockStripeClient.invoices.create.mockResolvedValue({ id: 'inv_multi', ...invoiceResponseBase, amount_due: 7500 });
      mockStripeClient.invoiceItems.create.mockResolvedValue({ id: 'ii_multi' });
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_multi', ...invoiceResponseBase, amount_due: 7500 });

      await createInvoice({
        customerId: 'cus_123',
        items: [
          { priceId: 'price_overage', quantity: 1 },
          { amountCents: 2500, description: 'Guest fee' },
          { priceId: 'price_cafe', quantity: 3 },
        ],
      });

      expect(mockStripeClient.invoiceItems.create).toHaveBeenCalledTimes(3);
    });

    it('includes ever_house_app source in metadata', async () => {
      mockStripeClient.invoices.create.mockResolvedValue({ id: 'inv_meta', ...invoiceResponseBase });
      mockStripeClient.invoiceItems.create.mockResolvedValue({ id: 'ii_m' });
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_meta', ...invoiceResponseBase });

      await createInvoice({
        customerId: 'cus_123',
        items: [{ priceId: 'price_abc' }],
      });

      const createCall = mockStripeClient.invoices.create.mock.calls[0][0];
      expect(createCall.metadata.source).toBe('ever_house_app');
    });
  });

  describe('finalizeAndSendInvoice', () => {
    it('finalizes and sends an invoice successfully', async () => {
      mockStripeClient.invoices.finalizeInvoice.mockResolvedValue({
        id: 'inv_fin',
        ...invoiceResponseBase,
        status: 'open',
      });
      mockStripeClient.invoices.sendInvoice.mockResolvedValue({});

      const result = await finalizeAndSendInvoice('inv_fin');

      expect(result.success).toBe(true);
      expect(result.invoice?.id).toBe('inv_fin');
      expect(result.invoice?.status).toBe('open');
      expect(mockStripeClient.invoices.finalizeInvoice).toHaveBeenCalledWith('inv_fin');
      expect(mockStripeClient.invoices.sendInvoice).toHaveBeenCalledWith('inv_fin');
    });

    it('returns error when finalization fails', async () => {
      mockStripeClient.invoices.finalizeInvoice.mockRejectedValue(new Error('Invoice already finalized'));

      const result = await finalizeAndSendInvoice('inv_bad');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invoice already finalized');
    });
  });

  describe('listCustomerInvoices', () => {
    it('lists invoices for a customer', async () => {
      mockStripeClient.invoices.list.mockResolvedValue({
        data: [
          { id: 'inv_1', ...invoiceResponseBase, status: 'paid', amount_paid: 5000 },
          { id: 'inv_2', ...invoiceResponseBase, status: 'open' },
        ],
      });

      const result = await listCustomerInvoices('cus_123');

      expect(result.success).toBe(true);
      expect(result.invoices).toHaveLength(2);
      expect(result.invoices![0].id).toBe('inv_1');
      expect(result.invoices![1].id).toBe('inv_2');
    });

    it('returns isCustomerMissing for non-existent customer', async () => {
      const err = Object.assign(new Error('Customer not found'), { code: 'resource_missing' });
      mockStripeClient.invoices.list.mockRejectedValue(err);

      const result = await listCustomerInvoices('cus_gone');

      expect(result.success).toBe(false);
      expect(result.isCustomerMissing).toBe(true);
    });
  });

  describe('voidInvoice', () => {
    it('deletes a draft invoice', async () => {
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_draft', status: 'draft' });
      mockStripeClient.invoices.del.mockResolvedValue({ deleted: true });

      const result = await voidInvoice('inv_draft');

      expect(result.success).toBe(true);
      expect(mockStripeClient.invoices.del).toHaveBeenCalledWith('inv_draft');
      expect(mockStripeClient.invoices.voidInvoice).not.toHaveBeenCalled();
    });

    it('voids an open invoice', async () => {
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_open', status: 'open' });
      mockStripeClient.invoices.voidInvoice.mockResolvedValue({});

      const result = await voidInvoice('inv_open');

      expect(result.success).toBe(true);
      expect(mockStripeClient.invoices.voidInvoice).toHaveBeenCalledWith('inv_open');
      expect(mockStripeClient.invoices.del).not.toHaveBeenCalled();
    });

    it('returns success for already voided invoice', async () => {
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_void', status: 'void' });

      const result = await voidInvoice('inv_void');

      expect(result.success).toBe(true);
    });

    it('returns error for paid invoice', async () => {
      mockStripeClient.invoices.retrieve.mockResolvedValue({ id: 'inv_paid', status: 'paid' });

      const result = await voidInvoice('inv_paid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot void invoice in status: paid');
    });

    it('returns error when Stripe API fails', async () => {
      mockStripeClient.invoices.retrieve.mockRejectedValue(new Error('Stripe error'));

      const result = await voidInvoice('inv_err');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stripe error');
    });
  });
});
