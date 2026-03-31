// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((..._args: unknown[]) => 'mock-sql'), { join: vi.fn() }),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => String(e)),
  getErrorCode: vi.fn(() => null),
  isStripeError: vi.fn((e: unknown) => !!(e && typeof e === 'object' && 'type' in e)),
  isStripeResourceMissing: vi.fn((e: unknown) => !!(e && typeof e === 'object' && 'code' in e && (e as Record<string, string>).code === 'resource_missing')),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn(),
}));

import { db } from '../server/db';
import { getStripeClient } from '../server/core/stripe/client';
import {
  checkStripeSubscriptionSync,
  checkDuplicateStripeCustomers,
  checkOrphanedPaymentIntents,
  checkBillingProviderHybridState,
} from '../server/core/integrity/stripeChecks';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetStripeClient = getStripeClient as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
  mockGetStripeClient.mockReset();
});

describe('checkStripeSubscriptionSync', () => {
  it('returns warning when Stripe is unavailable', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('Stripe unavailable'));

    const result = await checkStripeSubscriptionSync();
    expect(result.checkName).toBe('Stripe Subscription Sync');
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('Unable to connect to Stripe');
  });

  it('returns pass when no Stripe members exist', async () => {
    const mockStripe = { subscriptions: { list: vi.fn() } };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkStripeSubscriptionSync();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects active DB member with no Stripe subscription', async () => {
    const mockStripe = {
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, email: 'nosub@test.com', first_name: 'No', last_name: 'Sub',
        tier: 'gold', membership_status: 'active', stripe_customer_id: 'cus_1',
        billing_provider: null
      }]
    });

    const result = await checkStripeSubscriptionSync();
    expect(result.issues.some(i => i.description.includes('no Stripe subscription'))).toBe(true);
  });

  it('detects status mismatch between DB and Stripe', async () => {
    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'canceled',
            items: { data: [{ price: { product: { name: 'Gold', metadata: { tier: 'gold' } } } }] },
          }]
        }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 2, email: 'mismatch@test.com', first_name: 'Mis', last_name: 'Match',
        tier: 'gold', membership_status: 'active', stripe_customer_id: 'cus_2',
        billing_provider: null
      }]
    });

    const result = await checkStripeSubscriptionSync();
    expect(result.status).toBe('fail');
    expect(result.issueCount).toBeGreaterThan(0);
    const mismatchIssue = result.issues.find(i =>
      i.category === 'sync_mismatch' && i.description.includes('status mismatch')
    );
    expect(mismatchIssue).toBeTruthy();
    expect(mismatchIssue!.severity).toBe('error');
    expect(mismatchIssue!.description).toContain('active');
    expect(mismatchIssue!.description).toContain('canceled');
  });

  it('detects orphaned Stripe customer ID', async () => {
    const stripeError = { type: 'StripeInvalidRequestError', code: 'resource_missing', message: 'No such customer' };
    const mockStripe = {
      subscriptions: { list: vi.fn().mockRejectedValue(stripeError) },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 3, email: 'orphan@test.com', first_name: 'Orphan', last_name: 'Customer',
        tier: 'silver', membership_status: 'active', stripe_customer_id: 'cus_gone',
        billing_provider: null
      }]
    });

    const result = await checkStripeSubscriptionSync();
    expect(result.issues.some(i =>
      i.description.includes('orphaned Stripe customer ID')
    )).toBe(true);
  });
});

describe('checkDuplicateStripeCustomers', () => {
  it('returns pass when no duplicates', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDuplicateStripeCustomers();
    expect(result.checkName).toBe('Duplicate Stripe Customers');
    expect(result.status).toBe('pass');
  });

  it('detects duplicate Stripe customers', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          normalized_email: 'dup@test.com', customer_count: 2,
          customer_ids: ['cus_1', 'cus_2'], member_emails: ['dup@test.com']
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDuplicateStripeCustomers();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].description).toContain('2 different Stripe customers');
  });

  it('detects shared customers with more than 2 emails', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: 'cus_shared', user_count: 3,
          emails: ['a@test.com', 'b@test.com', 'c@test.com']
        }]
      });

    const result = await checkDuplicateStripeCustomers();
    expect(result.issues.some(i => i.description.includes('shared by 3 members'))).toBe(true);
  });

  it('ignores shared customers with 2 or fewer emails', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: 'cus_pair', user_count: 2,
          emails: ['a@test.com', 'b@test.com']
        }]
      });

    const result = await checkDuplicateStripeCustomers();
    expect(result.status).toBe('pass');
  });
});

describe('checkOrphanedPaymentIntents', () => {
  it('returns pass when no orphaned payment intents', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkOrphanedPaymentIntents();
    expect(result.checkName).toBe('Orphaned Payment Intents');
    expect(result.status).toBe('pass');
  });

  it('detects orphaned payment intents for cancelled bookings', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, booking_id: 100, stripe_payment_intent_id: 'pi_orphan',
        total_cents: 5000, status: 'pending', created_at: '2026-03-25'
      }]
    });

    const result = await checkOrphanedPaymentIntents();
    expect(result.status).toBe('fail');
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('pi_orphan');
  });
});

describe('checkBillingProviderHybridState', () => {
  it('returns pass when no hybrid state issues', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('No Stripe'));
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkBillingProviderHybridState();
    expect(result.checkName).toBe('Billing Provider Hybrid State');
    expect(result.status).toBe('pass');
  });

  it('detects mindbody member with Stripe subscription', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('No Stripe'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 10, email: 'hybrid@test.com', first_name: 'Hybrid', last_name: 'User',
        tier: 'gold', membership_status: 'active', billing_provider: 'mindbody',
        stripe_subscription_id: 'sub_123', stripe_customer_id: 'cus_1', mindbody_client_id: 'MB-1'
      }]
    });

    const result = await checkBillingProviderHybridState();
    expect(result.issues.some(i =>
      i.description.includes("billing_provider='mindbody'") && i.description.includes('Stripe subscription')
    )).toBe(true);
    expect(result.issues[0].severity).toBe('error');
  });

  it('detects active member with no billing provider', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('No Stripe'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 11, email: 'nobill@test.com', first_name: 'No', last_name: 'Bill',
        tier: 'silver', membership_status: 'active', billing_provider: null,
        stripe_subscription_id: null, stripe_customer_id: null, mindbody_client_id: null
      }]
    });

    const result = await checkBillingProviderHybridState();
    expect(result.issues.some(i =>
      i.description.includes('no billing provider set')
    )).toBe(true);
  });
});
