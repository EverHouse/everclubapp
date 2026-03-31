import { describe, it, expect } from 'vitest';
import {
  resolveIssueSchema,
  syncPushPullSchema,
  ignoreIssueSchema,
  bulkIgnoreSchema,
  placeholderDeleteSchema,
  recordIdSchema,
  userIdSchema,
  unlinkHubspotSchema,
  mergeHubspotSchema,
  mergeStripeSchema,
  changeBillingProviderSchema,
  bulkChangeBillingProviderSchema,
  linkStripeCustomerOnlySchema,
  acceptTierSchema,
  reviewItemSchema,
  assignSessionOwnerSchema,
  cancelOrphanedPiSchema,
  dryRunSchema,
  updateTourStatusSchema,
  clearStripeIdSchema,
  deleteOrphanByEmailSchema,
  reconnectStripeSubscriptionSchema,
  bulkReconnectStripeSchema,
} from '../../shared/validators/dataIntegrity';

describe('resolveIssueSchema', () => {
  it('accepts resolved action with resolution_method', () => {
    expect(resolveIssueSchema.safeParse({
      issue_key: 'ISS-1',
      action: 'resolved',
      resolution_method: 'manual fix',
    }).success).toBe(true);
  });

  it('rejects resolved action without resolution_method', () => {
    expect(resolveIssueSchema.safeParse({
      issue_key: 'ISS-1',
      action: 'resolved',
    }).success).toBe(false);
  });

  it('accepts ignored action without resolution_method', () => {
    const result = resolveIssueSchema.safeParse({
      issue_key: 'ISS-1',
      action: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('ignored');
    }
  });

  it('accepts reopened action', () => {
    expect(resolveIssueSchema.safeParse({
      issue_key: 'ISS-1',
      action: 'reopened',
    }).success).toBe(true);
  });

  it('defaults to resolved action', () => {
    const result = resolveIssueSchema.safeParse({
      issue_key: 'ISS-1',
      resolution_method: 'auto',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('resolved');
    }
  });

  it('rejects empty issue_key', () => {
    expect(resolveIssueSchema.safeParse({ issue_key: '', action: 'ignored' }).success).toBe(false);
  });
});

describe('syncPushPullSchema', () => {
  it('accepts valid hubspot sync', () => {
    expect(syncPushPullSchema.safeParse({
      issue_key: 'SYNC-1',
      target: 'hubspot',
      user_id: 'u1',
    }).success).toBe(true);
  });

  it('accepts valid stripe sync', () => {
    expect(syncPushPullSchema.safeParse({
      issue_key: 'SYNC-2',
      target: 'stripe',
      user_id: 'u2',
    }).success).toBe(true);
  });

  it('accepts camelCase field names via preprocessor', () => {
    expect(syncPushPullSchema.safeParse({
      issueKey: 'SYNC-3',
      target: 'hubspot',
      userId: 'u3',
    }).success).toBe(true);
  });

  it('converts numeric user_id to string', () => {
    const result = syncPushPullSchema.parse({
      issue_key: 'SYNC-4',
      target: 'stripe',
      user_id: 123,
    });
    expect(result.user_id).toBe('123');
  });

  it('rejects missing user_id', () => {
    expect(syncPushPullSchema.safeParse({
      issue_key: 'SYNC-5',
      target: 'hubspot',
    }).success).toBe(false);
  });

  it('rejects invalid target', () => {
    expect(syncPushPullSchema.safeParse({
      issue_key: 'SYNC-6',
      target: 'salesforce',
      user_id: 'u1',
    }).success).toBe(false);
  });
});

describe('ignoreIssueSchema', () => {
  it('accepts valid input', () => {
    expect(ignoreIssueSchema.safeParse({
      issue_key: 'ISS-1',
      duration: '24h',
      reason: 'Known false positive',
    }).success).toBe(true);
  });

  it('rejects invalid duration', () => {
    expect(ignoreIssueSchema.safeParse({
      issue_key: 'ISS-1',
      duration: '1y',
      reason: 'test',
    }).success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(ignoreIssueSchema.safeParse({
      issue_key: 'ISS-1',
      duration: '1w',
      reason: '',
    }).success).toBe(false);
  });
});

describe('bulkIgnoreSchema', () => {
  it('accepts valid bulk ignore', () => {
    expect(bulkIgnoreSchema.safeParse({
      issue_keys: ['ISS-1', 'ISS-2'],
      duration: '30d',
      reason: 'Batch cleanup',
    }).success).toBe(true);
  });

  it('rejects empty issue_keys array', () => {
    expect(bulkIgnoreSchema.safeParse({
      issue_keys: [],
      duration: '24h',
      reason: 'test',
    }).success).toBe(false);
  });

  it('rejects more than 5000 issue_keys', () => {
    const keys = Array.from({ length: 5001 }, (_, i) => `ISS-${i}`);
    expect(bulkIgnoreSchema.safeParse({
      issue_keys: keys,
      duration: '24h',
      reason: 'test',
    }).success).toBe(false);
  });
});

describe('placeholderDeleteSchema', () => {
  it('accepts stripeCustomerIds', () => {
    expect(placeholderDeleteSchema.safeParse({
      stripeCustomerIds: ['cus_1'],
    }).success).toBe(true);
  });

  it('accepts hubspotContactIds', () => {
    expect(placeholderDeleteSchema.safeParse({
      hubspotContactIds: ['h1'],
    }).success).toBe(true);
  });

  it('accepts localDatabaseUserIds', () => {
    expect(placeholderDeleteSchema.safeParse({
      localDatabaseUserIds: ['u1'],
    }).success).toBe(true);
  });

  it('rejects empty object (no arrays provided)', () => {
    expect(placeholderDeleteSchema.safeParse({}).success).toBe(false);
  });

  it('rejects all empty arrays', () => {
    expect(placeholderDeleteSchema.safeParse({
      stripeCustomerIds: [],
      hubspotContactIds: [],
      localDatabaseUserIds: [],
    }).success).toBe(false);
  });
});

describe('recordIdSchema', () => {
  it('accepts string recordId', () => {
    const result = recordIdSchema.parse({ recordId: '42' });
    expect(result.recordId).toBe('42');
  });

  it('transforms numeric recordId to string', () => {
    const result = recordIdSchema.parse({ recordId: 42 });
    expect(result.recordId).toBe('42');
  });
});

describe('userIdSchema', () => {
  it('accepts valid userId', () => {
    expect(userIdSchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });

  it('rejects empty userId', () => {
    expect(userIdSchema.safeParse({ userId: '' }).success).toBe(false);
  });
});

describe('unlinkHubspotSchema', () => {
  it('accepts valid input', () => {
    expect(unlinkHubspotSchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });

  it('accepts optional hubspotContactId', () => {
    expect(unlinkHubspotSchema.safeParse({ userId: 'u1', hubspotContactId: 'h1' }).success).toBe(true);
  });
});

describe('mergeHubspotSchema', () => {
  it('accepts valid input', () => {
    expect(mergeHubspotSchema.safeParse({
      primaryUserId: 'u1',
      secondaryUserId: 'u2',
    }).success).toBe(true);
  });

  it('rejects empty primaryUserId', () => {
    expect(mergeHubspotSchema.safeParse({
      primaryUserId: '',
      secondaryUserId: 'u2',
    }).success).toBe(false);
  });
});

describe('mergeStripeSchema', () => {
  it('accepts valid input', () => {
    expect(mergeStripeSchema.safeParse({
      email: 'a@b.com',
      keepCustomerId: 'cus_1',
      removeCustomerId: 'cus_2',
    }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(mergeStripeSchema.safeParse({
      email: 'bad',
      keepCustomerId: 'cus_1',
      removeCustomerId: 'cus_2',
    }).success).toBe(false);
  });
});

describe('changeBillingProviderSchema', () => {
  it('accepts valid provider change', () => {
    expect(changeBillingProviderSchema.safeParse({
      userId: 'u1',
      newProvider: 'stripe',
    }).success).toBe(true);
  });

  it('rejects invalid provider', () => {
    expect(changeBillingProviderSchema.safeParse({
      userId: 'u1',
      newProvider: 'paypal',
    }).success).toBe(false);
  });
});

describe('bulkChangeBillingProviderSchema', () => {
  it('accepts valid bulk change', () => {
    expect(bulkChangeBillingProviderSchema.safeParse({
      userIds: ['u1', 'u2'],
      newProvider: 'manual',
    }).success).toBe(true);
  });

  it('rejects empty userIds', () => {
    expect(bulkChangeBillingProviderSchema.safeParse({
      userIds: [],
      newProvider: 'manual',
    }).success).toBe(false);
  });

  it('rejects more than 100 userIds', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);
    expect(bulkChangeBillingProviderSchema.safeParse({
      userIds: ids,
      newProvider: 'comped',
    }).success).toBe(false);
  });

  it('rejects stripe as newProvider for bulk', () => {
    expect(bulkChangeBillingProviderSchema.safeParse({
      userIds: ['u1'],
      newProvider: 'stripe',
    }).success).toBe(false);
  });
});

describe('acceptTierSchema', () => {
  it('accepts valid input', () => {
    expect(acceptTierSchema.safeParse({
      userId: 'u1',
      acceptedTier: 'gold',
      source: 'app',
    }).success).toBe(true);
  });

  it('rejects invalid source', () => {
    expect(acceptTierSchema.safeParse({
      userId: 'u1',
      acceptedTier: 'gold',
      source: 'admin',
    }).success).toBe(false);
  });
});

describe('reviewItemSchema', () => {
  it('accepts wellness_classes table', () => {
    expect(reviewItemSchema.safeParse({
      recordId: '1',
      table: 'wellness_classes',
    }).success).toBe(true);
  });

  it('accepts events table', () => {
    expect(reviewItemSchema.safeParse({
      recordId: 2,
      table: 'events',
    }).success).toBe(true);
  });

  it('rejects invalid table', () => {
    expect(reviewItemSchema.safeParse({
      recordId: '1',
      table: 'bookings',
    }).success).toBe(false);
  });
});

describe('assignSessionOwnerSchema', () => {
  it('accepts valid input', () => {
    expect(assignSessionOwnerSchema.safeParse({
      sessionId: 1,
      ownerEmail: 'a@b.com',
    }).success).toBe(true);
  });

  it('rejects non-positive sessionId', () => {
    expect(assignSessionOwnerSchema.safeParse({
      sessionId: 0,
      ownerEmail: 'a@b.com',
    }).success).toBe(false);
  });

  it('rejects invalid ownerEmail', () => {
    expect(assignSessionOwnerSchema.safeParse({
      sessionId: 1,
      ownerEmail: 'bad',
    }).success).toBe(false);
  });
});

describe('cancelOrphanedPiSchema', () => {
  it('accepts valid pi_ prefixed id', () => {
    expect(cancelOrphanedPiSchema.safeParse({ paymentIntentId: 'pi_abc123' }).success).toBe(true);
  });

  it('rejects id without pi_ prefix', () => {
    expect(cancelOrphanedPiSchema.safeParse({ paymentIntentId: 'abc123' }).success).toBe(false);
  });
});

describe('dryRunSchema', () => {
  it('defaults dryRun to true', () => {
    const result = dryRunSchema.parse({});
    expect(result.dryRun).toBe(true);
  });

  it('accepts explicit false', () => {
    const result = dryRunSchema.parse({ dryRun: false });
    expect(result.dryRun).toBe(false);
  });
});

describe('updateTourStatusSchema', () => {
  it('accepts valid status', () => {
    for (const status of ['completed', 'no_show', 'cancelled'] as const) {
      expect(updateTourStatusSchema.safeParse({
        recordId: '1',
        newStatus: status,
      }).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(updateTourStatusSchema.safeParse({
      recordId: '1',
      newStatus: 'pending',
    }).success).toBe(false);
  });
});

describe('clearStripeIdSchema', () => {
  it('accepts valid userId', () => {
    expect(clearStripeIdSchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });

  it('rejects empty userId', () => {
    expect(clearStripeIdSchema.safeParse({ userId: '' }).success).toBe(false);
  });
});

describe('deleteOrphanByEmailSchema', () => {
  it('accepts valid table and email', () => {
    expect(deleteOrphanByEmailSchema.safeParse({
      table: 'notifications',
      email: 'TEST@Example.com',
    }).success).toBe(true);
  });

  it('transforms email to lowercase trimmed', () => {
    const result = deleteOrphanByEmailSchema.parse({
      table: 'push_subscriptions',
      email: ' A@B.COM ',
    });
    expect(result.email).toBe('a@b.com');
  });

  it('rejects invalid table', () => {
    expect(deleteOrphanByEmailSchema.safeParse({
      table: 'users',
      email: 'a@b.com',
    }).success).toBe(false);
  });

  it('rejects empty email', () => {
    expect(deleteOrphanByEmailSchema.safeParse({
      table: 'notifications',
      email: '',
    }).success).toBe(false);
  });
});

describe('linkStripeCustomerOnlySchema', () => {
  it('accepts valid userId', () => {
    expect(linkStripeCustomerOnlySchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });

  it('rejects empty userId', () => {
    expect(linkStripeCustomerOnlySchema.safeParse({ userId: '' }).success).toBe(false);
  });
});

describe('reconnectStripeSubscriptionSchema', () => {
  it('accepts valid userId', () => {
    expect(reconnectStripeSubscriptionSchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });

  it('rejects empty userId', () => {
    expect(reconnectStripeSubscriptionSchema.safeParse({ userId: '' }).success).toBe(false);
  });
});

describe('bulkReconnectStripeSchema', () => {
  it('accepts valid userIds', () => {
    expect(bulkReconnectStripeSchema.safeParse({ userIds: ['u1', 'u2'] }).success).toBe(true);
  });

  it('rejects empty userIds', () => {
    expect(bulkReconnectStripeSchema.safeParse({ userIds: [] }).success).toBe(false);
  });

  it('rejects more than 100 userIds', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);
    expect(bulkReconnectStripeSchema.safeParse({ userIds: ids }).success).toBe(false);
  });
});
