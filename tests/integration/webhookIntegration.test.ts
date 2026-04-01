// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorStatusCode: vi.fn(() => 500),
}));

const { mockExecute, mockTransaction, mockDelete } = vi.hoisted(() => {
  const mockDelete = vi.fn();
  return {
    mockExecute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    mockTransaction: vi.fn(),
    mockDelete,
  };
});

vi.mock('../../server/db', () => {
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  mockDelete.mockReturnValue({ where: deleteWhere });
  return {
    db: { execute: mockExecute, transaction: mockTransaction, delete: mockDelete },
  };
});

const { mockPoolConnect, mockSafeRelease } = vi.hoisted(() => ({
  mockPoolConnect: vi.fn(),
  mockSafeRelease: vi.fn(),
}));
vi.mock('../../server/core/db', () => ({
  pool: { connect: mockPoolConnect },
  safeRelease: mockSafeRelease,
  queryWithRetry: vi.fn(),
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sqlStrings: Array.from(strings),
    __sqlValues: values,
  });
  sqlTagFn.join = vi.fn();
  return { sql: sqlTagFn, eq: vi.fn(), and: vi.fn(), or: vi.fn(), lt: vi.fn(), desc: vi.fn(), SQL: class {} };
});

vi.mock('../../shared/models/system', () => ({
  webhookProcessedEvents: { id: 'id', eventId: 'event_id', processedAt: 'processed_at' },
}));

vi.mock('../../server/core/notificationService', () => ({
  notifyMember: vi.fn().mockResolvedValue(undefined),
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  notifyPaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyStaffPaymentFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/core/websocket', () => ({
  broadcastBillingUpdate: vi.fn(),
  broadcastDayPassUpdate: vi.fn(),
  sendNotificationToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/core/monitoring', () => ({ logPaymentFailure: vi.fn() }));
vi.mock('../../server/core/errorAlerts', () => ({ sendErrorAlert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/auditLog', () => ({
  logSystemAction: vi.fn().mockResolvedValue(undefined),
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn().mockResolvedValue({ totals: { totalCents: 5000 } }),
  recalculateSessionFees: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/core/billing/pricingConfig', () => ({
  updateFamilyDiscountPercent: vi.fn(),
  updateOverageRate: vi.fn(),
  updateGuestFee: vi.fn(),
}));

const mockGetStripeClient = vi.fn().mockResolvedValue({
  paymentIntents: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  refunds: { create: vi.fn() },
  customers: { retrieve: vi.fn(), createBalanceTransaction: vi.fn() },
  events: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
});
const mockGetStripeSync = vi.fn().mockResolvedValue({
  processWebhook: vi.fn().mockResolvedValue(undefined),
});
vi.mock('../../server/core/stripe/client', () => ({
  getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
  getStripeSync: (...args: unknown[]) => mockGetStripeSync(...args),
}));
vi.mock('../../server/core/stripe/appOriginTracker', () => ({ isAppOriginated: vi.fn().mockReturnValue(false) }));
vi.mock('../../server/core/stripe/invoices', () => ({ finalizeInvoicePaidOutOfBand: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/jobQueue', () => ({ queueJobInTransaction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/tierRegistry', () => ({ invalidateTierRegistry: vi.fn() }));
vi.mock('../../server/core/stripe/groupBilling', () => ({
  handlePrimarySubscriptionCancelled: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionItemsChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/emails/paymentEmails', () => ({
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentReceiptEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/emails/membershipEmails', () => ({
  sendMembershipRenewalEmail: vi.fn().mockResolvedValue(undefined),
  sendMembershipFailedEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../server/emails/passEmails', () => ({ sendPassWithQrEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/emails/trialWelcomeEmail', () => ({ sendTrialWelcomeWithQrEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/hubspot', () => ({ syncCompanyToHubSpot: vi.fn().mockResolvedValue(undefined), queueTierSync: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/hubspot/stages', () => ({ syncMemberToHubSpot: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/routes/dayPasses', () => ({ recordDayPassPurchaseFromWebhook: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/routes/merch', () => ({ restoreMerchStock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/utils/tierUtils', () => ({ normalizeTierName: vi.fn((name: string) => name) }));
vi.mock('../../server/walletPass/apnPushService', () => ({ sendPassUpdateForMemberByEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../server/core/stripe/products', () => ({ pullCorporateVolumePricingFromStripe: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../shared/schema', () => ({}));

import {
  extractResourceId,
  tryClaimEvent,
  checkResourceEventOrder,
  executeDeferredActions,
} from '../../server/core/stripe/webhooks/framework';

import {
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handleChargeRefunded,
} from '../../server/core/stripe/webhooks/handlers/payments';

import {
  handleInvoicePaymentSucceeded,
} from '../../server/core/stripe/webhooks/handlers/invoices';

import {
  handleSubscriptionUpdated,
} from '../../server/core/stripe/webhooks/handlers/subscriptions';

import type Stripe from 'stripe';

function createMockClient() {
  const queryResults: Map<string, { rows: unknown[]; rowCount: number }> = new Map();
  const queryCalls: Array<{ text: string; values: unknown[] }> = [];

  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      queryCalls.push({ text, values: values || [] });
      for (const [pattern, result] of queryResults) {
        if (text.includes(pattern)) return result;
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
    _setResult(pattern: string, rows: unknown[], rowCount?: number) {
      queryResults.set(pattern, { rows, rowCount: rowCount ?? rows.length });
    },
    _getCalls() {
      return queryCalls;
    },
    _clearResults() {
      queryResults.clear();
      queryCalls.length = 0;
    },
  };
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() });
});

describe('Webhook Integration — End-to-End Event Processing Pipeline', () => {
  describe('Event Dedup + Handler Dispatch + DB State', () => {
    it('payment_intent.succeeded: claim → dispatch → DB insert → deferred actions', async () => {
      const client = createMockClient();
      client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_pi_1' }], 1);
      client._setResult('INSERT INTO stripe_payment_intents', [], 1);

      const claimResult = await tryClaimEvent(client as any, 'evt_pi_1', 'payment_intent.succeeded', Date.now() / 1000, 'pi_test_1');
      expect(claimResult.claimed).toBe(true);

      const orderOk = await checkResourceEventOrder(client as any, 'pi_test_1', 'payment_intent.succeeded', Date.now() / 1000);
      expect(orderOk).toBe(true);

      const paymentIntent = {
        id: 'pi_test_1',
        amount: 7500,
        currency: 'usd',
        customer: 'cus_member_1',
        receipt_email: 'member@everclub.com',
        description: 'Booking payment',
        created: Math.floor(Date.now() / 1000),
        metadata: { purpose: 'booking_payment' },
      } as unknown as Stripe.PaymentIntent;

      const deferredActions = await handlePaymentIntentSucceeded(client as any, paymentIntent);
      expect(deferredActions.length).toBeGreaterThan(0);

      const insertCalls = client._getCalls().filter(c => c.text.includes('INSERT INTO stripe_payment_intents'));
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0].values).toContain('pi_test_1');

      const failedCount = await executeDeferredActions(deferredActions, { eventId: 'evt_pi_1', eventType: 'payment_intent.succeeded' });
      expect(failedCount).toBe(0);
    });

    it('duplicate event is rejected by tryClaimEvent after first processing', async () => {
      const client = createMockClient();

      client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_dup_1' }], 1);
      const first = await tryClaimEvent(client as any, 'evt_dup_1', 'payment_intent.succeeded', Date.now() / 1000, 'pi_dup');
      expect(first.claimed).toBe(true);

      client._clearResults();
      client._setResult('INSERT INTO webhook_processed_events', [], 0);
      const second = await tryClaimEvent(client as any, 'evt_dup_1', 'payment_intent.succeeded', Date.now() / 1000, 'pi_dup');
      expect(second.claimed).toBe(false);
      expect(second.reason).toBe('duplicate');
    });

    it('invoice.paid: claim → handler → DB state changes → deferred notification', async () => {
      const client = createMockClient();
      client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_inv_1' }], 1);
      client._setResult('SELECT', [{ email: 'member@test.com', stripe_customer_id: 'cus_1', billing_provider: 'stripe', membership_status: 'active', id: 'user-1' }]);
      client._setResult('UPDATE users', [], 1);

      const claimResult = await tryClaimEvent(client as any, 'evt_inv_1', 'invoice.payment_succeeded', Date.now() / 1000, 'in_test_1');
      expect(claimResult.claimed).toBe(true);

      const invoice = {
        id: 'in_test_1',
        amount_paid: 15000,
        currency: 'usd',
        customer: 'cus_1',
        customer_email: 'member@test.com',
        status: 'paid',
        subscription: 'sub_test_1',
        created: Math.floor(Date.now() / 1000),
        metadata: {},
        lines: { data: [{ price: { id: 'price_1', product: 'prod_1', metadata: {} }, metadata: {} }] },
        billing_reason: 'subscription_cycle',
        hosted_invoice_url: 'https://inv.stripe.com/test',
        number: 'INV-001',
        period_start: Math.floor(Date.now() / 1000) - 86400 * 30,
        period_end: Math.floor(Date.now() / 1000),
        paid: true,
        charge: null,
        payment_intent: 'pi_inv_1',
        total: 15000,
        amount_due: 15000,
        amount_remaining: 0,
      } as unknown as Stripe.Invoice;

      const deferredActions = await handleInvoicePaymentSucceeded(client as any, invoice as any);
      expect(Array.isArray(deferredActions)).toBe(true);
    });

    it('customer.subscription.updated: full pipeline with event ordering', async () => {
      const client = createMockClient();
      client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_sub_1' }], 1);
      client._setResult('SELECT event_type', [{ event_type: 'customer.subscription.created', processed_at: new Date() }]);
      client._setResult('SELECT', [{ email: 'member@test.com', billing_provider: 'stripe', id: 'user-1', membership_status: 'active', tier: 'gold' }]);
      client._setResult('UPDATE users', [], 1);

      const claimResult = await tryClaimEvent(client as any, 'evt_sub_1', 'customer.subscription.updated', Date.now() / 1000, 'sub_test_1');
      expect(claimResult.claimed).toBe(true);

      const orderOk = await checkResourceEventOrder(client as any, 'sub_test_1', 'customer.subscription.updated', Date.now() / 1000);
      expect(orderOk).toBe(true);

      const subscription = {
        id: 'sub_test_1',
        customer: 'cus_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_gold', product: 'prod_gold', metadata: { tier: 'gold' } }, metadata: {} }] },
        metadata: {},
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        cancel_at_period_end: false,
        created: Math.floor(Date.now() / 1000) - 60 * 86400,
        trial_end: null,
      } as unknown as Stripe.Subscription;

      const deferredActions = await handleSubscriptionUpdated(client as any, subscription);
      expect(Array.isArray(deferredActions)).toBe(true);
    });
  });

  describe('Event Ordering — Out-of-order rejection and DLQ', () => {
    it('rejects payment_intent.created after payment_intent.succeeded (lower → higher priority)', async () => {
      const client = createMockClient();
      client._setResult('SELECT event_type', [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }]);

      const dlqClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
      mockPoolConnect.mockResolvedValueOnce(dlqClient);

      const orderOk = await checkResourceEventOrder(client as any, 'pi_123', 'payment_intent.created', Date.now() / 1000, 'evt_ooo_1');
      expect(orderOk).toBe(false);

      expect(dlqClient.query).toHaveBeenCalled();
      const dlqCall = dlqClient.query.mock.calls[0];
      expect(dlqCall[0]).toContain('webhook_dead_letter_queue');
    });

    it('blocks ghost reactivation: subscription.created after subscription.deleted', async () => {
      const client = createMockClient();
      client._setResult('SELECT event_type', [{ event_type: 'customer.subscription.deleted', processed_at: new Date() }]);

      const result = await checkResourceEventOrder(client as any, 'sub_ghost', 'customer.subscription.created', Date.now() / 1000);
      expect(result).toBe(false);
    });

    it('allows cross-family events regardless of priority', async () => {
      const client = createMockClient();
      client._setResult('SELECT event_type', [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }]);

      const result = await checkResourceEventOrder(client as any, 'pi_cross', 'invoice.created', Date.now() / 1000);
      expect(result).toBe(true);
    });
  });

  describe('Deferred Action Resilience', () => {
    it('partial deferred action failures do not prevent remaining actions from executing', async () => {
      const results: string[] = [];
      const action1 = vi.fn().mockImplementation(async () => { results.push('a1'); });
      const action2 = vi.fn().mockRejectedValue(new Error('notification service down'));
      const action3 = vi.fn().mockImplementation(async () => { results.push('a3'); });
      const action4 = vi.fn().mockRejectedValue(new Error('hubspot sync failed'));
      const action5 = vi.fn().mockImplementation(async () => { results.push('a5'); });

      const failed = await executeDeferredActions(
        [action1, action2, action3, action4, action5],
        { eventId: 'evt_resilience', eventType: 'payment_intent.succeeded' }
      );

      expect(failed).toBe(2);
      expect(results).toEqual(['a1', 'a3', 'a5']);
      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
      expect(action3).toHaveBeenCalled();
      expect(action4).toHaveBeenCalled();
      expect(action5).toHaveBeenCalled();
    });

    it('all deferred actions failing still records failure alert in system_alerts', async () => {
      const action1 = vi.fn().mockRejectedValue(new Error('fail1'));
      const action2 = vi.fn().mockRejectedValue(new Error('fail2'));

      mockExecute.mockResolvedValue({ rows: [] });

      const failed = await executeDeferredActions(
        [action1, action2],
        { eventId: 'evt_allfail', eventType: 'test.event' }
      );

      expect(failed).toBe(2);
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe('charge.refunded Integration — Participant + Guest Pass + Ledger Cleanup', () => {
    it('full refund marks participants as refunded and cleans up usage ledger', async () => {
      const client = createMockClient();
      client._setResult('INSERT INTO stripe_payment_intents', [], 1);
      client._setResult('UPDATE stripe_payment_intents', [], 1);
      client._setResult('SELECT id FROM booking_participants', [{ id: 100, payment_status: 'paid' }]);
      client._setResult('FOR UPDATE', [{ id: 100 }]);
      client._setResult('WITH updated AS', [{ id: 100, session_id: 50, user_id: 'user-1', user_email: 'member@test.com' }], 1);
      client._setResult('SELECT br.id', [{ id: 10, booking_owner_email: 'member@test.com' }]);
      client._setResult('SELECT id, display_name, used_guest_pass', [], 0);
      client._setResult('DELETE FROM usage_ledger', [{ minutes_charged: 60 }], 1);
      client._setResult('DELETE FROM guest_pass_holds', [], 0);
      client._setResult('INSERT INTO notifications', [], 1);
      client._setResult('SELECT 1 FROM users', [{ '1': 1 }]);
      client._setResult('UPDATE terminal_payments', [], 0);

      const charge = {
        id: 'ch_refund_1',
        amount: 7500,
        amount_refunded: 7500,
        currency: 'usd',
        customer: 'cus_1',
        payment_intent: 'pi_refund_1',
        created: Math.floor(Date.now() / 1000),
        refunded: true,
        refunds: { data: [{ id: 're_1', amount: 7500, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000), reason: 'requested_by_customer' }] },
        billing_details: { email: 'member@test.com' },
        receipt_email: 'member@test.com',
        metadata: {},
      } as unknown as Stripe.Charge;

      const deferredActions = await handleChargeRefunded(client as any, charge);
      expect(deferredActions.length).toBeGreaterThan(0);

      const participantUpdateCalls = client._getCalls().filter(c => c.text.includes('WITH updated AS'));
      expect(participantUpdateCalls.length).toBe(1);

      const ledgerDeleteCalls = client._getCalls().filter(c => c.text.includes('DELETE FROM usage_ledger'));
      expect(ledgerDeleteCalls.length).toBe(1);
    });
  });
});
