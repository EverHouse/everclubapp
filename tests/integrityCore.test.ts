// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => [{ id: 1 }]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(() => [{ id: 1 }]) })) })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []), orderBy: vi.fn(() => ({ limit: vi.fn(() => []) })) })), orderBy: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((..._args: unknown[]) => 'mock-sql'), { join: vi.fn() }),
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  gte: vi.fn(),
  desc: vi.fn(),
  isNull: vi.fn(),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
  getErrorStatusCode: vi.fn(() => null),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/core/dataAlerts', () => ({
  alertOnCriticalIntegrityIssues: vi.fn(),
  alertOnHighIntegrityIssues: vi.fn(),
}));

vi.mock('../shared/schema', () => ({
  adminAuditLog: { id: 'id', resourceType: 'resourceType', createdAt: 'createdAt', action: 'action', staffEmail: 'staffEmail', details: 'details', resourceId: 'resourceId' },
  integrityIssuesTracking: { id: 'id', issueKey: 'issueKey', firstDetectedAt: 'firstDetectedAt', lastSeenAt: 'lastSeenAt', resolvedAt: 'resolvedAt', checkName: 'checkName', severity: 'severity', description: 'description' },
  integrityIgnores: { id: 'id', issueKey: 'issueKey', ignoredBy: 'ignoredBy', ignoredAt: 'ignoredAt', expiresAt: 'expiresAt', reason: 'reason', isActive: 'isActive' },
  integrityCheckHistory: { id: 'id', runAt: 'runAt', totalIssues: 'totalIssues', criticalCount: 'criticalCount', highCount: 'highCount', mediumCount: 'mediumCount', lowCount: 'lowCount', resultsJson: 'resultsJson', triggeredBy: 'triggeredBy' },
}));

vi.mock('../server/core/auditLog', () => ({
  logIntegrityAudit: vi.fn().mockResolvedValue(1),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClientWithFallback: vi.fn(),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(),
}));

vi.mock('../server/core/stripe/customers', () => ({
  syncCustomerMetadataToStripe: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/utils/tierUtils', () => ({
  denormalizeTierForHubSpotAsync: vi.fn((tier: string) => Promise.resolve(tier)),
  normalizeTierName: vi.fn((tier: string) => tier?.toLowerCase()),
}));

vi.mock('../shared/constants/statuses', () => ({
  MEMBERSHIP_STATUS: { ACTIVE: 'active', PENDING: 'pending', NON_MEMBER: 'non-member', INACTIVE: 'inactive', ARCHIVED: 'archived', MERGED: 'merged' },
  BOOKING_STATUS: { PENDING: 'pending', CANCELLED: 'cancelled', DECLINED: 'declined', NO_SHOW: 'no_show', PENDING_APPROVAL: 'pending_approval', APPROVED: 'approved', CONFIRMED: 'confirmed' },
}));

import {
  safeCheck,
  generateIssueKey,
  getCheckSeverity,
} from '../server/core/integrity/core';
import type { IntegrityCheckResult, IntegrityIssue } from '../server/core/integrity/core';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('safeCheck', () => {
  it('returns result with durationMs when check succeeds', async () => {
    const mockResult: IntegrityCheckResult = {
      checkName: 'Test Check',
      status: 'pass',
      issueCount: 0,
      issues: [],
      lastRun: new Date(),
    };

    const result = await safeCheck(() => Promise.resolve(mockResult), 'Test Check');
    expect(result.checkName).toBe('Test Check');
    expect(result.status).toBe('pass');
    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });

  it('returns warning with system_error when check throws', async () => {
    const result = await safeCheck(
      () => Promise.reject(new Error('Something broke')),
      'Failing Check'
    );

    expect(result.checkName).toBe('Failing Check');
    expect(result.status).toBe('warning');
    expect(result.issueCount).toBe(1);
    expect(result.issues[0].category).toBe('system_error');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('Something broke');
    expect(result.durationMs).toBeDefined();
  });

  it('measures duration correctly', async () => {
    const result = await safeCheck(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        checkName: 'Slow Check',
        status: 'pass' as const,
        issueCount: 0,
        issues: [],
        lastRun: new Date(),
      };
    }, 'Slow Check');

    expect(result.durationMs!).toBeGreaterThanOrEqual(40);
  });
});

describe('generateIssueKey', () => {
  it('generates key from table and recordId', () => {
    const issue: IntegrityIssue = {
      category: 'data_quality',
      severity: 'error',
      table: 'users',
      recordId: 42,
      description: 'Test issue',
    };

    expect(generateIssueKey(issue)).toBe('users_42');
  });

  it('handles string recordId', () => {
    const issue: IntegrityIssue = {
      category: 'sync_mismatch',
      severity: 'warning',
      table: 'booking_sessions',
      recordId: '1-2',
      description: 'Test overlap',
    };

    expect(generateIssueKey(issue)).toBe('booking_sessions_1-2');
  });
});

describe('getCheckSeverity', () => {
  it('returns critical for known critical checks', () => {
    expect(getCheckSeverity('Stripe Subscription Sync')).toBe('critical');
    expect(getCheckSeverity('Stuck Transitional Members')).toBe('critical');
    expect(getCheckSeverity('Active Bookings Without Sessions')).toBe('critical');
    expect(getCheckSeverity('Billing Orphans')).toBe('critical');
  });

  it('returns high for known high-severity checks', () => {
    expect(getCheckSeverity('Tier Reconciliation')).toBe('high');
    expect(getCheckSeverity('Billing Provider Hybrid State')).toBe('high');
    expect(getCheckSeverity('Stuck Unpaid Bookings')).toBe('high');
  });

  it('returns medium as default for unknown checks', () => {
    expect(getCheckSeverity('Unknown Check')).toBe('medium');
  });

  it('returns correct severity for low checks', () => {
    expect(getCheckSeverity('Stale Past Tours')).toBe('low');
    expect(getCheckSeverity('Sessions Without Participants')).toBe('low');
  });
});

describe('resolution - resolveIssue', () => {
  it('resolves an issue via audit log', async () => {
    const { logIntegrityAudit } = await import('../server/core/auditLog');
    const { db: mockDb } = await import('../server/db');

    const mockUpdate = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));
    (mockDb.update as ReturnType<typeof vi.fn>).mockImplementation(mockUpdate);

    const { resolveIssue } = await import('../server/core/integrity/resolution');
    const result = await resolveIssue({
      issueKey: 'users_42',
      action: 'resolved',
      actionBy: 'admin@test.com',
      resolutionMethod: 'manual',
      notes: 'Fixed it',
    });

    expect(result.auditLogId).toBe(1);
    expect(logIntegrityAudit).toHaveBeenCalledWith({
      issueKey: 'users_42',
      action: 'resolved',
      actionBy: 'admin@test.com',
      resolutionMethod: 'manual',
      notes: 'Fixed it',
    });
  });
});

describe('resolution - createIgnoreRule', () => {
  it('creates a 24h ignore rule', async () => {
    const { db: mockDb } = await import('../server/db');

    const mockSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => [])
        }))
      }))
    }));
    (mockDb.select as ReturnType<typeof vi.fn>).mockImplementation(mockSelect);

    const mockInsert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: 5 }])
      }))
    }));
    (mockDb.insert as ReturnType<typeof vi.fn>).mockImplementation(mockInsert);

    const { createIgnoreRule } = await import('../server/core/integrity/resolution');
    const result = await createIgnoreRule({
      issueKey: 'users_99',
      duration: '24h',
      reason: 'Known issue',
      ignoredBy: 'admin@test.com',
    });

    expect(result.id).toBe(5);
    expect(result.issueKey).toBe('users_99');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws for invalid duration', async () => {
    const { createIgnoreRule } = await import('../server/core/integrity/resolution');
    await expect(createIgnoreRule({
      issueKey: 'test_1',
      duration: 'invalid' as '24h',
      reason: 'test',
      ignoredBy: 'test@test.com',
    })).rejects.toThrow('Invalid duration');
  });
});

describe('cleanup - runDataCleanup', () => {
  it('runs cleanup and returns counts', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }, { id: 5 }, { id: 6 }] });

    const { runDataCleanup } = await import('../server/core/integrity/cleanup');
    const result = await runDataCleanup();

    expect(result.orphanedNotifications).toBe(2);
    expect(result.orphanedBookings).toBe(1);
    expect(result.expiredHolds).toBe(3);
  });

  it('throws on database error', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockRejectedValueOnce(new Error('DB unavailable'));

    const { runDataCleanup } = await import('../server/core/integrity/cleanup');
    await expect(runDataCleanup()).rejects.toThrow('DB unavailable');
  });
});

describe('resolution - syncPush', () => {
  it('pushes app data to HubSpot contact', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ first_name: 'John', last_name: 'Doe', email: 'john@test.com', tier: 'gold', membership_status: 'active', hubspot_id: 'hs_123' }]
    });

    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockHubSpot = { crm: { contacts: { basicApi: { update: mockUpdate } } } };
    const { getHubSpotClientWithFallback } = await import('../server/core/integrations');
    (getHubSpotClientWithFallback as ReturnType<typeof vi.fn>).mockResolvedValue({ client: mockHubSpot });

    const { syncPush } = await import('../server/core/integrity/resolution');
    const result = await syncPush({ target: 'hubspot', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('hs_123');
    expect(mockUpdate).toHaveBeenCalledWith('hs_123', expect.objectContaining({
      properties: expect.objectContaining({
        firstname: 'John',
        lastname: 'Doe',
      })
    }));
  });

  it('throws when userId is missing for HubSpot push', async () => {
    const { syncPush } = await import('../server/core/integrity/resolution');
    await expect(syncPush({ target: 'hubspot' })).rejects.toThrow('userId is required');
  });

  it('throws when user has no HubSpot link', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com', tier: 'gold', membership_status: 'active', hubspot_id: null }]
    });

    const { syncPush } = await import('../server/core/integrity/resolution');
    await expect(syncPush({ target: 'hubspot', userId: 1 })).rejects.toThrow('missing a HubSpot contact link');
  });

  it('pushes app data to Stripe', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com' }]
    });

    const { syncCustomerMetadataToStripe } = await import('../server/core/stripe/customers');
    (syncCustomerMetadataToStripe as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    const { syncPush } = await import('../server/core/integrity/resolution');
    const result = await syncPush({ target: 'stripe', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('john@test.com');
    expect(syncCustomerMetadataToStripe).toHaveBeenCalledWith('john@test.com');
  });

  it('throws for unsupported sync target', async () => {
    const { syncPush } = await import('../server/core/integrity/resolution');
    await expect(syncPush({ target: 'unknown' as 'hubspot' })).rejects.toThrow('Unsupported sync target');
  });
});

describe('resolution - syncPull', () => {
  it('pulls HubSpot data to app user', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com', billing_provider: null, last_manual_fix_at: null, hubspot_id: 'hs_123' }]
    });
    mockExec.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    mockExec.mockResolvedValueOnce({ rows: [] });

    const mockHubSpot = {
      crm: { contacts: { basicApi: { getById: vi.fn().mockResolvedValue({ properties: { firstname: 'Updated', lastname: 'Name', membership_tier: 'gold', phone: '555-1234' } }) } } },
    };
    const { getHubSpotClientWithFallback } = await import('../server/core/integrations');
    (getHubSpotClientWithFallback as ReturnType<typeof vi.fn>).mockResolvedValue({ client: mockHubSpot });

    const { syncPull } = await import('../server/core/integrity/resolution');
    const result = await syncPull({ target: 'hubspot', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('42');
  });

  it('throws when member not found for HubSpot pull', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({ rows: [] });

    const { syncPull } = await import('../server/core/integrity/resolution');
    await expect(syncPull({ target: 'hubspot', userId: 99 })).rejects.toThrow('Member not found');
  });

  it('pulls Stripe data to app user', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com', stripe_customer_id: 'cus_1', tier: 'silver', membership_status: 'active' }]
    });
    mockExec.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    mockExec.mockResolvedValueOnce({ rows: [] });

    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: { name: 'Gold' } } }] },
          }],
        }),
      },
    };
    const { getStripeClient } = await import('../server/core/stripe/client');
    (getStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);

    const { syncPull } = await import('../server/core/integrity/resolution');
    const result = await syncPull({ target: 'stripe', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('42');
  });

  it('returns no-changes message when Stripe data matches', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com', stripe_customer_id: 'cus_1', tier: 'gold', membership_status: 'active' }]
    });

    const mockStripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{
            status: 'active',
            items: { data: [{ price: { product: { name: 'Gold' } } }] },
          }],
        }),
      },
    };
    const { getStripeClient } = await import('../server/core/stripe/client');
    (getStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);

    const { syncPull } = await import('../server/core/integrity/resolution');
    const result = await syncPull({ target: 'stripe', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('no changes needed');
  });

  it('handles no active Stripe subscription gracefully', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com', stripe_customer_id: 'cus_1', tier: 'gold', membership_status: 'active' }]
    });

    const mockStripe = {
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    };
    const { getStripeClient } = await import('../server/core/stripe/client');
    (getStripeClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockStripe);

    const { syncPull } = await import('../server/core/integrity/resolution');
    const result = await syncPull({ target: 'stripe', userId: 42 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('No active Stripe subscription');
  });

  it('throws when user has no Stripe customer ID', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec.mockResolvedValueOnce({
      rows: [{ email: 'john@test.com', stripe_customer_id: null, tier: 'gold', membership_status: 'active' }]
    });

    const { syncPull } = await import('../server/core/integrity/resolution');
    await expect(syncPull({ target: 'stripe', userId: 42 })).rejects.toThrow('no linked Stripe customer');
  });

  it('throws for unsupported pull target', async () => {
    const { syncPull } = await import('../server/core/integrity/resolution');
    await expect(syncPull({ target: 'unknown' as 'hubspot' })).rejects.toThrow('Unsupported sync target');
  });
});

describe('cleanup - autoFixMissingTiers', () => {
  it('returns counts for auto-fix operations', async () => {
    const { db: mockDb } = await import('../server/db');
    const mockExec = mockDb.execute as ReturnType<typeof vi.fn>;
    mockExec
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ email: 'a@test.com', first_name: 'A', last_name: 'B', stripe_customer_id: null, mindbody_client_id: null }] });

    const { autoFixMissingTiers } = await import('../server/core/integrity/cleanup');
    const result = await autoFixMissingTiers();

    expect(result.fixedFromAlternateEmail).toBe(0);
    expect(result.remainingWithoutTier).toBe(2);
  });
});
