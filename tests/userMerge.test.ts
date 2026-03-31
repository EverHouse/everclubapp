// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDbExecute = vi.fn();
const mockTransaction = vi.fn();
const mockSelectChain = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockSelectChain,
      }),
    }),
    execute: mockDbExecute,
    transaction: mockTransaction,
  },
}));

vi.mock('../../shared/schema', () => ({
  users: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { join: vi.fn(), raw: vi.fn((s: string) => s) }
  ),
}));

vi.mock('../server/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../server/core/utils/emailNormalization', () => ({
  normalizeEmail: (email: string) => email.toLowerCase().trim(),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn().mockResolvedValue({
    customers: { update: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    apiRequest: vi.fn().mockResolvedValue({ status: 200 }),
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toTextArrayLiteral: (arr: string[]) => `{${arr.join(',')}}`,
}));

function makePrimaryUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'primary-uuid-1234',
    email: 'primary@example.com',
    firstName: 'Primary',
    lastName: 'User',
    tier: 'gold',
    tierId: 2,
    membershipStatus: 'active',
    lifetimeVisits: 20,
    joinDate: new Date('2023-01-01'),
    stripeCustomerId: 'cus_primary',
    stripeSubscriptionId: 'sub_primary',
    hubspotId: 'hs_primary',
    mindbodyClientId: null,
    phone: '555-1111',
    tags: [],
    waiverSignedAt: new Date('2024-01-01'),
    waiverVersion: 'v2',
    ...overrides,
  };
}

function makeSecondaryUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'secondary-uuid-5678',
    email: 'secondary@example.com',
    firstName: 'Secondary',
    lastName: 'User',
    tier: 'silver',
    tierId: 1,
    membershipStatus: 'cancelled',
    lifetimeVisits: 5,
    joinDate: new Date('2024-06-01'),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    hubspotId: null,
    mindbodyClientId: null,
    phone: '555-2222',
    tags: [],
    waiverSignedAt: null,
    waiverVersion: null,
    ...overrides,
  };
}

function makeCountResult(count: number) {
  return { rows: [{ count: String(count) }] };
}

describe('userMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('previewMerge', () => {
    it('throws when primary user not found', async () => {
      mockSelectChain
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeSecondaryUser()]);
      const { previewMerge } = await import('../server/core/userMerge');
      await expect(previewMerge('nonexistent', 'secondary-uuid-5678')).rejects.toThrow('Primary user not found');
    });

    it('throws when secondary user not found', async () => {
      mockSelectChain
        .mockResolvedValueOnce([makePrimaryUser()])
        .mockResolvedValueOnce([]);
      const { previewMerge } = await import('../server/core/userMerge');
      await expect(previewMerge('primary-uuid-1234', 'nonexistent')).rejects.toThrow('Secondary user not found');
    });

    it('throws when trying to merge a user with themselves', async () => {
      const user = makePrimaryUser();
      mockSelectChain
        .mockResolvedValueOnce([user])
        .mockResolvedValueOnce([user]);
      const { previewMerge } = await import('../server/core/userMerge');
      await expect(previewMerge('primary-uuid-1234', 'primary-uuid-1234')).rejects.toThrow('Cannot merge a user with themselves');
    });

    it('detects Stripe customer conflicts', async () => {
      const primary = makePrimaryUser({ stripeCustomerId: 'cus_A' });
      const secondary = makeSecondaryUser({ stripeCustomerId: 'cus_B' });

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockDbExecute.mockResolvedValue(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.conflicts).toContainEqual(expect.stringContaining('Stripe customers'));
    });

    it('detects subscription conflicts', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: 'sub_A' });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: 'sub_B' });

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockDbExecute.mockResolvedValue(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.conflicts).toContainEqual(expect.stringContaining('subscriptions'));
    });

    it('recommends swapping when secondary is active and primary is not', async () => {
      const primary = makePrimaryUser({ membershipStatus: 'cancelled' });
      const secondary = makeSecondaryUser({ membershipStatus: 'active' });

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockDbExecute.mockResolvedValue(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.recommendations).toContainEqual(expect.stringContaining('swapping'));
    });

    it('detects different HubSpot contact IDs', async () => {
      const primary = makePrimaryUser({ hubspotId: 'hs_111' });
      const secondary = makeSecondaryUser({ hubspotId: 'hs_222' });

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockDbExecute.mockResolvedValue(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.conflicts).toContainEqual(expect.stringContaining('HubSpot'));
    });

    it('returns correct record counts', async () => {
      mockSelectChain
        .mockResolvedValueOnce([makePrimaryUser()])
        .mockResolvedValueOnce([makeSecondaryUser()]);

      mockDbExecute
        .mockResolvedValueOnce(makeCountResult(3))
        .mockResolvedValueOnce(makeCountResult(1))
        .mockResolvedValueOnce(makeCountResult(2))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(5))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0))
        .mockResolvedValueOnce(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.recordsToMerge.bookings).toBe(3);
      expect(preview.recordsToMerge.visits).toBe(1);
      expect(preview.recordsToMerge.wellnessBookings).toBe(2);
      expect(preview.recordsToMerge.notifications).toBe(5);
      expect(preview.primaryUser.email).toBe('primary@example.com');
      expect(preview.secondaryUser.email).toBe('secondary@example.com');
    });

    it('returns no conflicts when users have no overlapping external IDs', async () => {
      const primary = makePrimaryUser({ stripeCustomerId: 'cus_A', stripeSubscriptionId: null, hubspotId: null });
      const secondary = makeSecondaryUser({ stripeCustomerId: null, stripeSubscriptionId: null, hubspotId: null });

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockDbExecute.mockResolvedValue(makeCountResult(0));

      const { previewMerge } = await import('../server/core/userMerge');
      const preview = await previewMerge('primary-uuid-1234', 'secondary-uuid-5678');

      expect(preview.conflicts).toHaveLength(0);
    });
  });

  describe('executeMerge', () => {
    it('throws when both users have active subscriptions', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: 'sub_A' });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: 'sub_B' });

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      const { executeMerge } = await import('../server/core/userMerge');

      await expect(executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com'))
        .rejects.toThrow('Both users have active Stripe subscriptions');
    });

    it('throws when primary user not found', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeSecondaryUser()]);

      const { executeMerge } = await import('../server/core/userMerge');
      await expect(executeMerge('nonexistent', 'secondary-uuid-5678', 'admin@club.com'))
        .rejects.toThrow('Primary user not found');
    });

    it('throws when trying to merge user with themselves', async () => {
      const user = makePrimaryUser();
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([user])
        .mockResolvedValueOnce([user]);

      const { executeMerge } = await import('../server/core/userMerge');
      await expect(executeMerge('primary-uuid-1234', 'primary-uuid-1234', 'admin@club.com'))
        .rejects.toThrow('Cannot merge a user with themselves');
    });

    it('throws when advisory lock cannot be acquired', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ acquired: false }] });

      const { executeMerge } = await import('../server/core/userMerge');
      await expect(executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com'))
        .rejects.toThrow('merge involving one of these users is already in progress');
    });

    it('throws when secondary user has active session', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: null });
      const secondary = makeSecondaryUser();

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({
          rows: [{ session_id: 99, session_date: '2025-03-31', start_time: '10:00' }],
        })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      const { executeMerge } = await import('../server/core/userMerge');
      await expect(executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com'))
        .rejects.toThrow('active session');
    });

    it('successfully merges users without subscriptions', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const mockTxExecute = vi.fn();

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockTxExecute.mockResolvedValue({ rowCount: 0, rows: [{ count: '0' }] });

      mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
        await fn({ execute: mockTxExecute });
      });

      const { executeMerge } = await import('../server/core/userMerge');
      const result = await executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com');

      expect(result.success).toBe(true);
      expect(result.primaryUserId).toBe('primary-uuid-1234');
      expect(result.secondaryUserId).toBe('secondary-uuid-5678');
      expect(result.secondaryArchived).toBe(true);
      expect(result.mergedLifetimeVisits).toBe(25);
    });

    it('executes booking ownership transfer SQL within transaction', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const mockTxExecute = vi.fn();
      const txCalls: string[] = [];

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockTxExecute.mockImplementation(async (query: { strings?: readonly string[] }) => {
        if (query.strings) {
          const sql = Array.from(query.strings).join('?');
          txCalls.push(sql);
        }
        return { rowCount: 2, rows: [{ count: '0' }] };
      });

      mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
        await fn({ execute: mockTxExecute });
      });

      const { executeMerge } = await import('../server/core/userMerge');
      const result = await executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com');

      expect(result.success).toBe(true);

      const bookingTransferCalls = txCalls.filter(s => s.includes('booking_requests'));
      expect(bookingTransferCalls.length).toBeGreaterThanOrEqual(1);

      const participantTransferCalls = txCalls.filter(s => s.includes('booking_participants'));
      expect(participantTransferCalls.length).toBeGreaterThanOrEqual(1);

      const archiveCalls = txCalls.filter(s => s.includes('archived_at'));
      expect(archiveCalls.length).toBeGreaterThanOrEqual(1);

      expect(result.recordsMerged.bookings).toBe(2);
    });

    it('transfers external IDs from secondary when primary has none', async () => {
      const primary = makePrimaryUser({
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        hubspotId: null,
      });
      const secondary = makeSecondaryUser({
        stripeCustomerId: 'cus_secondary',
        stripeSubscriptionId: null,
        hubspotId: 'hs_secondary',
      });
      const mockTxExecute = vi.fn();
      const txCalls: string[] = [];

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockTxExecute.mockImplementation(async (query: { strings?: readonly string[] }) => {
        if (query.strings) {
          txCalls.push(Array.from(query.strings).join('?'));
        }
        return { rowCount: 0, rows: [{ count: '0' }] };
      });

      mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
        await fn({ execute: mockTxExecute });
      });

      const { executeMerge } = await import('../server/core/userMerge');
      const result = await executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com');

      expect(result.success).toBe(true);

      const stripeTransferCalls = txCalls.filter(s => s.includes('stripe_customer_id'));
      expect(stripeTransferCalls.length).toBeGreaterThanOrEqual(1);

      const hubspotTransferCalls = txCalls.filter(s => s.includes('hubspot_id'));
      expect(hubspotTransferCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates overlapping booking participants during merge', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const mockTxExecute = vi.fn();
      const txCalls: string[] = [];

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      mockTxExecute.mockImplementation(async (query: { strings?: readonly string[] }) => {
        if (query.strings) {
          txCalls.push(Array.from(query.strings).join('?'));
        }
        return { rowCount: 1, rows: [{ count: '0' }] };
      });

      mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
        await fn({ execute: mockTxExecute });
      });

      const { executeMerge } = await import('../server/core/userMerge');
      const result = await executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com');

      expect(result.success).toBe(true);

      const deleteDupCalls = txCalls.filter(s =>
        s.includes('DELETE FROM booking_participants') && s.includes('session_id IN')
      );
      expect(deleteDupCalls.length).toBe(1);

      const updateParticipantCalls = txCalls.filter(s =>
        s.includes('UPDATE booking_participants') && s.includes('user_id')
      );
      expect(updateParticipantCalls.length).toBe(1);
    });

    it('verifies mock intercepts actual DB module (not real DB)', async () => {
      const primary = makePrimaryUser({ stripeSubscriptionId: null, hubspotId: null });
      const secondary = makeSecondaryUser({ stripeSubscriptionId: null, hubspotId: null });

      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue(undefined);

      mockSelectChain
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([secondary]);

      const mockTxExecute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [{ count: '0' }] });
      mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
        await fn({ execute: mockTxExecute });
      });

      const { executeMerge } = await import('../server/core/userMerge');
      await executeMerge('primary-uuid-1234', 'secondary-uuid-5678', 'admin@club.com');

      expect(mockDbExecute).toHaveBeenCalled();
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockTxExecute).toHaveBeenCalled();
    });
  });

  describe('findPotentialDuplicates', () => {
    it('returns empty array when user not found', async () => {
      mockSelectChain.mockResolvedValueOnce([]);
      const { findPotentialDuplicates } = await import('../server/core/userMerge');
      const result = await findPotentialDuplicates('nonexistent');
      expect(result).toEqual([]);
    });

    it('finds duplicates by name', async () => {
      mockSelectChain.mockResolvedValueOnce([makePrimaryUser()]);
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'dup-1',
          email: 'dup@example.com',
          first_name: 'Primary',
          last_name: 'User',
          tier: 'gold',
          membership_status: 'active',
        }],
      });
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      mockDbExecute.mockResolvedValueOnce({ rows: [] });

      const { findPotentialDuplicates } = await import('../server/core/userMerge');
      const result = await findPotentialDuplicates('primary-uuid-1234');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].matchReason).toBe('Same name');
    });

    it('finds duplicates by phone', async () => {
      mockSelectChain.mockResolvedValueOnce([makePrimaryUser()]);
      mockDbExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'phone-dup',
            email: 'phone@example.com',
            first_name: 'Phone',
            last_name: 'Match',
            tier: null,
            membership_status: 'active',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const { findPotentialDuplicates } = await import('../server/core/userMerge');
      const result = await findPotentialDuplicates('primary-uuid-1234');

      expect(result.some(d => d.matchReason === 'Same phone number')).toBe(true);
    });
  });

  describe('consolidateStripeCustomers', () => {
    it('throws when primary user lacks Stripe customer ID', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: null, stripe_subscription_id: null, email: 'a@b.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_x', stripe_subscription_id: null, email: 'c@d.com' }] });

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      await expect(consolidateStripeCustomers('uid-1', 'uid-2'))
        .rejects.toThrow('Both users must have Stripe customer IDs');
    });

    it('throws when secondary user lacks Stripe customer ID', async () => {
      mockDbExecute.mockReset();
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_y', stripe_subscription_id: null, email: 'a@b.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: null, stripe_subscription_id: null, email: 'c@d.com' }] });

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      await expect(consolidateStripeCustomers('uid-1', 'uid-2'))
        .rejects.toThrow('Both users must have Stripe customer IDs');
    });

    it('keeps secondary customer when secondary has active subscription', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_primary', stripe_subscription_id: null, email: 'primary@a.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_secondary', stripe_subscription_id: 'sub_active', email: 'secondary@a.com' }] })
        .mockResolvedValue(undefined);

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      const result = await consolidateStripeCustomers('uid-1', 'uid-2');

      expect(result.keptCustomerId).toBe('cus_secondary');
      expect(result.orphanedCustomerId).toBe('cus_primary');
      expect(result.reason).toBe('secondary_has_active_subscription');
    });

    it('keeps primary customer when primary has active subscription', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_primary', stripe_subscription_id: 'sub_active', email: 'primary@a.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_secondary', stripe_subscription_id: null, email: 'secondary@a.com' }] })
        .mockResolvedValue(undefined);

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      const result = await consolidateStripeCustomers('uid-1', 'uid-2');

      expect(result.keptCustomerId).toBe('cus_primary');
      expect(result.orphanedCustomerId).toBe('cus_secondary');
      expect(result.reason).toBe('primary_has_active_subscription');
    });

    it('keeps primary by default when neither has subscription', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_primary', stripe_subscription_id: null, email: 'primary@a.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_secondary', stripe_subscription_id: null, email: 'secondary@a.com' }] })
        .mockResolvedValue(undefined);

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      const result = await consolidateStripeCustomers('uid-1', 'uid-2');

      expect(result.keptCustomerId).toBe('cus_primary');
      expect(result.reason).toBe('neither_has_subscription_kept_primary');
    });

    it('keeps primary when both have subscriptions', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_primary', stripe_subscription_id: 'sub_a', email: 'primary@a.com' }] })
        .mockResolvedValueOnce({ rows: [{ stripe_customer_id: 'cus_secondary', stripe_subscription_id: 'sub_b', email: 'secondary@a.com' }] })
        .mockResolvedValue(undefined);

      const { consolidateStripeCustomers } = await import('../server/core/userMerge');
      const result = await consolidateStripeCustomers('uid-1', 'uid-2');

      expect(result.keptCustomerId).toBe('cus_primary');
      expect(result.reason).toBe('both_have_subscriptions_kept_primary');
    });
  });
});
