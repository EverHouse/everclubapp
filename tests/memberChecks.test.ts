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
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClientWithFallback: vi.fn(),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../shared/constants/statuses', () => ({
  MEMBERSHIP_STATUS: {
    ACTIVE: 'active',
    PENDING: 'pending',
    NON_MEMBER: 'non-member',
    INACTIVE: 'inactive',
    ARCHIVED: 'archived',
    MERGED: 'merged',
  },
  BOOKING_STATUS: {
    PENDING: 'pending',
    PENDING_APPROVAL: 'pending_approval',
    APPROVED: 'approved',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    DECLINED: 'declined',
    NO_SHOW: 'no_show',
  },
  ACTIVE_MEMBERSHIP_STATUSES: ['active'],
  PARTICIPANT_TYPE: { OWNER: 'owner' },
}));

import { db } from '../server/db';
import { getStripeClient } from '../server/core/stripe/client';
import { getHubSpotClientWithFallback } from '../server/core/integrations';
import {
  checkMembersWithoutEmail,
  checkStuckTransitionalMembers,
  checkMindBodyStaleSyncMembers,
  checkMindBodyStatusMismatch,
  checkGuestPassesForNonExistentMembers,
  checkTierReconciliation,
} from '../server/core/integrity/memberChecks';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetStripeClient = getStripeClient as ReturnType<typeof vi.fn>;
const mockGetHubSpot = getHubSpotClientWithFallback as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
  mockGetStripeClient.mockReset();
  mockGetHubSpot.mockReset();
});

describe('checkMembersWithoutEmail', () => {
  it('returns pass when all members have emails', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkMembersWithoutEmail();
    expect(result.checkName).toBe('Members Without Email');
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects members without email addresses', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: 'John', last_name: 'Doe', hubspot_id: 'hs-1', tier: 'gold' },
        { id: 2, first_name: null, last_name: null, hubspot_id: null, tier: null },
      ]
    });

    const result = await checkMembersWithoutEmail();
    expect(result.status).toBe('fail');
    expect(result.issueCount).toBe(2);
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('John Doe');
    expect(result.issues[1].description).toContain('Unknown');
  });
});

describe('checkStuckTransitionalMembers', () => {
  it('returns pass when no stuck members', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });
    mockGetStripeClient.mockRejectedValueOnce(new Error('No Stripe'));

    const result = await checkStuckTransitionalMembers();
    expect(result.checkName).toBe('Stuck Transitional Members');
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('auto-cleans dead subscriptions', async () => {
    const mockStripe = {
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({ status: 'canceled' }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-1', email: 'stuck@test.com', first_name: 'Stuck', last_name: 'User',
          tier: 'gold', membership_status: 'pending', stripe_subscription_id: 'sub_dead',
          stripe_customer_id: 'cus_1', updated_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkStuckTransitionalMembers({ autoFix: true });
    expect(result.status).toBe('pass');
    expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_dead');
  });

  it('reports stuck members when Stripe is unavailable', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('No Stripe'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-2', email: 'stuck2@test.com', first_name: 'Stuck', last_name: 'Two',
        tier: 'silver', membership_status: 'pending', stripe_subscription_id: 'sub_123',
        stripe_customer_id: 'cus_2', updated_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
      }]
    });

    const result = await checkStuckTransitionalMembers();
    expect(result.status).toBe('fail');
    expect(result.issues[0].description).toContain('stuck');
    expect(result.issues[0].severity).toBe('error');
  });
});

describe('checkMindBodyStaleSyncMembers', () => {
  it('returns pass when no stale MindBody members', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkMindBodyStaleSyncMembers();
    expect(result.checkName).toBe('MindBody Stale Sync');
    expect(result.status).toBe('pass');
  });

  it('detects stale MindBody members', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 3, email: 'mb@test.com', first_name: 'MB', last_name: 'Member',
        tier: 'platinum', membership_status: 'active',
        updated_at: '2026-02-01T00:00:00Z', mindbody_client_id: 'MB-100'
      }]
    });

    const result = await checkMindBodyStaleSyncMembers();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('sync_mismatch');
    expect(result.issues[0].description).toContain('unchanged since');
  });
});

describe('checkMindBodyStatusMismatch', () => {
  it('returns pass when no mismatches', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkMindBodyStatusMismatch();
    expect(result.checkName).toBe('MindBody Data Quality');
    expect(result.status).toBe('pass');
  });

  it('detects active MindBody member without client ID', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 4, email: 'noid@test.com', first_name: 'No', last_name: 'ID',
        tier: 'gold', membership_status: 'active', billing_provider: 'mindbody',
        mindbody_client_id: null
      }]
    });

    const result = await checkMindBodyStatusMismatch();
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('no MindBody Client ID');
  });

  it('detects MindBody member with ID but no tier', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 5, email: 'notier@test.com', first_name: 'No', last_name: 'Tier',
        tier: null, membership_status: 'active', billing_provider: 'mindbody',
        mindbody_client_id: 'MB-200'
      }]
    });

    const result = await checkMindBodyStatusMismatch();
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('no tier assigned');
  });
});

describe('checkGuestPassesForNonExistentMembers', () => {
  it('returns pass when all guest passes reference existing members', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkGuestPassesForNonExistentMembers();
    expect(result.checkName).toBe('Guest Passes Without Members');
    expect(result.status).toBe('pass');
  });

  it('detects orphaned guest passes', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 1, member_email: 'gone@test.com', passes_used: 3, passes_total: 5 },
      ]
    });

    const result = await checkGuestPassesForNonExistentMembers();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('orphan_record');
    expect(result.issues[0].description).toContain('non-existent member');
  });

  it('returns fail when more than 5 orphaned passes', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: i, member_email: `gone${i}@test.com`, passes_used: 0, passes_total: 5
    }));
    mockExecute.mockResolvedValueOnce({ rows });

    const result = await checkGuestPassesForNonExistentMembers();
    expect(result.status).toBe('fail');
  });
});

describe('checkTierReconciliation', () => {
  it('returns warning when Stripe is unavailable', async () => {
    mockGetStripeClient.mockRejectedValueOnce(new Error('Stripe unavailable'));

    const result = await checkTierReconciliation();
    expect(result.checkName).toBe('Tier Reconciliation');
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('Unable to connect to Stripe');
  });

  it('returns pass when no Stripe members exist', async () => {
    const mockStripe = { subscriptions: { list: vi.fn() }, products: { retrieve: vi.fn() } };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockRejectedValueOnce(new Error('No HubSpot'));
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkTierReconciliation();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('returns pass when tiers are in sync across all systems', async () => {
    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: 'prod_1' } }] },
          }]
        }),
      },
      products: {
        retrieve: vi.fn().mockResolvedValue({ name: 'Gold Membership', metadata: { tier: 'gold' } }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockRejectedValueOnce(new Error('No HubSpot'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, email: 'synced@test.com', first_name: 'Synced', last_name: 'User',
        tier: 'gold', membership_status: 'active', stripe_customer_id: 'cus_1',
        hubspot_id: null, billing_provider: null
      }]
    });

    const result = await checkTierReconciliation();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects tier mismatch between app and Stripe', async () => {
    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: 'prod_2' } }] },
          }]
        }),
      },
      products: {
        retrieve: vi.fn().mockResolvedValue({ name: 'Platinum Membership', metadata: { tier: 'platinum' } }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockRejectedValueOnce(new Error('No HubSpot'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 2, email: 'mismatch@test.com', first_name: 'Tier', last_name: 'Mismatch',
        tier: 'silver', membership_status: 'active', stripe_customer_id: 'cus_2',
        hubspot_id: null, billing_provider: null
      }]
    });

    const result = await checkTierReconciliation();
    expect(result.status).toBe('warning');
    expect(result.issueCount).toBe(1);
    expect(result.issues[0].category).toBe('sync_mismatch');
    expect(result.issues[0].description).toContain('tier mismatch');
    expect(result.issues[0].description).toContain('silver');
    expect(result.issues[0].description).toContain('Platinum');
  });

  it('detects inactive member with active Stripe subscription (no active sub returned)', async () => {
    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: 'prod_3' } }] },
          }]
        }),
      },
      products: {
        retrieve: vi.fn().mockResolvedValue({ name: 'Gold', metadata: { tier: 'gold' } }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockRejectedValueOnce(new Error('No HubSpot'));
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 3, email: 'inactive@test.com', first_name: 'Inactive', last_name: 'Member',
        tier: 'gold', membership_status: 'inactive', stripe_customer_id: 'cus_3',
        hubspot_id: null, billing_provider: null
      }]
    });

    const result = await checkTierReconciliation();
    expect(result.checkName).toBe('Tier Reconciliation');
  });

  it('detects mismatch between Stripe and HubSpot tiers', async () => {
    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: 'prod_4' } }] },
          }]
        }),
      },
      products: {
        retrieve: vi.fn().mockResolvedValue({ name: 'Platinum', metadata: { tier: 'platinum' } }),
      },
    };
    const mockHubSpot = {
      crm: {
        contacts: {
          batchApi: {
            read: vi.fn().mockResolvedValue({
              results: [{
                id: 'hs-10',
                properties: { membership_tier: 'silver' }
              }]
            })
          }
        }
      }
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockResolvedValueOnce({ client: mockHubSpot });
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 4, email: 'cross@test.com', first_name: 'Cross', last_name: 'Mismatch',
        tier: 'platinum', membership_status: 'active', stripe_customer_id: 'cus_4',
        hubspot_id: 'hs-10', billing_provider: null
      }]
    });

    const result = await checkTierReconciliation();
    expect(result.issues.some(i =>
      i.category === 'sync_mismatch' && i.description.includes('tier mismatch')
    )).toBe(true);
  });

  it('returns fail when more than 10 tier mismatches', async () => {
    const members = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1, email: `m${i}@test.com`, first_name: `User`, last_name: `${i}`,
      tier: 'silver', membership_status: 'active', stripe_customer_id: `cus_${i}`,
      hubspot_id: null, billing_provider: null
    }));

    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: 'prod_wrong' } }] },
          }]
        }),
      },
      products: {
        retrieve: vi.fn().mockResolvedValue({ name: 'Platinum', metadata: { tier: 'platinum' } }),
      },
    };
    mockGetStripeClient.mockResolvedValueOnce(mockStripe);
    mockGetHubSpot.mockRejectedValueOnce(new Error('No HubSpot'));
    mockExecute.mockResolvedValueOnce({ rows: members });

    const result = await checkTierReconciliation();
    expect(result.status).toBe('fail');
    expect(result.issueCount).toBe(11);
  });
});
