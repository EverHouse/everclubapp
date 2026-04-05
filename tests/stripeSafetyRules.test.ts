// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
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

vi.mock('../server/db', () => {
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  mockDelete.mockReturnValue({ where: deleteWhere });
  return {
    db: { execute: mockExecute, transaction: mockTransaction, delete: mockDelete },
    _deleteWhere: deleteWhere,
    _deleteReturning: deleteReturning,
  };
});

const { mockPoolConnect, mockSafeRelease } = vi.hoisted(() => ({
  mockPoolConnect: vi.fn(),
  mockSafeRelease: vi.fn(),
}));
vi.mock('../server/core/db', () => ({
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

vi.mock('../shared/models/system', () => ({
  webhookProcessedEvents: { id: 'id', eventId: 'event_id', processedAt: 'processed_at' },
}));

vi.mock('../server/core/notificationService', () => ({
  notifyMember: vi.fn().mockResolvedValue(undefined),
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  notifyPaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyStaffPaymentFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/websocket', () => ({
  broadcastBillingUpdate: vi.fn(),
  broadcastDayPassUpdate: vi.fn(),
  sendNotificationToUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/monitoring', () => ({
  logPaymentFailure: vi.fn(),
}));

vi.mock('../server/core/errorAlerts', () => ({
  sendErrorAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/auditLog', () => ({
  logSystemAction: vi.fn().mockResolvedValue(undefined),
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn().mockResolvedValue({ totals: { totalCents: 5000 } }),
  recalculateSessionFees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  updateFamilyDiscountPercent: vi.fn(),
  updateOverageRate: vi.fn(),
  updateGuestFee: vi.fn(),
}));

const mockGetStripeClient = vi.fn().mockResolvedValue({
  paymentIntents: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn(), confirm: vi.fn() },
  refunds: { create: vi.fn() },
  customers: { retrieve: vi.fn(), createBalanceTransaction: vi.fn() },
  events: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
  invoices: { retrieve: vi.fn(), pay: vi.fn() },
});
const mockGetStripeSync = vi.fn().mockResolvedValue({
  processWebhook: vi.fn().mockResolvedValue(undefined),
});
vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
  getStripeSync: (...args: unknown[]) => mockGetStripeSync(...args),
}));

vi.mock('../server/core/stripe/appOriginTracker', () => ({
  isAppOriginated: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/stripe/invoices', () => ({
  finalizeInvoicePaidOutOfBand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/jobQueue', () => ({
  queueJobInTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/tierRegistry', () => ({
  invalidateTierRegistry: vi.fn(),
}));

vi.mock('../server/core/stripe/groupBilling', () => ({
  handlePrimarySubscriptionCancelled: vi.fn().mockResolvedValue(undefined),
  handleSubscriptionItemsChanged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/emails/paymentEmails', () => ({
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentReceiptEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/emails/membershipEmails', () => ({
  sendMembershipRenewalEmail: vi.fn().mockResolvedValue(undefined),
  sendMembershipFailedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/emails/passEmails', () => ({
  sendPassWithQrEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/emails/trialWelcomeEmail', () => ({
  sendTrialWelcomeWithQrEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/hubspot', () => ({
  syncCompanyToHubSpot: vi.fn().mockResolvedValue(undefined),
  queueTierSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/hubspot/stages', () => ({
  syncMemberToHubSpot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/routes/dayPasses', () => ({
  recordDayPassPurchaseFromWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/routes/merch', () => ({
  restoreMerchStock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/utils/tierUtils', () => ({
  normalizeTierName: vi.fn((name: string) => name),
}));

vi.mock('../server/walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/stripe/products', () => ({
  pullCorporateVolumePricingFromStripe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/schema', () => ({}));

vi.mock('../server/core/dataAlerts', () => ({
  alertOnDeferredActionFailure: vi.fn().mockResolvedValue(undefined),
  recordDeferredActionOutcome: vi.fn(),
}));

import type { PoolClient, QueryResult } from 'pg';
import type Stripe from 'stripe';
import type { InvoiceWithLegacyFields } from '../server/core/stripe/webhooks/types';

interface MockClient extends PoolClient {
  _setResult(pattern: string, rows: unknown[], rowCount?: number): void;
  _getCalls(): Array<{ text: string; values: unknown[] }>;
  _clearResults(): void;
}

function createMockClient(): MockClient {
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
  } as unknown as MockClient;
  return client;
}

import {
  tryClaimEvent,
  checkResourceEventOrder,
  executeDeferredActions,
} from '../server/core/stripe/webhooks/framework';

import {
  handleChargeRefunded,
  handleChargeDisputeCreated,
} from '../server/core/stripe/webhooks/handlers/payments';

import {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
} from '../server/core/stripe/webhooks/handlers/invoices';

import {
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
  handleSubscriptionPaused,
  handleSubscriptionUpdated,
  handleSubscriptionResumed,
} from '../server/core/stripe/webhooks/handlers/subscriptions';

import {
  handleCheckoutSessionCompleted,
} from '../server/core/stripe/webhooks/handlers/checkout';

import {
  handlePaymentMethodAttached,
} from '../server/core/stripe/webhooks/handlers/customers';

const { logger } = await import('../server/core/logger');

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() });
});

describe('Stripe Safety Rules — Invoice PI Guard', () => {
  it('payment_method.attached auto-retries invoice PIs via invoices.pay, not paymentIntents.confirm', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email', [{ id: 'user_1', email: 'test@example.com', billing_provider: 'stripe' }]);
    client._setResult('SELECT stripe_payment_intent_id', [{ stripe_payment_intent_id: 'pi_failed_123' }]);

    const mockStripe = await mockGetStripeClient();
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_failed_123',
      status: 'requires_payment_method',
      invoice: 'inv_123',
    });
    mockStripe.invoices.retrieve.mockResolvedValue({
      id: 'inv_123',
      status: 'open',
    });
    mockStripe.invoices.pay.mockResolvedValue({
      id: 'inv_123',
      status: 'paid',
    });

    const paymentMethod = {
      id: 'pm_new',
      customer: 'cus_test',
      type: 'card',
    } as unknown as Stripe.PaymentMethod;

    const actions = await handlePaymentMethodAttached(client, paymentMethod);

    await Promise.allSettled(actions.map(a => a()));

    expect(mockStripe.invoices.pay).toHaveBeenCalledWith('inv_123', expect.objectContaining({
      payment_method: 'pm_new',
    }));
    expect(mockStripe.paymentIntents.confirm).not.toHaveBeenCalled();
  });

  it('payment_method.attached uses paymentIntents.confirm only for non-invoice PIs', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email', [{ id: 'user_1', email: 'test@example.com', billing_provider: 'stripe' }]);
    client._setResult('SELECT stripe_payment_intent_id', [{ stripe_payment_intent_id: 'pi_standalone' }]);

    const mockStripe = await mockGetStripeClient();
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_standalone',
      status: 'requires_payment_method',
      invoice: null,
    });
    mockStripe.paymentIntents.confirm.mockResolvedValue({
      id: 'pi_standalone',
      status: 'succeeded',
    });

    const paymentMethod = {
      id: 'pm_new',
      customer: 'cus_test',
      type: 'card',
    } as unknown as Stripe.PaymentMethod;

    const actions = await handlePaymentMethodAttached(client, paymentMethod);

    await Promise.allSettled(actions.map(a => a()));

    expect(mockStripe.paymentIntents.confirm).toHaveBeenCalledWith('pi_standalone', expect.objectContaining({
      payment_method: 'pm_new',
    }));
    expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
  });
});

describe('Stripe Safety Rules — Billing Provider Guard', () => {
  it('invoice.payment_succeeded skips status update when billing_provider is not stripe', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, first_name, last_name, billing_provider', [
      { id: 'user_1', first_name: 'John', last_name: 'Doe', billing_provider: 'mindbody' },
    ]);

    const invoice = {
      id: 'in_test',
      customer: 'cus_test',
      customer_email: 'john@example.com',
      amount_paid: 5000,
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_123',
      lines: { data: [{ description: 'Membership', period: { end: Math.floor(Date.now() / 1000) + 86400 } }] },
      metadata: {},
    } as unknown as InvoiceWithLegacyFields;

    const actions = await handleInvoicePaymentSucceeded(client, invoice);

    const updateCalls = client._getCalls().filter(
      c => c.text.includes('UPDATE users') && c.text.includes('grace_period_start')
    );
    expect(updateCalls.length).toBe(0);

    const membershipActions = actions.filter(a => a.toString().includes('membership') || a.toString().includes('notify'));
    const actionCount = actions.length;
    expect(actionCount).toBeLessThanOrEqual(2);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("billing_provider is 'mindbody'")
    );
  });

  it('invoice.payment_failed skips grace period when billing_provider is not stripe', async () => {
    const client = createMockClient();

    client._setResult('SELECT first_name, last_name', [{ first_name: 'Jane', last_name: 'Doe' }]);
    client._setResult('SELECT membership_status, stripe_subscription_id', [
      { membership_status: 'active', stripe_subscription_id: 'sub_123' },
    ]);
    client._setResult('SELECT membership_status, billing_provider', [
      { membership_status: 'active', billing_provider: 'wellhub' },
    ]);

    const invoice = {
      id: 'in_fail',
      customer: 'cus_test',
      customer_email: 'jane@example.com',
      amount_paid: 0,
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      attempt_count: 1,
      subscription: 'sub_123',
      lines: { data: [{ description: 'Membership' }] },
      metadata: {},
    } as unknown as InvoiceWithLegacyFields;

    const actions = await handleInvoicePaymentFailed(client, invoice);

    const gracePeriodCalls = client._getCalls().filter(
      c => c.text.includes('grace_period_start = COALESCE')
    );
    expect(gracePeriodCalls.length).toBe(0);

    const actionCount = actions.length;
    expect(actionCount).toBeLessThanOrEqual(1);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("billing_provider is 'wellhub'")
    );
  });

  it('subscription.deleted skips cancellation when billing_provider is not stripe', async () => {
    const client = createMockClient();

    client._setResult('SELECT email, first_name, last_name, membership_status, billing_provider', [
      { email: 'test@example.com', first_name: 'Test', last_name: 'User', membership_status: 'active', billing_provider: 'mindbody' },
    ]);

    const subscription = {
      id: 'sub_123',
      customer: 'cus_test',
      status: 'canceled',
      items: { data: [{ price: { id: 'price_1', nickname: 'Monthly' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionDeleted(client, subscription);

    const cancelCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'cancelled'")
    );
    expect(cancelCalls.length).toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("billing_provider is 'mindbody'")
    );
  });

  it('subscription.paused skips status change when billing_provider is not stripe', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email, first_name, last_name, billing_provider, pending_tier_change', [
      { id: 'user_1', email: 'test@example.com', first_name: 'Test', last_name: 'User', billing_provider: 'wellhub', pending_tier_change: null },
    ]);

    const subscription = {
      id: 'sub_123',
      customer: 'cus_test',
      status: 'paused',
      items: { data: [{ price: { id: 'price_1' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionPaused(client, subscription);

    const frozenCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'frozen'")
    );
    expect(frozenCalls.length).toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("billing_provider is 'wellhub'")
    );
  });
});

describe('Stripe Safety Rules — Refund Safety', () => {
  it('partial refund does not mark participants as refunded and records correct remaining amount', async () => {
    const client = createMockClient();

    const totalAmount = 10000;
    const refundedAmount = 3000;
    const charge = {
      id: 'ch_partial',
      amount: totalAmount,
      amount_refunded: refundedAmount,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_partial',
      created: Math.floor(Date.now() / 1000),
      refunded: false,
      refunds: { data: [{ id: 're_1', amount: refundedAmount, currency: 'usd', created: Math.floor(Date.now() / 1000), status: 'succeeded' }] },
      billing_details: { email: 'test@example.com' },
      metadata: {},
    } as unknown as Stripe.Charge;

    client._setResult('UPDATE stripe_payment_intents', [], 1);

    await handleChargeRefunded(client, charge);

    const participantUpdateCalls = client._getCalls().filter(
      c => c.text.includes("payment_status = 'refunded'")
    );
    expect(participantUpdateCalls.length).toBe(0);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Partial refund')
    );

    const piUpdateCalls = client._getCalls().filter(
      c => c.text.includes('UPDATE stripe_payment_intents') && c.text.includes('status')
    );
    expect(piUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(piUpdateCalls[0].values).toContain('partially_refunded');
  });

  it('full refund marks participants as refunded when amount_refunded equals amount', async () => {
    const client = createMockClient();

    const totalAmount = 5000;
    const charge = {
      id: 'ch_full',
      amount: totalAmount,
      amount_refunded: totalAmount,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_full',
      created: Math.floor(Date.now() / 1000),
      refunded: true,
      refunds: { data: [{ id: 're_full', amount: totalAmount, currency: 'usd', created: Math.floor(Date.now() / 1000), status: 'succeeded' }] },
      billing_details: { email: 'test@example.com' },
      receipt_email: 'test@example.com',
      metadata: {},
    } as unknown as Stripe.Charge;

    client._setResult('UPDATE stripe_payment_intents', [], 1);
    client._setResult('SELECT id FROM booking_participants', [{ id: 100 }]);
    client._setResult('WITH updated AS', [{ id: 100, session_id: 10, user_id: 'u1', user_email: 'test@example.com' }], 1);
    client._setResult('SELECT br.id', []);
    client._setResult('SELECT id, display_name, used_guest_pass', []);

    await handleChargeRefunded(client, charge);

    const refundCalls = client._getCalls().filter(
      c => c.text.includes("payment_status = 'refunded'")
    );
    expect(refundCalls.length).toBe(1);

    const piUpdateCalls = client._getCalls().filter(
      c => c.text.includes('UPDATE stripe_payment_intents') && c.text.includes('status')
    );
    expect(piUpdateCalls.length).toBeGreaterThanOrEqual(1);
    expect(piUpdateCalls[0].values).toContain('refunded');
  });

  it('refund threshold: amount_refunded < amount is partial, amount_refunded >= amount is full', async () => {
    const partialClient = createMockClient();
    const fullClient = createMockClient();

    const makeCharge = (amountRefunded: number, refunded: boolean) => ({
      id: `ch_threshold_${amountRefunded}`,
      amount: 10000,
      amount_refunded: amountRefunded,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: `pi_threshold_${amountRefunded}`,
      created: Math.floor(Date.now() / 1000),
      refunded,
      refunds: { data: [{ id: `re_${amountRefunded}`, amount: amountRefunded, currency: 'usd', created: Math.floor(Date.now() / 1000), status: 'succeeded' }] },
      billing_details: { email: 'test@example.com' },
      receipt_email: 'test@example.com',
      metadata: {},
    } as unknown as Stripe.Charge);

    partialClient._setResult('UPDATE stripe_payment_intents', [], 1);
    fullClient._setResult('UPDATE stripe_payment_intents', [], 1);
    fullClient._setResult('SELECT id FROM booking_participants', []);
    fullClient._setResult('WITH updated AS', [], 0);

    await handleChargeRefunded(partialClient, makeCharge(9999, false));
    await handleChargeRefunded(fullClient, makeCharge(10000, true));

    const partialRefundParticipantCalls = partialClient._getCalls().filter(
      c => c.text.includes("payment_status = 'refunded'")
    );
    expect(partialRefundParticipantCalls.length).toBe(0);

    const partialPiCalls = partialClient._getCalls().filter(
      c => c.text.includes('UPDATE stripe_payment_intents') && c.text.includes('status')
    );
    expect(partialPiCalls[0].values).toContain('partially_refunded');

    const fullPiCalls = fullClient._getCalls().filter(
      c => c.text.includes('UPDATE stripe_payment_intents') && c.text.includes('status')
    );
    expect(fullPiCalls[0].values).toContain('refunded');
  });

  it('second processing of full refund does not re-flip participant status when already refunded', async () => {
    const totalAmount = 5000;

    const charge = {
      id: 'ch_idem',
      amount: totalAmount,
      amount_refunded: totalAmount,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_idem',
      created: Math.floor(Date.now() / 1000),
      refunded: true,
      refunds: { data: [{ id: 're_idem', amount: totalAmount, currency: 'usd', created: Math.floor(Date.now() / 1000), status: 'succeeded' }] },
      billing_details: { email: 'test@example.com' },
      receipt_email: 'test@example.com',
      metadata: {},
    } as unknown as Stripe.Charge;

    const firstClient = createMockClient();
    firstClient._setResult('UPDATE stripe_payment_intents', [], 1);
    firstClient._setResult('SELECT id FROM booking_participants', [{ id: 100 }]);
    firstClient._setResult('WITH updated AS', [{ id: 100, session_id: 10, user_id: 'u1', user_email: 'test@example.com' }], 1);
    firstClient._setResult('SELECT br.id', []);
    firstClient._setResult('SELECT id, display_name, used_guest_pass', []);

    await handleChargeRefunded(firstClient, charge);

    const firstRefundCalls = firstClient._getCalls().filter(
      c => c.text.includes("payment_status = 'refunded'")
    );
    expect(firstRefundCalls.length).toBe(1);

    const secondClient = createMockClient();
    secondClient._setResult('UPDATE stripe_payment_intents', [], 1);
    secondClient._setResult('SELECT id FROM booking_participants', [{ id: 100 }]);
    secondClient._setResult('WITH updated AS', [], 0);
    secondClient._setResult('SELECT br.id', []);
    secondClient._setResult('SELECT id, display_name, used_guest_pass', []);

    await handleChargeRefunded(secondClient, charge);

    const secondNotifyCalls = secondClient._getCalls().filter(
      c => c.text.includes('INSERT INTO notifications')
    );
    expect(secondNotifyCalls.length).toBe(0);
  });
});

describe('Stripe Safety Rules — Ghost Reactivation Blocking', () => {
  it('blocks subscription.created after subscription.deleted for the same resource', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [
      { event_type: 'customer.subscription.deleted', processed_at: new Date() },
    ]);

    const result = await checkResourceEventOrder(
      client,
      'sub:sub_ghost_test',
      'customer.subscription.created',
      Math.floor(Date.now() / 1000),
      'evt_ghost_test'
    );

    expect(result).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('ghost reactivation')
    );
  });

  it('allows subscription.created when no prior events exist', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', []);

    const result = await checkResourceEventOrder(
      client,
      'sub:sub_new',
      'customer.subscription.created',
      Math.floor(Date.now() / 1000)
    );

    expect(result).toBe(true);
  });

  it('allows subscription.created after subscription.updated (not deleted)', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [
      { event_type: 'customer.subscription.updated', processed_at: new Date() },
    ]);

    const result = await checkResourceEventOrder(
      client,
      'sub:sub_normal',
      'customer.subscription.created',
      Math.floor(Date.now() / 1000)
    );

    expect(result).toBe(true);
  });
});

describe('Stripe Safety Rules — Webhook Event Dedup', () => {
  it('first processing of an event succeeds', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_first' }], 1);

    const result = await tryClaimEvent(
      client,
      'evt_first',
      'payment_intent.succeeded',
      Math.floor(Date.now() / 1000),
      'pi_123'
    );

    expect(result.claimed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('second processing of same event ID is rejected as duplicate', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO webhook_processed_events', [], 0);

    const result = await tryClaimEvent(
      client,
      'evt_duplicate',
      'payment_intent.succeeded',
      Math.floor(Date.now() / 1000),
      'pi_123'
    );

    expect(result.claimed).toBe(false);
    expect(result.reason).toBe('duplicate');
  });

  it('dedup uses INSERT ON CONFLICT DO NOTHING pattern', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO webhook_processed_events', [], 0);

    await tryClaimEvent(
      client,
      'evt_test',
      'payment_intent.succeeded',
      Math.floor(Date.now() / 1000),
      'pi_123'
    );

    const insertCalls = client._getCalls().filter(
      c => c.text.includes('INSERT INTO webhook_processed_events') && c.text.includes('ON CONFLICT')
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].text).toContain('DO NOTHING');
  });
});

describe('Stripe Safety Rules — membership_status_changed_at IS DISTINCT FROM Pattern', () => {
  it('subscription.deleted uses IS DISTINCT FROM for status tracking', async () => {
    const client = createMockClient();

    client._setResult('SELECT email, first_name, last_name, membership_status, billing_provider', [
      { email: 'test@example.com', first_name: 'Test', last_name: 'User', membership_status: 'active', billing_provider: 'stripe' },
    ]);
    client._setResult("membership_status = 'cancelled'", [], 1);

    const subscription = {
      id: 'sub_del',
      customer: 'cus_test',
      status: 'canceled',
      items: { data: [{ price: { id: 'price_1', nickname: 'Monthly' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    await handleSubscriptionDeleted(client, subscription);

    const statusUpdateCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'cancelled'")
    );
    for (const call of statusUpdateCalls) {
      expect(call.text).toContain('IS DISTINCT FROM');
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('subscription.paused uses IS DISTINCT FROM for status tracking', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email, first_name, last_name, billing_provider, pending_tier_change', [
      { id: 'user_1', email: 'test@example.com', first_name: 'Test', last_name: 'User', billing_provider: 'stripe', pending_tier_change: null },
    ]);

    const subscription = {
      id: 'sub_pause',
      customer: 'cus_test',
      status: 'paused',
      items: { data: [{ price: { id: 'price_1' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    await handleSubscriptionPaused(client, subscription);

    const frozenCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'frozen'")
    );
    for (const call of frozenCalls) {
      expect(call.text).toContain('IS DISTINCT FROM');
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('invoice.payment_failed uses conditional membership_status_changed_at update', async () => {
    const client = createMockClient();

    client._setResult('SELECT first_name, last_name', [{ first_name: 'Test', last_name: 'User' }]);
    client._setResult('SELECT membership_status, stripe_subscription_id', [
      { membership_status: 'active', stripe_subscription_id: 'sub_123' },
    ]);
    client._setResult('SELECT membership_status, billing_provider', [
      { membership_status: 'active', billing_provider: 'stripe' },
    ]);
    client._setResult('grace_period_start = COALESCE', [], 1);
    client._setResult('UPDATE hubspot_deals', [], 0);

    const invoice = {
      id: 'in_fail_status',
      customer: 'cus_test',
      customer_email: 'test@example.com',
      amount_paid: 0,
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      attempt_count: 1,
      subscription: 'sub_123',
      lines: { data: [{ description: 'Membership' }] },
      metadata: {},
    } as unknown as InvoiceWithLegacyFields;

    await handleInvoicePaymentFailed(client, invoice);

    const statusCalls = client._getCalls().filter(
      c => c.text.includes("membership_status") && c.text.includes("'past_due'")
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    for (const call of statusCalls) {
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('checkout.session.completed uses IS DISTINCT FROM for activation', async () => {
    const client = createMockClient();

    client._setResult('SELECT first_name, last_name, phone', [
      { first_name: 'New', last_name: 'Member', phone: null },
    ]);
    client._setResult("WHERE id = $4", [{ id: 'user_1', email: 'new@example.com' }], 1);

    const session = {
      id: 'cs_activation',
      customer: 'cus_new',
      customer_email: 'new@example.com',
      subscription: 'sub_new',
      metadata: {
        source: 'activation_link',
        userId: 'user_1',
        memberEmail: 'new@example.com',
        tier: 'Gold',
      },
    } as unknown as Stripe.Checkout.Session;

    await handleCheckoutSessionCompleted(client, session);

    const activationCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'active'") && c.text.includes('IS DISTINCT FROM')
    );
    expect(activationCalls.length).toBeGreaterThan(0);
  });

  it('subscription.created uses IS DISTINCT FROM for status tracking (existing user)', async () => {
    const client = createMockClient();

    client._setResult('SELECT email, first_name, last_name, tier, membership_status, billing_provider, migration_status', [
      { email: 'test@example.com', first_name: 'Test', last_name: 'User', tier: null, membership_status: 'pending', billing_provider: 'stripe', migration_status: null },
    ]);
    client._setResult('SELECT id FROM membership_tiers', []);

    const subscription = {
      id: 'sub_created',
      customer: 'cus_test',
      status: 'active',
      items: { data: [{ price: { id: 'price_1', nickname: 'Monthly' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    await handleSubscriptionCreated(client, subscription);

    const statusCalls = client._getCalls().filter(
      c => c.text.includes('membership_status') && c.text.includes('IS DISTINCT FROM')
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    for (const call of statusCalls) {
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('subscription.updated uses IS DISTINCT FROM when transitioning to active', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email, first_name, last_name, tier, tier_id, billing_provider, pending_tier_change', [
      { id: 'user_1', email: 'test@example.com', first_name: 'Test', last_name: 'User', tier: 'Monthly', tier_id: 1, billing_provider: 'stripe', pending_tier_change: null },
    ]);
    client._setResult("membership_status = 'active'", [], 1);
    client._setResult('SELECT id FROM membership_tiers', []);
    client._setResult('SELECT id, pricing_model', []);

    const subscription = {
      id: 'sub_updated',
      customer: 'cus_test',
      status: 'active',
      items: { data: [{ price: { id: 'price_1', nickname: 'Monthly' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    await handleSubscriptionUpdated(client, subscription);

    const activeCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'active'") && c.text.includes('IS DISTINCT FROM')
    );
    expect(activeCalls.length).toBeGreaterThan(0);
    for (const call of activeCalls) {
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('subscription.resumed uses IS DISTINCT FROM for reactivation', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, email, first_name, last_name, billing_provider', [
      { id: 'user_1', email: 'test@example.com', first_name: 'Test', last_name: 'User', billing_provider: 'stripe' },
    ]);
    client._setResult("membership_status = 'active'", [], 1);

    const subscription = {
      id: 'sub_resumed',
      customer: 'cus_test',
      status: 'active',
      items: { data: [{ price: { id: 'price_1' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    await handleSubscriptionResumed(client, subscription);

    const activeCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'active'") && c.text.includes('IS DISTINCT FROM')
    );
    expect(activeCalls.length).toBeGreaterThan(0);
    for (const call of activeCalls) {
      expect(call.text).toContain('membership_status_changed_at');
    }
  });

  it('charge.dispute.created uses IS DISTINCT FROM for suspension', async () => {
    const client = createMockClient();

    client._setResult('UPDATE terminal_payments', [
      { id: 1, user_id: 'user_1', user_email: 'test@example.com', stripe_subscription_id: null, amount_cents: 5000 },
    ], 1);
    client._setResult('SELECT billing_provider', [{ billing_provider: 'stripe' }]);
    client._setResult("membership_status = 'suspended'", [], 1);

    const dispute = {
      id: 'dp_test',
      amount: 5000,
      charge: 'ch_test',
      payment_intent: 'pi_test',
      reason: 'fraudulent',
      status: 'needs_response',
    } as unknown as Stripe.Dispute;

    await handleChargeDisputeCreated(client, dispute);

    const suspendCalls = client._getCalls().filter(
      c => c.text.includes("membership_status = 'suspended'")
    );
    for (const call of suspendCalls) {
      expect(call.text).toContain('IS DISTINCT FROM');
      expect(call.text).toContain('membership_status_changed_at');
    }
  });
});

describe('Stripe Safety Rules — Deferred Actions Must Not Contain Money-Moving Operations', () => {
  it('invoice.payment_succeeded deferred actions do not call invoices.pay or paymentIntents.confirm', async () => {
    const client = createMockClient();

    client._setResult('SELECT id, first_name, last_name, billing_provider', [
      { id: 'user_1', first_name: 'Test', last_name: 'User', billing_provider: 'stripe' },
    ]);
    client._setResult('SELECT name FROM membership_tiers', []);

    const invoice = {
      id: 'in_deferred',
      customer: 'cus_test',
      customer_email: 'test@example.com',
      amount_paid: 5000,
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_123',
      payment_intent: 'pi_inv',
      lines: { data: [{ description: 'Membership', period: { end: Math.floor(Date.now() / 1000) + 86400 }, price: { id: 'price_1' } }] },
      metadata: {},
    } as unknown as InvoiceWithLegacyFields;

    const actions = await handleInvoicePaymentSucceeded(client, invoice);

    const mockStripe = await mockGetStripeClient();
    mockStripe.invoices.pay.mockClear();
    mockStripe.paymentIntents.confirm.mockClear();

    await Promise.allSettled(actions.map(a => a()));

    expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
    expect(mockStripe.paymentIntents.confirm).not.toHaveBeenCalled();
  });

  it('subscription.deleted deferred actions do not move money', async () => {
    const client = createMockClient();

    client._setResult('SELECT email, first_name, last_name, membership_status, billing_provider', [
      { email: 'test@example.com', first_name: 'Test', last_name: 'User', membership_status: 'active', billing_provider: 'stripe' },
    ]);
    client._setResult("membership_status = 'cancelled'", [], 1);

    const subscription = {
      id: 'sub_del_deferred',
      customer: 'cus_test',
      status: 'canceled',
      items: { data: [{ price: { id: 'price_1', nickname: 'Monthly' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionDeleted(client, subscription);

    const mockStripe = await mockGetStripeClient();
    mockStripe.invoices.pay.mockClear();
    mockStripe.paymentIntents.confirm.mockClear();
    mockStripe.refunds.create.mockClear();

    await Promise.allSettled(actions.map(a => a()));

    expect(mockStripe.invoices.pay).not.toHaveBeenCalled();
    expect(mockStripe.paymentIntents.confirm).not.toHaveBeenCalled();
    expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  });

  it('deferred actions do not enqueue money-moving jobs via queueJobInTransaction', async () => {
    const { queueJobInTransaction } = await import('../server/core/jobQueue');
    const mockQueueJob = vi.mocked(queueJobInTransaction);

    const client = createMockClient();
    client._setResult('SELECT id, first_name, last_name, billing_provider', [
      { id: 'user_1', first_name: 'Test', last_name: 'User', billing_provider: 'stripe' },
    ]);
    client._setResult('SELECT name FROM membership_tiers', []);

    const invoice = {
      id: 'in_deferred_queue',
      customer: 'cus_test',
      customer_email: 'test@example.com',
      amount_paid: 5000,
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_123',
      payment_intent: 'pi_inv',
      lines: { data: [{ description: 'Membership', period: { end: Math.floor(Date.now() / 1000) + 86400 }, price: { id: 'price_1' } }] },
      metadata: {},
    } as unknown as InvoiceWithLegacyFields;

    const actions = await handleInvoicePaymentSucceeded(client, invoice);
    mockQueueJob.mockClear();

    await Promise.allSettled(actions.map(a => a()));

    const moneyMovingJobTypes = ['stripe_auto_refund', 'stripe_charge', 'stripe_payment', 'stripe_invoice_pay'];
    for (const call of mockQueueJob.mock.calls) {
      const jobType = call[1] as string;
      expect(moneyMovingJobTypes).not.toContain(jobType);
    }
  });

  it('executeDeferredActions runs all actions even if some fail', async () => {
    const results: string[] = [];
    const action1 = async () => { results.push('a'); throw new Error('fail'); };
    const action2 = async () => { results.push('b'); };
    const action3 = async () => { results.push('c'); throw new Error('fail2'); };

    const failedCount = await executeDeferredActions(
      [action1, action2, action3],
      { eventId: 'evt_test', eventType: 'test' }
    );

    expect(failedCount).toBe(2);
    expect(results).toContain('a');
    expect(results).toContain('b');
    expect(results).toContain('c');
  });
});
