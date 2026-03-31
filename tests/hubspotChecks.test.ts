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
  getErrorStatusCode: vi.fn(() => null),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClientWithFallback: vi.fn(),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/utils/tierUtils', () => ({
  denormalizeTierForHubSpotAsync: vi.fn((tier: string) => Promise.resolve(tier)),
}));

import { db } from '../server/db';
import { getHubSpotClientWithFallback } from '../server/core/integrations';
import {
  checkHubSpotSyncMismatch,
  checkHubSpotIdDuplicates,
} from '../server/core/integrity/hubspotChecks';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetHubSpot = getHubSpotClientWithFallback as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
  mockGetHubSpot.mockReset();
});

describe('checkHubSpotSyncMismatch', () => {
  it('returns warning when HubSpot is unavailable', async () => {
    mockGetHubSpot.mockRejectedValueOnce(new Error('HubSpot unavailable'));

    const result = await checkHubSpotSyncMismatch();
    expect(result.checkName).toBe('HubSpot Sync Mismatch');
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('Unable to connect to HubSpot');
  });

  it('returns pass when all data is in sync', async () => {
    const mockHubSpot = {
      crm: {
        contacts: {
          batchApi: {
            read: vi.fn().mockResolvedValue({
              results: [{
                id: 'hs-1',
                properties: { firstname: 'John', lastname: 'Doe', email: 'john@test.com', membership_tier: 'gold' }
              }]
            })
          }
        }
      }
    };
    mockGetHubSpot.mockResolvedValueOnce({ client: mockHubSpot });
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, email: 'john@test.com', first_name: 'John', last_name: 'Doe',
        hubspot_id: 'hs-1', tier: 'gold', membership_status: 'active'
      }]
    });

    const result = await checkHubSpotSyncMismatch();
    expect(result.status).toBe('pass');
  });

  it('detects member not found in HubSpot', async () => {
    const mockHubSpot = {
      crm: {
        contacts: {
          batchApi: {
            read: vi.fn().mockResolvedValue({ results: [] })
          }
        }
      }
    };
    mockGetHubSpot.mockResolvedValueOnce({ client: mockHubSpot });
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, email: 'missing@test.com', first_name: 'Missing', last_name: 'User',
        hubspot_id: 'hs-gone', tier: 'silver', membership_status: 'active'
      }]
    });

    const result = await checkHubSpotSyncMismatch();
    expect(result.issues.some(i => i.description.includes('not found in HubSpot'))).toBe(true);
    expect(result.issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('detects name mismatch between app and HubSpot', async () => {
    const mockHubSpot = {
      crm: {
        contacts: {
          batchApi: {
            read: vi.fn().mockResolvedValue({
              results: [{
                id: 'hs-2',
                properties: { firstname: 'Jane', lastname: 'Smith', email: 'john@test.com', membership_tier: 'gold' }
              }]
            })
          }
        }
      }
    };
    mockGetHubSpot.mockResolvedValueOnce({ client: mockHubSpot });
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 2, email: 'john@test.com', first_name: 'John', last_name: 'Doe',
        hubspot_id: 'hs-2', tier: 'gold', membership_status: 'active'
      }]
    });

    const result = await checkHubSpotSyncMismatch();
    expect(result.issues.some(i => i.description.includes('mismatched data'))).toBe(true);
    expect(result.issues[0].category).toBe('sync_mismatch');
  });
});

describe('checkHubSpotIdDuplicates', () => {
  it('returns pass when no duplicates', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkHubSpotIdDuplicates();
    expect(result.checkName).toBe('HubSpot ID Duplicates');
    expect(result.status).toBe('pass');
  });

  it('detects duplicate HubSpot IDs', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          hubspot_id: 'hs-dup', emails: ['a@test.com', 'b@test.com'],
          user_ids: [1, 2], statuses: ['active', 'inactive'], tiers: ['gold', 'silver'],
          user_count: 2
        }]
      })
      .mockResolvedValueOnce({ rows: [{ linked_count: '0' }] });

    const result = await checkHubSpotIdDuplicates();
    expect(result.status).toBe('fail');
    expect(result.issues[0].description).toContain('shared by 2 users');
    expect(result.issues[0].severity).toBe('warning');
  });

  it('marks already-linked duplicates as info severity', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          hubspot_id: 'hs-linked', emails: ['primary@test.com', 'linked@test.com'],
          user_ids: [1, 2], statuses: ['active', 'inactive'], tiers: ['gold', 'none'],
          user_count: 2
        }]
      })
      .mockResolvedValueOnce({ rows: [{ linked_count: '1' }] });

    const result = await checkHubSpotIdDuplicates();
    expect(result.issues[0].severity).toBe('info');
    expect(result.issues[0].description).toContain('emails already linked');
  });
});
