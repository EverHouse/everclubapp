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

const mockNotifyMember = vi.fn().mockResolvedValue(undefined);
const mockNotifyAllStaff = vi.fn().mockResolvedValue(undefined);
const mockNotifyPaymentFailed = vi.fn().mockResolvedValue(undefined);
const mockNotifyStaffPaymentFailed = vi.fn().mockResolvedValue(undefined);
vi.mock('../server/core/notificationService', () => ({
  notifyMember: (...args: unknown[]) => mockNotifyMember(...args),
  notifyAllStaff: (...args: unknown[]) => mockNotifyAllStaff(...args),
  notifyPaymentFailed: (...args: unknown[]) => mockNotifyPaymentFailed(...args),
  notifyStaffPaymentFailed: (...args: unknown[]) => mockNotifyStaffPaymentFailed(...args),
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
  paymentIntents: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  refunds: { create: vi.fn() },
  customers: { retrieve: vi.fn(), createBalanceTransaction: vi.fn() },
  events: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn() },
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

import {
  extractResourceId,
  tryClaimEvent,
  checkResourceEventOrder,
  executeDeferredActions,
  cleanupOldProcessedEvents,
} from '../server/core/stripe/webhooks/framework';

import {
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handleChargeRefunded,
  handleChargeDisputeCreated,
  handleCreditNoteCreated,
} from '../server/core/stripe/webhooks/handlers/payments';

import {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceLifecycle,
  handleInvoiceVoided,
  handleInvoicePaymentActionRequired,
  handleInvoiceOverdue,
} from '../server/core/stripe/webhooks/handlers/invoices';

import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionPaused,
  handleSubscriptionResumed,
  handleSubscriptionDeleted,
  handleTrialWillEnd,
} from '../server/core/stripe/webhooks/handlers/subscriptions';

import {
  handleCustomerUpdated,
  handleCustomerCreated,
  handleCustomerDeleted,
  handlePaymentMethodDetached,
} from '../server/core/stripe/webhooks/handlers/customers';

import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
} from '../server/core/stripe/webhooks/handlers/checkout';

import {
  handlePaymentIntentCanceled,
  handlePaymentIntentStatusUpdate,
} from '../server/core/stripe/webhooks/handlers/payments';

import { processStripeWebhook } from '../server/core/stripe/webhooks/index';

import {
  handleProductUpdated,
  handleProductCreated,
  handleProductDeleted,
  handlePriceChange,
  handlePriceDeleted,
} from '../server/core/stripe/webhooks/handlers/catalog';

import type Stripe from 'stripe';

const { logger } = await import('../server/core/logger');

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolConnect.mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() });
});

describe('Webhook Framework — extractResourceId', () => {
  it('extracts payment_intent resource id', () => {
    const event = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_123' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('pi_123');
  });

  it('extracts invoice resource id', () => {
    const event = { type: 'invoice.paid', data: { object: { id: 'in_456' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('in_456');
  });

  it('extracts subscription resource id', () => {
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_789' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('sub:sub_789');
  });

  it('extracts checkout session resource id', () => {
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_100' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('cs_100');
  });

  it('extracts charge resource id using payment_intent', () => {
    const event = { type: 'charge.refunded', data: { object: { id: 'ch_111', payment_intent: 'pi_222' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('pi_222');
  });

  it('falls back to charge id when no payment_intent', () => {
    const event = { type: 'charge.refunded', data: { object: { id: 'ch_333' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('ch_333');
  });

  it('extracts setup_intent resource id', () => {
    const event = { type: 'setup_intent.succeeded', data: { object: { id: 'seti_444' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('seti_444');
  });

  it('extracts subscription_schedule resource id', () => {
    const event = { type: 'subscription_schedule.updated', data: { object: { id: 'sub_sched_555' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBe('sub_sched_555');
  });

  it('returns null for unrecognized event types', () => {
    const event = { type: 'product.updated', data: { object: { id: 'prod_123' } } } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBeNull();
  });

  it('returns null when data.object is missing', () => {
    const event = { type: 'payment_intent.succeeded', data: {} } as unknown as Stripe.Event;
    expect(extractResourceId(event)).toBeNull();
  });
});

describe('Webhook Framework — tryClaimEvent', () => {
  it('claims a new event successfully', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO webhook_processed_events', [{ event_id: 'evt_123' }], 1);

    const result = await tryClaimEvent(client as any, 'evt_123', 'payment_intent.succeeded', 1234567890, 'pi_456');
    expect(result.claimed).toBe(true);
  });

  it('rejects duplicate events', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO webhook_processed_events', [], 0);

    const result = await tryClaimEvent(client as any, 'evt_123', 'payment_intent.succeeded', 1234567890, 'pi_456');
    expect(result.claimed).toBe(false);
    expect(result.reason).toBe('duplicate');
  });
});

describe('Webhook Framework — checkResourceEventOrder', () => {
  it('allows first event for a resource', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [], 0);

    const result = await checkResourceEventOrder(client as any, 'pi_123', 'payment_intent.succeeded', 1234567890);
    expect(result).toBe(true);
  });

  it('allows higher-priority event after lower-priority', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'payment_intent.created', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'pi_123', 'payment_intent.succeeded', 1234567890);
    expect(result).toBe(true);
  });

  it('blocks lower-priority event after higher-priority within same family', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }]);

    const mockDlqClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    mockPoolConnect.mockResolvedValueOnce(mockDlqClient);

    const result = await checkResourceEventOrder(client as any, 'pi_123', 'payment_intent.created', 1234567890, 'evt_test');
    expect(result).toBe(false);
  });

  it('blocks subscription.created after subscription.deleted (ghost reactivation)', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'customer.subscription.deleted', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'sub_123', 'customer.subscription.created', 1234567890);
    expect(result).toBe(false);
  });

  it('allows subscription.created after subscription.updated', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'customer.subscription.updated', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'sub_123', 'customer.subscription.created', 1234567890);
    expect(result).toBe(true);
  });

  it('allows events from different families regardless of priority', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'pi_123', 'charge.refunded', 1234567890);
    expect(result).toBe(true);
  });
});

describe('Webhook Framework — executeDeferredActions', () => {
  it('executes all actions and returns 0 on success', async () => {
    const action1 = vi.fn().mockResolvedValue(undefined);
    const action2 = vi.fn().mockResolvedValue(undefined);

    const failed = await executeDeferredActions([action1, action2], { eventId: 'evt_1', eventType: 'test' });
    expect(failed).toBe(0);
    expect(action1).toHaveBeenCalled();
    expect(action2).toHaveBeenCalled();
  });

  it('counts failures but continues executing remaining actions', async () => {
    const action1 = vi.fn().mockRejectedValue(new Error('fail'));
    const action2 = vi.fn().mockResolvedValue(undefined);
    const action3 = vi.fn().mockRejectedValue(new Error('fail2'));

    const failed = await executeDeferredActions([action1, action2, action3], { eventId: 'evt_1', eventType: 'test' });
    expect(failed).toBe(2);
    expect(action2).toHaveBeenCalled();
  });

  it('returns 0 for empty actions array', async () => {
    const failed = await executeDeferredActions([]);
    expect(failed).toBe(0);
  });
});

describe('Payment Handlers — handlePaymentIntentSucceeded', () => {
  it('upserts transaction cache and records payment intent in DB', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO stripe_payment_intents', [], 1);

    const paymentIntent = {
      id: 'pi_test_123',
      amount: 5000,
      currency: 'usd',
      customer: 'cus_test',
      receipt_email: 'test@example.com',
      description: 'Test payment',
      created: Math.floor(Date.now() / 1000),
      metadata: { purpose: 'payment' },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentSucceeded(client as any, paymentIntent);
    expect(actions.length).toBeGreaterThan(0);

    const insertCalls = client._getCalls().filter(c => c.text.includes('INSERT INTO stripe_payment_intents'));
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].values).toContain('pi_test_123');
  });

  it('handles fee snapshot-based payment with participant updates', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO stripe_payment_intents', [], 1);
    client._setResult('SELECT bfs.*', [{ id: 1, session_id: 10, total_cents: 5000, participant_fees: [{ id: 100, amountCents: 5000 }] }], 1);
    client._setResult('SELECT id, payment_status FROM booking_participants', [{ id: 100, payment_status: 'pending' }]);
    client._setResult('UPDATE booking_fee_snapshots', [], 1);
    client._setResult('UPDATE booking_participants', [], 1);

    const paymentIntent = {
      id: 'pi_snapshot_123',
      amount: 5000,
      currency: 'usd',
      customer: 'cus_test',
      created: Math.floor(Date.now() / 1000),
      metadata: { feeSnapshotId: '1', bookingId: '5', sessionId: '10' },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentSucceeded(client as any, paymentIntent);
    expect(actions.length).toBeGreaterThan(0);

    const snapshotUpdate = client._getCalls().filter(c => c.text.includes('UPDATE booking_fee_snapshots'));
    expect(snapshotUpdate.length).toBe(1);
  });

  it('returns early for already-completed fee snapshots (idempotency)', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO stripe_payment_intents', [], 1);
    client._setResult('SELECT bfs.*', [], 0);
    client._setResult("status IN ('completed', 'paid')", [{ id: 1, status: 'completed' }], 1);

    const paymentIntent = {
      id: 'pi_idempotent',
      amount: 5000,
      currency: 'usd',
      customer: 'cus_test',
      created: Math.floor(Date.now() / 1000),
      metadata: { feeSnapshotId: '1', bookingId: '5' },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentSucceeded(client as any, paymentIntent);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Payment Handlers — handlePaymentIntentFailed', () => {
  it('records failure and sends notifications for booking payments', async () => {
    const client = createMockClient();
    client._setResult('SELECT email', [{ email: 'member@test.com', first_name: 'John', last_name: 'Doe' }]);
    client._setResult('INSERT INTO stripe_payment_intents', [], 1);
    client._setResult('SELECT br.id', [{ id: 1 }]);

    const paymentIntent = {
      id: 'pi_failed_123',
      amount: 5000,
      currency: 'usd',
      customer: 'cus_test',
      receipt_email: 'member@test.com',
      last_payment_error: { message: 'Card declined' },
      created: Math.floor(Date.now() / 1000),
      metadata: { bookingId: '1', sessionId: '2', email: 'member@test.com' },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentFailed(client as any, paymentIntent);
    const upsertCalls = client._getCalls().filter(c => c.text.includes('INSERT INTO stripe_payment_intents'));
    expect(upsertCalls.length).toBeGreaterThan(0);
  });
});

describe('Payment Handlers — handleChargeRefunded', () => {
  it('updates payment intent status and caches refund transactions', async () => {
    const client = createMockClient();
    client._setResult('UPDATE stripe_payment_intents', [], 1);
    client._setResult('SELECT id FROM booking_participants', [], 0);
    client._setResult('UPDATE terminal_payments', [], 0);

    const charge = {
      id: 'ch_test_123',
      amount: 5000,
      amount_refunded: 5000,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_test_123',
      created: Math.floor(Date.now() / 1000),
      refunded: true,
      refunds: { data: [{ id: 're_test_1', amount: 5000, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000) }] },
      billing_details: { email: 'member@test.com' },
      metadata: {},
    } as unknown as Stripe.Charge;

    const actions = await handleChargeRefunded(client as any, charge);
    expect(actions.length).toBeGreaterThan(0);

    const piUpdate = client._getCalls().filter(c => c.text.includes('UPDATE stripe_payment_intents'));
    expect(piUpdate.length).toBe(1);
    expect(piUpdate[0].values).toContain('refunded');
  });

  it('marks participants as refunded and restores guest passes for full refund', async () => {
    const client = createMockClient();
    client._setResult('UPDATE stripe_payment_intents SET status', [], 1);
    client._setResult('FOR UPDATE', [{ id: 1 }]);
    client._setResult('WITH updated AS', [{ id: 1, session_id: 10, user_id: 5, user_email: 'member@test.com' }], 1);
    client._setResult('JOIN booking_requests br', [{ id: 100, booking_owner_email: 'member@test.com' }]);
    client._setResult('used_guest_pass = true', [{ id: 1, display_name: 'Guest', used_guest_pass: true }], 1);
    client._setResult('SELECT last_reset_date', [{ last_reset_date: null }]);
    client._setResult('UPDATE guest_passes SET passes_used', [], 1);
    client._setResult('UPDATE booking_participants SET used_guest_pass', [], 1);
    client._setResult('DELETE FROM usage_ledger', [], 0);
    client._setResult('DELETE FROM guest_pass_holds', [], 0);
    client._setResult('INSERT INTO notifications', [], 1);
    client._setResult('UPDATE terminal_payments', [], 0);
    client._setResult('SELECT bs.session_date', [{ session_date: new Date() }]);
    client._setResult('SELECT id FROM users WHERE LOWER(email)', [{ id: 5 }]);

    const charge = {
      id: 'ch_refund_full',
      amount: 5000,
      amount_refunded: 5000,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_refund_full',
      created: Math.floor(Date.now() / 1000),
      refunded: true,
      refunds: { data: [{ id: 're_1', amount: 5000, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000) }] },
      billing_details: { email: 'member@test.com' },
      receipt_email: 'member@test.com',
      metadata: {},
    } as unknown as Stripe.Charge;

    const actions = await handleChargeRefunded(client as any, charge);
    expect(actions.length).toBeGreaterThan(0);

    const guestPassUpdate = client._getCalls().filter(c => c.text.includes('UPDATE guest_passes SET passes_used'));
    expect(guestPassUpdate.length).toBe(1);
  });

  it('skips participant updates for partial refunds', async () => {
    const client = createMockClient();
    client._setResult('UPDATE stripe_payment_intents', [], 1);
    client._setResult('UPDATE terminal_payments', [], 0);

    const charge = {
      id: 'ch_partial',
      amount: 5000,
      amount_refunded: 2500,
      currency: 'usd',
      customer: 'cus_test',
      payment_intent: 'pi_partial',
      created: Math.floor(Date.now() / 1000),
      refunded: false,
      refunds: { data: [{ id: 're_partial', amount: 2500, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000) }] },
      billing_details: { email: 'member@test.com' },
      metadata: {},
    } as unknown as Stripe.Charge;

    const actions = await handleChargeRefunded(client as any, charge);

    const participantUpdate = client._getCalls().filter(c => c.text.includes("SET payment_status = 'refunded'"));
    expect(participantUpdate.length).toBe(0);
  });
});

describe('Payment Handlers — handleChargeDisputeCreated', () => {
  it('suspends member account and notifies staff for terminal payment dispute', async () => {
    const client = createMockClient();
    client._setResult('UPDATE terminal_payments', [{ id: 1, user_id: 5, user_email: 'disputed@test.com', stripe_subscription_id: 'sub_1', amount_cents: 10000 }], 1);
    client._setResult('SELECT billing_provider', [{ billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET membership_status', [], 1);
    client._setResult('INSERT INTO notifications', [], 1);

    const dispute = {
      id: 'dp_test',
      amount: 10000,
      charge: 'ch_test',
      payment_intent: 'pi_test',
      reason: 'fraudulent',
      status: 'needs_response',
    } as unknown as Stripe.Dispute;

    const actions = await handleChargeDisputeCreated(client as any, dispute);
    expect(actions.length).toBeGreaterThan(0);

    const suspendCalls = client._getCalls().filter(c => c.text.includes("membership_status = 'suspended'"));
    expect(suspendCalls.length).toBe(1);
  });
});

describe('Payment Handlers — handleCreditNoteCreated', () => {
  it('caches credit note and notifies member', async () => {
    const client = createMockClient();
    client._setResult('SELECT email', [{ email: 'member@test.com', display_name: 'John Doe' }]);

    const creditNote = {
      id: 'cn_test',
      number: 'CN-001',
      invoice: 'in_test',
      customer: 'cus_test',
      total: 2500,
      currency: 'usd',
      status: 'issued',
      created: Math.floor(Date.now() / 1000),
      reason: 'product_unsatisfactory',
      memo: 'Refund for issue',
      lines: { data: [] },
    } as unknown as Stripe.CreditNote;

    const actions = await handleCreditNoteCreated(client as any, creditNote);
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Invoice Handlers — handleInvoicePaymentSucceeded', () => {
  it('clears grace period, updates period end, and sends renewal notifications', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, first_name, last_name, billing_provider', [{ id: 1, first_name: 'Jane', last_name: 'Doe', billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET', [], 1);
    client._setResult('UPDATE hubspot_deals', [], 1);
    client._setResult('SELECT name FROM membership_tiers', [{ name: 'Gold' }]);

    const invoice = {
      id: 'in_success',
      customer: 'cus_test',
      customer_email: 'jane@test.com',
      amount_paid: 9900,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      lines: { data: [{ description: 'Gold Membership', period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 }, price: { id: 'price_gold' } }] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentSucceeded(client as any, invoice);
    expect(actions.length).toBeGreaterThan(0);

    const gracePeriodClear = client._getCalls().filter(c => c.text.includes('grace_period_start = NULL'));
    expect(gracePeriodClear.length).toBe(1);
  });

  it('skips subscription logic for one-time invoices', async () => {
    const client = createMockClient();

    const invoice = {
      id: 'in_onetime',
      customer: 'cus_test',
      customer_email: 'onetime@test.com',
      amount_paid: 1000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: null,
      payment_intent: 'pi_test',
      lines: { data: [] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentSucceeded(client as any, invoice);
    expect(actions.length).toBeGreaterThanOrEqual(1);

    const gracePeriodClear = client._getCalls().filter(c => c.text.includes('grace_period_start = NULL'));
    expect(gracePeriodClear.length).toBe(0);
  });

  it('skips billing_provider update if not stripe', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, first_name, last_name, billing_provider', [{ id: 1, first_name: 'J', last_name: 'D', billing_provider: 'mindbody' }]);

    const invoice = {
      id: 'in_mb',
      customer: 'cus_test',
      customer_email: 'mb@test.com',
      amount_paid: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      lines: { data: [{ description: 'Membership' }] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentSucceeded(client as any, invoice);

    const graceClear = client._getCalls().filter(c => c.text.includes('grace_period_start = NULL'));
    expect(graceClear.length).toBe(0);
  });
});

describe('Invoice Handlers — handleInvoicePaymentFailed', () => {
  it('starts grace period, sets past_due, and sends dunning notifications', async () => {
    const client = createMockClient();
    client._setResult("SELECT first_name, last_name FROM users", [{ first_name: 'Bob', last_name: 'Smith' }]);
    client._setResult("SELECT membership_status, stripe_subscription_id", [{ membership_status: 'active', stripe_subscription_id: 'sub_test' }]);
    client._setResult("SELECT membership_status, billing_provider", [{ membership_status: 'active', billing_provider: 'stripe' }]);
    client._setResult("UPDATE users SET", [], 1);
    client._setResult("UPDATE hubspot_deals", [], 1);
    client._setResult("SELECT membership_status FROM users", [{ membership_status: 'past_due' }]);

    const invoice = {
      id: 'in_failed',
      customer: 'cus_test',
      customer_email: 'bob@test.com',
      amount_due: 9900,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      attempt_count: 1,
      lines: { data: [{ description: 'Gold Membership' }] },
      metadata: {},
      last_finalization_error: null,
    } as unknown as any;

    const actions = await handleInvoicePaymentFailed(client as any, invoice);
    expect(actions.length).toBeGreaterThan(0);

    const gracePeriod = client._getCalls().filter(c => c.text.includes('grace_period_start = COALESCE'));
    expect(gracePeriod.length).toBe(1);
  });

  it('skips dunning for cancelled/suspended members', async () => {
    const client = createMockClient();
    client._setResult("SELECT first_name, last_name FROM users", [{ first_name: 'X', last_name: 'Y' }]);
    client._setResult("SELECT membership_status, stripe_subscription_id", [{ membership_status: 'cancelled', stripe_subscription_id: 'sub_test' }]);

    const invoice = {
      id: 'in_cancelled',
      customer: 'cus_test',
      customer_email: 'cancelled@test.com',
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      attempt_count: 1,
      lines: { data: [] },
      metadata: {},
      last_finalization_error: null,
    } as unknown as any;

    const actions = await handleInvoicePaymentFailed(client as any, invoice);

    const gracePeriod = client._getCalls().filter(c => c.text.includes('grace_period_start = COALESCE'));
    expect(gracePeriod.length).toBe(0);
  });

  it('skips grace period for stale subscription invoices', async () => {
    const client = createMockClient();
    client._setResult("SELECT first_name, last_name FROM users", [{ first_name: 'X', last_name: 'Y' }]);
    client._setResult("SELECT membership_status, stripe_subscription_id", [{ membership_status: 'active', stripe_subscription_id: 'sub_current' }]);

    const invoice = {
      id: 'in_stale',
      customer: 'cus_test',
      customer_email: 'stale@test.com',
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_old',
      payment_intent: 'pi_test',
      attempt_count: 1,
      lines: { data: [] },
      metadata: {},
      last_finalization_error: null,
    } as unknown as any;

    const actions = await handleInvoicePaymentFailed(client as any, invoice);

    const gracePeriod = client._getCalls().filter(c => c.text.includes('grace_period_start = COALESCE'));
    expect(gracePeriod.length).toBe(0);
  });
});

describe('Invoice Handlers — handleInvoiceLifecycle', () => {
  it('caches invoice on finalization', async () => {
    const client = createMockClient();

    const invoice = {
      id: 'in_finalized',
      customer: 'cus_test',
      customer_email: 'test@test.com',
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      status: 'open',
      lines: { data: [{ description: 'Membership' }] },
      payment_intent: 'pi_test',
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoiceLifecycle(client as any, invoice, 'invoice.finalized');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Invoice Handlers — handleInvoiceVoided', () => {
  it('sets voided status in transaction cache', async () => {
    const client = createMockClient();

    const invoice = {
      id: 'in_voided',
      customer: 'cus_test',
      customer_email: 'test@test.com',
      amount_due: 5000,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      status: 'void',
      number: 'INV-001',
      lines: { data: [{ description: 'Membership' }] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoiceVoided(client as any, invoice, 'invoice.voided');
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Invoice Handlers — handleInvoicePaymentActionRequired', () => {
  it('notifies member and staff when 3DS authentication is needed', async () => {
    const client = createMockClient();
    client._setResult('SELECT email', [{ email: 'auth@test.com', display_name: 'Auth User' }]);

    const invoice = {
      id: 'in_action',
      customer: 'cus_test',
      hosted_invoice_url: 'https://stripe.com/invoice/test',
      lines: { data: [] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentActionRequired(client as any, invoice);
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });

  it('skips when no customer id', async () => {
    const client = createMockClient();

    const invoice = {
      id: 'in_no_customer',
      customer: null,
      lines: { data: [] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentActionRequired(client as any, invoice);
    expect(actions.length).toBe(0);
  });
});

describe('Invoice Handlers — handleInvoiceOverdue', () => {
  it('notifies member and staff about overdue invoice', async () => {
    const client = createMockClient();
    client._setResult('SELECT email', [{ email: 'overdue@test.com', display_name: 'Overdue User', billing_provider: 'stripe' }]);

    const invoice = {
      id: 'in_overdue',
      customer: 'cus_test',
      amount_due: 9900,
      lines: { data: [] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoiceOverdue(client as any, invoice);
    expect(actions.length).toBeGreaterThanOrEqual(3);
  });

  it('skips for non-stripe billing provider', async () => {
    const client = createMockClient();
    client._setResult('SELECT email', [{ email: 'mb@test.com', display_name: 'MB User', billing_provider: 'mindbody' }]);

    const invoice = {
      id: 'in_overdue_mb',
      customer: 'cus_test',
      amount_due: 9900,
      lines: { data: [] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoiceOverdue(client as any, invoice);
    expect(actions.length).toBe(0);
  });
});

describe('Subscription Handlers — handleSubscriptionPaused', () => {
  it('sets membership status to frozen for stripe-billed members', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'paused@test.com', first_name: 'P', last_name: 'User', billing_provider: 'stripe', pending_tier_change: null }]);
    client._setResult('UPDATE users SET membership_status', [], 1);

    const subscription = {
      id: 'sub_paused',
      customer: 'cus_test',
      status: 'paused',
      items: { data: [{ price: { id: 'price_gold' } }] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionPaused(client as any, subscription);
    expect(actions.length).toBeGreaterThan(0);

    const frozenUpdate = client._getCalls().filter(c => c.text.includes("membership_status = 'frozen'"));
    expect(frozenUpdate.length).toBe(1);
  });

  it('skips for non-stripe billing provider', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'mb@test.com', first_name: 'M', last_name: 'B', billing_provider: 'mindbody', pending_tier_change: null }]);

    const subscription = {
      id: 'sub_paused_mb',
      customer: 'cus_mb',
      status: 'paused',
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionPaused(client as any, subscription);
    expect(actions.length).toBe(0);
  });

  it('returns early when no user found', async () => {
    const client = createMockClient();

    const subscription = {
      id: 'sub_no_user',
      customer: 'cus_unknown',
      status: 'paused',
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionPaused(client as any, subscription);
    expect(actions.length).toBe(0);
  });
});

describe('Subscription Handlers — handleSubscriptionResumed', () => {
  it('sets membership status to active and clears archived state', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'resumed@test.com', first_name: 'R', last_name: 'User', billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET membership_status', [], 1);

    const subscription = {
      id: 'sub_resumed',
      customer: 'cus_test',
      status: 'active',
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { id: 'price_gold' } }] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionResumed(client as any, subscription);
    expect(actions.length).toBeGreaterThan(0);

    const activeUpdate = client._getCalls().filter(c => c.text.includes("membership_status = 'active'"));
    expect(activeUpdate.length).toBe(1);
  });

  it('skips for non-stripe billing provider', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'mb@test.com', first_name: 'M', last_name: 'B', billing_provider: 'mindbody' }]);

    const subscription = {
      id: 'sub_resumed_mb',
      customer: 'cus_mb',
      status: 'active',
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionResumed(client as any, subscription);
    expect(actions.length).toBe(0);
  });
});

describe('Subscription Handlers — handleSubscriptionDeleted', () => {
  it('cancels membership and deactivates billing groups', async () => {
    const client = createMockClient();
    client._setResult("SELECT email, first_name, last_name, membership_status, billing_provider", [{ email: 'deleted@test.com', first_name: 'D', last_name: 'User', membership_status: 'active', billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET', [], 1);
    client._setResult('SELECT br.id', []);
    client._setResult('SELECT id FROM booking_requests', []);

    const subscription = {
      id: 'sub_deleted',
      customer: 'cus_test',
      status: 'canceled',
      items: { data: [{ price: { nickname: 'Gold Membership' } }] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionDeleted(client as any, subscription);
    const statusUpdateCalls = client._getCalls().filter(c => c.text.includes('UPDATE users SET') && c.text.includes('membership_status'));
    expect(statusUpdateCalls.length).toBeGreaterThan(0);
  });

  it('pauses instead of cancels when member was trialing', async () => {
    const client = createMockClient();
    client._setResult("SELECT email, first_name, last_name, membership_status, billing_provider", [{ email: 'trial@test.com', first_name: 'T', last_name: 'User', membership_status: 'trialing', billing_provider: 'stripe' }]);
    client._setResult("UPDATE users SET", [], 1);

    const subscription = {
      id: 'sub_trial_end',
      customer: 'cus_trial',
      status: 'canceled',
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionDeleted(client as any, subscription);

    const pauseUpdate = client._getCalls().filter(c => c.text.includes("membership_status = 'paused'"));
    expect(pauseUpdate.length).toBe(1);
  });

  it('skips for non-stripe billing provider', async () => {
    const client = createMockClient();
    client._setResult("SELECT email, first_name, last_name, membership_status, billing_provider", [{ email: 'mb@test.com', first_name: 'M', last_name: 'B', membership_status: 'active', billing_provider: 'mindbody' }]);

    const subscription = {
      id: 'sub_del_mb',
      customer: 'cus_mb',
      status: 'canceled',
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionDeleted(client as any, subscription);
    expect(actions.length).toBe(0);
  });
});

describe('Customer Handlers — handleCustomerUpdated', () => {
  it('detects email changes and handles collision prevention', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email, first_name, last_name, archived_at, membership_status', [{ id: 1, email: 'old@test.com', first_name: 'O', last_name: 'User', archived_at: null, membership_status: 'active', display_name: 'O User' }]);
    client._setResult('SELECT id, email, stripe_customer_id FROM users WHERE LOWER(email)', [], 0);
    client._setResult('UPDATE users SET', [], 1);

    const customer = {
      id: 'cus_updated',
      email: 'new@test.com',
      name: 'New Name',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerUpdated(client as any, customer);
    const emailUpdateCalls = client._getCalls().filter(c => c.text.includes('UPDATE users SET'));
    expect(emailUpdateCalls.length).toBeGreaterThan(0);
  });

  it('skips sync when customer has no email', async () => {
    const client = createMockClient();

    const customer = {
      id: 'cus_no_email',
      email: null,
      name: 'No Email',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerUpdated(client as any, customer);
    expect(actions.length).toBe(0);
  });

  it('clears stripe links for merged/archived users', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email, first_name, last_name, archived_at, membership_status', [{ id: 1, email: 'merged@test.com.merged.123', first_name: null, last_name: null, archived_at: new Date(), membership_status: 'merged', display_name: 'merged' }]);
    client._setResult('UPDATE users SET stripe_customer_id = NULL', [], 1);

    const customer = {
      id: 'cus_merged',
      email: 'active@test.com',
      name: 'Active User',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerUpdated(client as any, customer);
    expect(actions.length).toBe(0);

    const clearCalls = client._getCalls().filter(c => c.text.includes('stripe_customer_id = NULL'));
    expect(clearCalls.length).toBe(1);
  });
});

describe('Customer Handlers — handleCustomerCreated', () => {
  it('returns empty actions when user already linked to same stripe customer', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'newcustomer@test.com', display_name: 'New Customer', stripe_customer_id: 'cus_new' }]);

    const customer = {
      id: 'cus_new',
      email: 'newcustomer@test.com',
      name: 'New Customer',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerCreated(client as any, customer);
    expect(actions.length).toBe(0);
  });

  it('notifies staff about duplicate customer when IDs differ', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'dup@test.com', display_name: 'Dup User', stripe_customer_id: 'cus_old' }]);

    const customer = {
      id: 'cus_new_dup',
      email: 'dup@test.com',
      name: 'Dup User',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerCreated(client as any, customer);
    expect(actions.length).toBe(2);

    await actions[0]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Duplicate Stripe Customer Detected',
      expect.stringContaining('cus_old'),
      'billing'
    );
  });

  it('returns empty actions when customer has no email', async () => {
    const client = createMockClient();

    const customer = {
      id: 'cus_no_email',
      email: null,
      name: 'No Email',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerCreated(client as any, customer);
    expect(actions.length).toBe(0);
    expect(client._getCalls().length).toBe(0);
  });

  it('returns empty actions when no matching user found', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', []);

    const customer = {
      id: 'cus_orphan',
      email: 'orphan@test.com',
      name: 'Orphan',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerCreated(client as any, customer);
    expect(actions.length).toBe(0);
  });
});

describe('Customer Handlers — handleCustomerDeleted', () => {
  it('disconnects user from Stripe and alerts staff', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'deleted@test.com', first_name: 'D', last_name: 'User', display_name: 'D User', membership_status: 'active' }]);
    client._setResult('UPDATE users SET', [], 1);

    const customer = {
      id: 'cus_deleted',
      email: 'deleted@test.com',
      name: 'Deleted Customer',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerDeleted(client as any, customer);
    expect(actions.length).toBeGreaterThan(0);

    const clearBilling = client._getCalls().filter(c => c.text.includes('stripe_customer_id = NULL') || c.text.includes('billing_provider = NULL'));
    expect(clearBilling.length).toBeGreaterThan(0);
  });
});

describe('Checkout Handlers — handleCheckoutSessionCompleted', () => {
  it('processes add_funds checkout correctly', async () => {
    const client = createMockClient();
    client._setResult("SELECT first_name, last_name FROM users", [{ first_name: 'Fund', last_name: 'User' }]);

    mockGetStripeClient.mockResolvedValueOnce({
      customers: {
        createBalanceTransaction: vi.fn().mockResolvedValue({
          id: 'txn_test',
          ending_balance: -5000,
        }),
      },
      paymentIntents: { retrieve: vi.fn(), update: vi.fn() },
    });

    const session = {
      id: 'cs_funds',
      customer: 'cus_test',
      metadata: {
        purpose: 'add_funds',
        amountCents: '5000',
        memberEmail: 'fund@test.com',
      },
      payment_intent: 'pi_test',
    } as unknown as Stripe.Checkout.Session;

    const actions = await handleCheckoutSessionCompleted(client as any, session);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('returns early when add_funds has no customer ID', async () => {
    const client = createMockClient();

    const session = {
      id: 'cs_no_cus',
      customer: null,
      metadata: {
        purpose: 'add_funds',
        amountCents: '5000',
        memberEmail: 'test@test.com',
      },
    } as unknown as Stripe.Checkout.Session;

    const actions = await handleCheckoutSessionCompleted(client as any, session);
    expect(actions.length).toBe(0);
  });

  it('returns early when add_funds has invalid amount', async () => {
    const client = createMockClient();

    const session = {
      id: 'cs_bad_amount',
      customer: 'cus_test',
      metadata: {
        purpose: 'add_funds',
        amountCents: '0',
        memberEmail: 'test@test.com',
      },
    } as unknown as Stripe.Checkout.Session;

    const actions = await handleCheckoutSessionCompleted(client as any, session);
    expect(actions.length).toBe(0);
  });
});

describe('Catalog Handlers — handleProductUpdated', () => {
  it('skips app-originated product updates', async () => {
    const { isAppOriginated } = await import('../server/core/stripe/appOriginTracker');
    vi.mocked(isAppOriginated).mockReturnValueOnce(true);

    const client = createMockClient();
    const product = { id: 'prod_app', name: 'App Product', metadata: {} } as any;

    const actions = await handleProductUpdated(client as any, product);
    expect(actions.length).toBe(0);
    expect(client._getCalls().length).toBe(0);
  });

  it('skips external changes to fee products (app is source of truth)', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name FROM fee_products', [{ id: 1, name: 'Overage Fee' }]);

    const product = { id: 'prod_fee', name: 'Fee Product', metadata: {} } as any;
    const actions = await handleProductUpdated(client as any, product);
    expect(actions.length).toBe(0);
  });

  it('pulls corporate volume pricing when config_type metadata matches', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name FROM fee_products', []);
    client._setResult('SELECT id, name FROM membership_tiers', []);

    const product = { id: 'prod_corp', name: 'Corp Product', metadata: { config_type: 'corporate_volume_pricing' } } as any;
    const actions = await handleProductUpdated(client as any, product);
    expect(actions.length).toBe(1);
  });
});

describe('Catalog Handlers — handleProductCreated', () => {
  it('skips app-created products', async () => {
    const client = createMockClient();
    const product = { id: 'prod_app2', name: 'New Product', metadata: { source: 'ever_house_app' } } as unknown as Stripe.Product;

    const actions = await handleProductCreated(client as any, product);
    expect(actions.length).toBe(0);
  });

  it('links new product to unlinked fee product via metadata', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name FROM fee_products WHERE stripe_product_id', []);
    client._setResult('SELECT id, name FROM membership_tiers WHERE stripe_product_id', []);
    client._setResult('SELECT id, name FROM fee_products WHERE id', [{ id: 5, name: 'Guest Pass' }]);
    client._setResult('UPDATE fee_products SET stripe_product_id', [], 1);

    const product = { id: 'prod_new', name: 'Guest Product', metadata: { fee_product_id: '5' } } as unknown as Stripe.Product;
    const actions = await handleProductCreated(client as any, product);
    expect(actions.length).toBe(0);

    const updateCalls = client._getCalls().filter(c => c.text.includes('UPDATE fee_products SET stripe_product_id'));
    expect(updateCalls.length).toBe(1);
  });

  it('returns empty actions when no local record matches', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name FROM fee_products', []);
    client._setResult('SELECT id, name FROM membership_tiers', []);

    const product = { id: 'prod_orphan', name: 'Orphan', metadata: {} } as unknown as Stripe.Product;
    const actions = await handleProductCreated(client as any, product);
    expect(actions.length).toBe(0);
  });
});

describe('Catalog Handlers — handleProductDeleted', () => {
  it('clears stripe IDs on matching fee product', async () => {
    const client = createMockClient();
    client._setResult('UPDATE fee_products SET stripe_product_id = NULL', [{ id: 1, name: 'Overage' }], 1);

    const product = { id: 'prod_del', name: 'Deleted Product' } as unknown as Stripe.Product;
    const actions = await handleProductDeleted(client as any, product);
    expect(actions.length).toBe(0);

    const clearCalls = client._getCalls().filter(c => c.text.includes('stripe_product_id = NULL'));
    expect(clearCalls.length).toBe(1);
  });

  it('clears stripe IDs on matching tier and invalidates registry', async () => {
    const client = createMockClient();
    client._setResult('UPDATE fee_products SET stripe_product_id = NULL', [], 0);
    client._setResult('SELECT id, name, product_type FROM membership_tiers', [{ id: 2, name: 'Gold', product_type: 'subscription' }]);
    client._setResult('UPDATE membership_tiers SET stripe_product_id = NULL', [], 1);

    const product = { id: 'prod_tier_del', name: 'Tier Product' } as unknown as Stripe.Product;
    const actions = await handleProductDeleted(client as any, product);
    expect(actions.length).toBe(1);
  });
});

describe('Catalog Handlers — handlePriceChange', () => {
  it('updates overage rate when fee product slug matches', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name, slug, price_cents FROM fee_products', [{ id: 1, name: 'Overage', slug: 'simulator-overage-30min', price_cents: 2000 }]);
    client._setResult('UPDATE fee_products SET stripe_price_id', [], 1);

    const price = { id: 'price_new', product: 'prod_overage', active: true, unit_amount: 2500 } as unknown as Stripe.Price;
    const actions = await handlePriceChange(client as any, price);
    expect(actions.length).toBe(0);

    const { updateOverageRate } = await import('../server/core/billing/pricingConfig');
    expect(updateOverageRate).toHaveBeenCalledWith(2500);
  });

  it('updates guest fee when fee product slug matches', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, name, slug, price_cents FROM fee_products', [{ id: 2, name: 'Guest', slug: 'guest-pass', price_cents: 1000 }]);
    client._setResult('UPDATE fee_products SET stripe_price_id', [], 1);

    const price = { id: 'price_guest', product: 'prod_guest', active: true, unit_amount: 1500 } as unknown as Stripe.Price;
    const actions = await handlePriceChange(client as any, price);
    expect(actions.length).toBe(0);

    const { updateGuestFee } = await import('../server/core/billing/pricingConfig');
    expect(updateGuestFee).toHaveBeenCalledWith(1500);
  });

  it('skips inactive prices', async () => {
    const client = createMockClient();
    const price = { id: 'price_inactive', product: 'prod_x', active: false, unit_amount: 1000 } as unknown as Stripe.Price;

    const actions = await handlePriceChange(client as any, price);
    expect(actions.length).toBe(0);
    expect(client._getCalls().length).toBe(0);
  });

  it('skips app-originated price changes', async () => {
    const { isAppOriginated } = await import('../server/core/stripe/appOriginTracker');
    vi.mocked(isAppOriginated).mockReturnValueOnce(true);

    const client = createMockClient();
    const price = { id: 'price_app', product: 'prod_app', active: true, unit_amount: 1000 } as unknown as Stripe.Price;

    const actions = await handlePriceChange(client as any, price);
    expect(actions.length).toBe(0);
    expect(client._getCalls().length).toBe(0);
  });
});

describe('Catalog Handlers — handlePriceDeleted', () => {
  it('clears stripe_price_id on matching fee product', async () => {
    const client = createMockClient();
    client._setResult('UPDATE fee_products SET stripe_price_id = NULL', [{ id: 1, name: 'Overage' }], 1);
    client._setResult('UPDATE membership_tiers SET stripe_price_id = NULL', [], 0);
    client._setResult('UPDATE cafe_items SET stripe_price_id = NULL', [], 0);

    const price = { id: 'price_del', product: 'prod_x' } as unknown as Stripe.Price;
    const actions = await handlePriceDeleted(client as any, price);
    expect(actions.length).toBe(0);
  });

  it('clears tier price and invalidates registry', async () => {
    const client = createMockClient();
    client._setResult('UPDATE fee_products SET stripe_price_id = NULL', [], 0);
    client._setResult('UPDATE membership_tiers SET stripe_price_id = NULL', [{ id: 2, name: 'Gold', slug: 'gold' }], 1);
    client._setResult('UPDATE cafe_items SET stripe_price_id = NULL', [], 0);

    const price = { id: 'price_tier_del', product: 'prod_tier' } as unknown as Stripe.Price;
    const actions = await handlePriceDeleted(client as any, price);
    expect(actions.length).toBe(1);
  });

  it('skips app-originated price deletions', async () => {
    const { isAppOriginated } = await import('../server/core/stripe/appOriginTracker');
    vi.mocked(isAppOriginated).mockReturnValueOnce(true);

    const client = createMockClient();
    const price = { id: 'price_app_del', product: 'prod_app' } as unknown as Stripe.Price;
    const actions = await handlePriceDeleted(client as any, price);
    expect(actions.length).toBe(0);
    expect(client._getCalls().length).toBe(0);
  });
});

describe('processStripeWebhook — signature verification', () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const expectedLivemode = isProduction;
  const makePayload = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj));

  it('throws when payload is not a Buffer', async () => {
    await expect(processStripeWebhook('not-a-buffer' as any, 'sig_test'))
      .rejects.toThrow('Payload must be a Buffer');
  });

  it('throws when signature verification fails', async () => {
    const mockSync = { processWebhook: vi.fn().mockRejectedValue(new Error('bad sig')) };
    mockGetStripeSync.mockResolvedValueOnce(mockSync);

    const payload = makePayload({ id: 'evt_test', livemode: expectedLivemode, type: 'payment_intent.created', data: { object: { id: 'pi_1' } } });

    await expect(processStripeWebhook(payload, 'sig_bad'))
      .rejects.toThrow('Webhook signature verification failed');
    expect(mockSync.processWebhook).toHaveBeenCalledWith(payload, 'sig_bad');
  });

  it('skips events where livemode does not match environment', async () => {
    const mismatchedLivemode = !expectedLivemode;

    const payload = makePayload({ id: 'evt_mismatch', livemode: mismatchedLivemode, type: 'payment_intent.succeeded' });
    await processStripeWebhook(payload, 'sig_test');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`livemode=${mismatchedLivemode} does not match environment`)
    );
  });

  it('processes verified event through full pipeline (claim, dispatch, commit)', async () => {
    const mockSync = { processWebhook: vi.fn().mockResolvedValue(undefined) };
    mockGetStripeSync.mockResolvedValueOnce(mockSync);

    const eventObj = {
      id: 'evt_full_test',
      type: 'payment_intent.created',
      livemode: expectedLivemode,
      created: 1234567890,
      data: { object: { id: 'pi_created_1' } },
    };
    const payload = makePayload(eventObj);

    const mockStripe = { events: { retrieve: vi.fn().mockResolvedValue(eventObj) } };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);

    const queryFn = vi.fn().mockImplementation((text: string) => {
      if (typeof text === 'string' && text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [{ claimed: true }], rowCount: 1 };
      }
      if (typeof text === 'string' && text.includes('SELECT event_type')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const mockClient = { query: queryFn, release: vi.fn() };
    mockPoolConnect.mockResolvedValueOnce(mockClient);

    await processStripeWebhook(payload, 'sig_valid');

    expect(mockSync.processWebhook).toHaveBeenCalledWith(payload, 'sig_valid');
    expect(mockStripe.events.retrieve).toHaveBeenCalledWith('evt_full_test');
    const queryCalls = queryFn.mock.calls.map((c: unknown[]) => c[0]);
    expect(queryCalls).toContain('BEGIN');
    expect(queryCalls).toContain('COMMIT');
    expect(queryCalls).not.toContain('ROLLBACK');
  });

  it('rolls back and skips duplicate (already claimed) events', async () => {
    const mockSync = { processWebhook: vi.fn().mockResolvedValue(undefined) };
    mockGetStripeSync.mockResolvedValueOnce(mockSync);

    const eventObj = {
      id: 'evt_dup',
      type: 'invoice.created',
      livemode: expectedLivemode,
      created: 1234567890,
      data: { object: { id: 'in_dup1' } },
    };
    const payload = makePayload(eventObj);

    const mockStripe = { events: { retrieve: vi.fn().mockResolvedValue(eventObj) } };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);

    const queryFn = vi.fn().mockImplementation((text: string) => {
      if (typeof text === 'string' && text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const mockClient = { query: queryFn, release: vi.fn() };
    mockPoolConnect.mockResolvedValueOnce(mockClient);

    await processStripeWebhook(payload, 'sig_valid');

    const queryCalls = queryFn.mock.calls.map((c: unknown[]) => c[0]);
    expect(queryCalls).toContain('BEGIN');
    expect(queryCalls).toContain('ROLLBACK');
    expect(queryCalls).not.toContain('COMMIT');
  });
});

describe('processStripeWebhook — unknown event type handling', () => {
  it('commits successfully for unhandled event types and logs warning', async () => {
    const mockSync = { processWebhook: vi.fn().mockResolvedValue(undefined) };
    mockGetStripeSync.mockResolvedValueOnce(mockSync);

    const isProduction = process.env.NODE_ENV === 'production';
    const eventObj = {
      id: 'evt_unknown',
      type: 'totally.unknown.event',
      livemode: isProduction,
      created: 1234567890,
      data: { object: { id: 'obj_unknown' } },
    };
    const payload = Buffer.from(JSON.stringify(eventObj));

    const mockStripe = { events: { retrieve: vi.fn().mockResolvedValue(eventObj) } };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);

    const queryFn = vi.fn().mockImplementation((text: string) => {
      if (typeof text === 'string' && text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [{ claimed: true }], rowCount: 1 };
      }
      if (typeof text === 'string' && text.includes('SELECT event_type')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const mockClient = { query: queryFn, release: vi.fn() };
    mockPoolConnect.mockResolvedValueOnce(mockClient);

    await processStripeWebhook(payload, 'sig_valid');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Received unhandled event type: totally.unknown.event')
    );

    const queryCalls = queryFn.mock.calls.map((c: unknown[]) => c[0]);
    expect(queryCalls).toContain('COMMIT');
    expect(queryCalls).not.toContain('ROLLBACK');
  });
});

describe('Webhook Framework — cleanupOldProcessedEvents', () => {
  it('deletes events older than 30 days and logs count', async () => {
    const { _deleteReturning } = await import('../server/db') as any;
    _deleteReturning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    await cleanupOldProcessedEvents();

    expect(mockDelete).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Cleaned up 2 old processed events')
    );
  });

  it('does not log when no events to clean', async () => {
    const { _deleteReturning } = await import('../server/db') as any;
    _deleteReturning.mockResolvedValueOnce([]);

    vi.mocked(logger.info).mockClear();
    await cleanupOldProcessedEvents();

    const cleanupLogCalls = vi.mocked(logger.info).mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Cleaned up')
    );
    expect(cleanupLogCalls.length).toBe(0);
  });

  it('handles errors gracefully during cleanup without throwing', async () => {
    const { _deleteReturning } = await import('../server/db') as any;
    _deleteReturning.mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(cleanupOldProcessedEvents()).resolves.not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error cleaning up old events'),
      expect.objectContaining({ extra: { error: 'DB connection lost' } })
    );
  });
});

describe('Payment Handlers — handlePaymentIntentCanceled', () => {
  it('records terminal payment cancellation and notifies staff', async () => {
    const client = createMockClient();
    client._setResult('INSERT INTO terminal_payments', [], 1);

    const paymentIntent = {
      id: 'pi_canceled',
      amount: 5000,
      currency: 'usd',
      cancellation_reason: 'abandoned',
      metadata: {
        paymentType: 'subscription_terminal',
        email: 'cancel@test.com',
        subscriptionId: 'sub_cancel',
        userId: '42',
      },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentCanceled(client as any, paymentIntent);
    expect(actions.length).toBe(1);

    const terminalInsert = client._getCalls().filter(c => c.text.includes('INSERT INTO terminal_payments'));
    expect(terminalInsert.length).toBe(1);
    expect(terminalInsert[0].values).toContain('pi_canceled');
    expect(terminalInsert[0].values).toContain('cancel@test.com');

    await actions[0]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Terminal Payment Canceled',
      expect.stringContaining('cancel@test.com'),
      'terminal_payment_canceled',
      expect.objectContaining({ sendPush: true })
    );
  });

  it('returns empty actions for non-terminal canceled payments', async () => {
    const client = createMockClient();

    const paymentIntent = {
      id: 'pi_canceled_web',
      amount: 3000,
      currency: 'usd',
      cancellation_reason: 'requested_by_customer',
      metadata: {},
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentCanceled(client as any, paymentIntent);
    expect(actions.length).toBe(0);
  });
});

describe('Payment Handlers — handlePaymentIntentStatusUpdate', () => {
  it('updates PI status in DB and caches transaction', async () => {
    const client = createMockClient();
    client._setResult('UPDATE stripe_payment_intents SET status', [], 1);

    const paymentIntent = {
      id: 'pi_processing',
      status: 'processing',
      amount: 7500,
      currency: 'usd',
      customer: 'cus_status',
      created: Math.floor(Date.now() / 1000),
      metadata: { email: 'status@test.com' },
    } as unknown as Stripe.PaymentIntent;

    const actions = await handlePaymentIntentStatusUpdate(client as any, paymentIntent);
    expect(actions.length).toBe(1);

    const statusUpdate = client._getCalls().filter(c => c.text.includes('UPDATE stripe_payment_intents SET status'));
    expect(statusUpdate.length).toBe(1);
    expect(statusUpdate[0].values).toContain('pi_processing');
    expect(statusUpdate[0].values).toContain('processing');
  });
});

describe('Subscription Handlers — handleSubscriptionCreated', () => {
  it('activates existing user when subscription created', async () => {
    const client = createMockClient();
    client._setResult("SELECT email, first_name, last_name, tier, membership_status, billing_provider, migration_status", [{ email: 'new_sub@test.com', first_name: 'New', last_name: 'Sub', tier: null, membership_status: 'pending', billing_provider: null, migration_status: null }]);
    client._setResult("SELECT id, slug, name FROM membership_tiers", [{ id: 1, slug: 'gold', name: 'Gold' }]);
    client._setResult("UPDATE users SET", [], 1);
    client._setResult("SELECT id FROM users WHERE LOWER(email)", [{ id: 1 }]);

    const subscription = {
      id: 'sub_new',
      customer: 'cus_new_sub',
      status: 'active',
      items: { data: [{ price: { id: 'price_gold', nickname: 'Gold Plan' }, plan: { nickname: 'Gold Plan' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionCreated(client as any, subscription);
    const activationCalls = client._getCalls().filter(c => c.text.includes('UPDATE users SET'));
    expect(activationCalls.length).toBeGreaterThan(0);
  });

  it('returns early when no user and customer is deleted', async () => {
    const client = createMockClient();

    mockGetStripeClient.mockResolvedValueOnce({
      customers: {
        retrieve: vi.fn().mockResolvedValue({ id: 'cus_deleted', deleted: true }),
      },
      paymentIntents: { retrieve: vi.fn(), update: vi.fn() },
    });

    const subscription = {
      id: 'sub_no_user',
      customer: 'cus_deleted',
      status: 'active',
      items: { data: [{ price: { id: 'price_test' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionCreated(client as any, subscription);
    expect(actions.length).toBe(0);
  });
});

describe('Subscription Handlers — handleSubscriptionUpdated', () => {
  it('updates tier when price changes', async () => {
    const client = createMockClient();
    client._setResult("SELECT id, email, first_name, last_name, tier, tier_id, billing_provider, pending_tier_change", [{ id: 1, email: 'updated@test.com', first_name: 'U', last_name: 'User', tier: 'Silver', tier_id: 1, billing_provider: 'stripe', pending_tier_change: null }]);
    client._setResult("SELECT id, slug, name FROM membership_tiers", [{ id: 2, slug: 'gold', name: 'Gold' }]);
    client._setResult("UPDATE users SET", [], 1);

    const subscription = {
      id: 'sub_updated',
      customer: 'cus_updated',
      status: 'active',
      items: { data: [{ price: { id: 'price_gold' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionUpdated(client as any, subscription, undefined);
    const tierUpdateCalls = client._getCalls().filter(c => c.text.includes('UPDATE users SET'));
    expect(tierUpdateCalls.length).toBeGreaterThan(0);
  });

  it('skips for non-stripe billing provider', async () => {
    const client = createMockClient();
    client._setResult("SELECT id, email, first_name, last_name, tier, tier_id, billing_provider, pending_tier_change", [{ id: 1, email: 'mb@test.com', first_name: 'M', last_name: 'B', tier: 'Gold', tier_id: 1, billing_provider: 'mindbody', pending_tier_change: null }]);

    const subscription = {
      id: 'sub_mb_updated',
      customer: 'cus_mb',
      status: 'active',
      items: { data: [{ price: { id: 'price_gold' } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionUpdated(client as any, subscription, undefined);
    expect(actions.length).toBe(0);
  });

  it('returns early when no user found', async () => {
    const client = createMockClient();

    const subscription = {
      id: 'sub_unknown',
      customer: 'cus_unknown',
      status: 'active',
      items: { data: [] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const actions = await handleSubscriptionUpdated(client as any, subscription, undefined);
    expect(actions.length).toBe(0);
  });
});

describe('Subscription Handlers — handleTrialWillEnd', () => {
  it('notifies member and staff when trial is ending', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email, first_name, last_name', [{ id: 1, email: 'trial@test.com', first_name: 'T', last_name: 'User', display_name: 'T User', stripe_customer_id: 'cus_trial' }]);

    const subscription = {
      id: 'sub_trial',
      customer: 'cus_trial',
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 3 * 86400,
      items: { data: [] },
    } as unknown as Stripe.Subscription;

    const actions = await handleTrialWillEnd(client as any, subscription);
    expect(actions.length).toBe(2);

    await actions[0]();
    expect(mockNotifyMember).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'trial@test.com', title: 'Trial Ending Soon' }),
      expect.objectContaining({ sendPush: true })
    );

    await actions[1]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Member Trial Ending',
      expect.stringContaining('trial@test.com'),
      'trial_ending',
      expect.objectContaining({ sendPush: false })
    );
  });

  it('returns early when no customer id', async () => {
    const client = createMockClient();

    const subscription = {
      id: 'sub_no_cus',
      customer: null,
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 3 * 86400,
    } as unknown as Stripe.Subscription;

    const actions = await handleTrialWillEnd(client as any, subscription);
    expect(actions.length).toBe(0);
  });

  it('returns early when no trial_end date', async () => {
    const client = createMockClient();

    const subscription = {
      id: 'sub_no_trial',
      customer: 'cus_test',
      status: 'trialing',
      trial_end: null,
    } as unknown as Stripe.Subscription;

    const actions = await handleTrialWillEnd(client as any, subscription);
    expect(actions.length).toBe(0);
  });
});

describe('Customer Handlers — handlePaymentMethodDetached', () => {
  it('flags user for card update when no payment methods remain', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 1, email: 'detach@test.com', display_name: 'D User' }]);
    client._setResult('UPDATE users SET requires_card_update', [], 1);

    mockGetStripeClient.mockResolvedValueOnce({
      paymentMethods: {
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      paymentIntents: { retrieve: vi.fn(), update: vi.fn() },
    });

    const paymentMethod = {
      id: 'pm_detached',
      customer: 'cus_detach',
      type: 'card',
    } as unknown as Stripe.PaymentMethod;

    const actions = await handlePaymentMethodDetached(client as any, paymentMethod);
    expect(actions.length).toBeGreaterThanOrEqual(2);

    const cardUpdateFlag = client._getCalls().filter(c => c.text.includes('requires_card_update'));
    expect(cardUpdateFlag.length).toBe(1);
  });

  it('returns early when no customer on payment method', async () => {
    const client = createMockClient();

    const paymentMethod = {
      id: 'pm_orphan',
      customer: null,
      type: 'card',
    } as unknown as Stripe.PaymentMethod;

    const actions = await handlePaymentMethodDetached(client as any, paymentMethod);
    expect(actions.length).toBe(0);
  });
});

describe('Customer Handlers — handleCustomerDeleted (detailed)', () => {
  it('clears stripe billing fields and notifies staff with correct details', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, email', [{ id: 5, email: 'gone@test.com', display_name: 'Gone User' }]);
    client._setResult('UPDATE users SET stripe_customer_id = NULL', [], 1);

    const customer = {
      id: 'cus_gone',
      email: 'gone@test.com',
      name: 'Gone User',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerDeleted(client as any, customer);
    expect(actions.length).toBe(2);

    const clearBilling = client._getCalls().filter(c => c.text.includes('stripe_customer_id = NULL') && c.text.includes('billing_provider = NULL'));
    expect(clearBilling.length).toBe(1);

    await actions[0]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Stripe Customer Deleted',
      expect.stringContaining('Billing is now disconnected'),
      'billing',
      expect.objectContaining({ sendPush: true })
    );
  });

  it('returns empty actions when no user found for deleted customer', async () => {
    const client = createMockClient();

    const customer = {
      id: 'cus_unknown',
      email: 'nobody@test.com',
    } as unknown as Stripe.Customer;

    const actions = await handleCustomerDeleted(client as any, customer);
    expect(actions.length).toBe(0);
  });
});

describe('Checkout Handlers — handleCheckoutSessionExpired', () => {
  it('handles expired checkout session', async () => {
    const client = createMockClient();

    const session = {
      id: 'cs_expired',
      customer: 'cus_test',
      customer_email: 'expired@test.com',
      metadata: { purpose: 'day_pass', memberEmail: 'expired@test.com' },
    } as unknown as Stripe.Checkout.Session;

    const actions = await handleCheckoutSessionExpired(client as any, session);
    expect(actions.length).toBeGreaterThan(0);

    await actions[0]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Day Pass Checkout Expired',
      expect.stringContaining('expired@test.com'),
      'billing',
      expect.objectContaining({ sendPush: false })
    );
  });

  it('does not send day pass notification for non-day-pass expired checkout', async () => {
    const client = createMockClient();

    const session = {
      id: 'cs_expired_generic',
      customer: 'cus_test',
      customer_email: 'test@test.com',
      metadata: { purpose: 'add_funds' },
    } as unknown as Stripe.Checkout.Session;

    const actions = await handleCheckoutSessionExpired(client as any, session);
    for (const action of actions) {
      await action();
    }
    expect(mockNotifyAllStaff).not.toHaveBeenCalledWith(
      'Day Pass Checkout Expired',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });
});

describe('Deferred Action execution verification', () => {
  it('invoice payment succeeded deferred actions trigger notifications', async () => {
    const client = createMockClient();
    client._setResult('SELECT id, first_name, last_name, billing_provider', [{ id: 1, first_name: 'Jane', last_name: 'Doe', billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET', [], 1);
    client._setResult('UPDATE hubspot_deals', [], 1);
    client._setResult('SELECT name FROM membership_tiers', []);

    const invoice = {
      id: 'in_deferred_test',
      customer: 'cus_test',
      customer_email: 'deferred@test.com',
      amount_paid: 9900,
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
      subscription: 'sub_test',
      payment_intent: 'pi_test',
      lines: { data: [{ description: 'Gold Membership', period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] },
      metadata: {},
    } as unknown as any;

    const actions = await handleInvoicePaymentSucceeded(client as any, invoice);
    expect(actions.length).toBeGreaterThanOrEqual(2);

    const notificationAction = actions[actions.length - 1];
    await notificationAction();

    expect(mockNotifyMember).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'deferred@test.com', title: 'Membership Renewed' })
    );
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'Membership Renewed',
      expect.stringContaining('deferred@test.com'),
      'membership_renewed',
      expect.objectContaining({ sendPush: true })
    );
  });

  it('charge.dispute.created deferred actions notify staff with urgency details', async () => {
    const client = createMockClient();
    client._setResult('UPDATE terminal_payments', [{ id: 1, user_id: 5, user_email: 'dispute@test.com', stripe_subscription_id: 'sub_d', amount_cents: 15000 }], 1);
    client._setResult('SELECT billing_provider', [{ billing_provider: 'stripe' }]);
    client._setResult('UPDATE users SET membership_status', [], 1);
    client._setResult('INSERT INTO notifications', [], 1);

    const dispute = {
      id: 'dp_deferred',
      amount: 15000,
      charge: 'ch_d',
      payment_intent: 'pi_d',
      reason: 'product_not_received',
      status: 'needs_response',
    } as unknown as Stripe.Dispute;

    const actions = await handleChargeDisputeCreated(client as any, dispute);
    expect(actions.length).toBeGreaterThan(0);

    await actions[0]();
    expect(mockNotifyAllStaff).toHaveBeenCalledWith(
      'URGENT: Payment Dispute Received',
      expect.stringContaining('$150.00'),
      'terminal_dispute',
      expect.objectContaining({ sendPush: true })
    );
  });
});

describe('Webhook Framework — event priority edge cases', () => {
  it('uses default priority 5 for unknown event types', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'unknown.event', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'res_1', 'another.unknown', 123);
    expect(result).toBe(true);
  });

  it('allows same-priority events from same family', async () => {
    const client = createMockClient();
    client._setResult('SELECT event_type', [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }]);

    const result = await checkResourceEventOrder(client as any, 'pi_1', 'payment_intent.payment_failed', 123);
    expect(result).toBe(true);
  });
});

describe('Webhook Retry Regression — out-of-order event forces retry via throw', () => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const envLivemode = !!isProduction;

  it('processStripeWebhook throws when out-of-order event is detected, forcing Stripe retry', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    let queryCallCount = 0;
    mockClient.query.mockImplementation(async (text: string, values?: unknown[]) => {
      queryCallCount++;
      if (text === 'BEGIN') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [{ event_id: 'evt_ooo_retry' }], rowCount: 1 };
      }
      if (text.includes('SELECT event_type')) {
        return { rows: [{ event_type: 'payment_intent.succeeded', processed_at: new Date() }], rowCount: 1 };
      }
      if (text.includes('webhook_dead_letter_queue')) {
        return { rows: [], rowCount: 0 };
      }
      if (text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    mockPoolConnect.mockResolvedValueOnce(mockClient);
    const dlqClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    mockPoolConnect.mockResolvedValueOnce(dlqClient);

    const event = {
      id: 'evt_ooo_retry',
      type: 'payment_intent.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'pi_ooo_test', metadata: {} } },
      livemode: envLivemode,
    };
    const payload = Buffer.from(JSON.stringify(event));

    const mockStripe = await mockGetStripeClient();
    mockStripe.events.retrieve.mockResolvedValueOnce(event);

    await expect(processStripeWebhook(payload, 'sig_test')).rejects.toThrow('Event out of order');

    const rollbackCalls = mockClient.query.mock.calls.filter(
      (c: unknown[]) => c[0] === 'ROLLBACK'
    );
    expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('processStripeWebhook returns 200 (does not throw) for duplicate events', async () => {
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query.mockImplementation(async (text: string) => {
      if (text === 'BEGIN') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [], rowCount: 0 };
      }
      if (text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    mockPoolConnect.mockResolvedValueOnce(mockClient);

    const event = {
      id: 'evt_dup_test',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'pi_dup_test', metadata: {} } },
      livemode: envLivemode,
    };
    const payload = Buffer.from(JSON.stringify(event));

    const mockStripe = await mockGetStripeClient();
    mockStripe.events.retrieve.mockResolvedValueOnce(event);

    await expect(processStripeWebhook(payload, 'sig_test')).resolves.toBeUndefined();

    const commitCalls = mockClient.query.mock.calls.filter(
      (c: unknown[]) => c[0] === 'COMMIT'
    );
    expect(commitCalls.length).toBe(0);
  });
});

describe('Webhook deferred actions — execute only after COMMIT', () => {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const envLivemode = !!isProduction;

  it('COMMIT fires before deferred actions are scheduled via setImmediate', async () => {
    const eventSequence: string[] = [];

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query.mockImplementation(async (text: string, values?: unknown[]) => {
      if (text === 'BEGIN') return { rows: [], rowCount: 0 };
      if (text.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO webhook_processed_events')) {
        return { rows: [{ event_id: 'evt_deferred_test' }], rowCount: 1 };
      }
      if (text.includes('SELECT event_type')) {
        return { rows: [], rowCount: 0 };
      }
      if (text === 'COMMIT') {
        eventSequence.push('COMMIT');
        return { rows: [], rowCount: 0 };
      }
      if (text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    mockPoolConnect.mockResolvedValueOnce(mockClient);

    const origSetImmediate = globalThis.setImmediate;
    globalThis.setImmediate = ((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      eventSequence.push('DEFERRED_SCHEDULED');
      return origSetImmediate(fn, ...args);
    }) as unknown as typeof setImmediate;

    try {
      const event = {
        id: 'evt_deferred_test',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'pi_deferred', metadata: {} } },
        livemode: envLivemode,
      };
      const payload = Buffer.from(JSON.stringify(event));

      const mockStripe = await mockGetStripeClient();
      mockStripe.events.retrieve.mockResolvedValueOnce(event);

      await processStripeWebhook(payload, 'sig_test');

      expect(eventSequence.indexOf('COMMIT')).toBeLessThan(eventSequence.indexOf('DEFERRED_SCHEDULED'));
      expect(eventSequence[0]).toBe('COMMIT');
    } finally {
      globalThis.setImmediate = origSetImmediate;
    }
  });
});
