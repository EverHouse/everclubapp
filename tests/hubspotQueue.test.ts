import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockQueryWithRetry = vi.fn();

vi.mock('../server/core/db', () => ({
  queryWithRetry: (...args: unknown[]) => mockQueryWithRetry(...args),
}));

const mockIsRateLimitError = vi.fn().mockReturnValue(false);
const mockWasRateLimitEncountered = vi.fn().mockReturnValue(false);

vi.mock('../server/core/hubspot/request', () => ({
  isRateLimitError: (...args: unknown[]) => mockIsRateLimitError(...args),
  wasRateLimitEncountered: (...args: unknown[]) => mockWasRateLimitEncountered(...args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/hubspot/readOnlyGuard', () => ({
  isHubSpotReadOnly: vi.fn().mockReturnValue(false),
  logHubSpotWriteSkipped: vi.fn(),
}));

vi.mock('../server/core/hubspot/members', () => ({
  findOrCreateHubSpotContact: vi.fn().mockResolvedValue({ id: 'c-1' }),
  syncTierToHubSpot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/hubspot/stages', () => ({
  updateContactMembershipStatus: vi.fn().mockResolvedValue(true),
}));

vi.mock('../server/core/hubspot/companies', () => ({
  syncCompanyToHubSpot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/staffNotifications', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: { contacts: { basicApi: { update: vi.fn().mockResolvedValue({}) } } },
  }),
}));

describe('HubSpot Queue', () => {
  let enqueueHubSpotSync: typeof import('../server/core/hubspot/queue').enqueueHubSpotSync;
  let getQueueStats: typeof import('../server/core/hubspot/queue').getQueueStats;
  let recoverStuckProcessingJobs: typeof import('../server/core/hubspot/queue').recoverStuckProcessingJobs;
  let processHubSpotQueue: typeof import('../server/core/hubspot/queue').processHubSpotQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsRateLimitError.mockReturnValue(false);
    mockWasRateLimitEncountered.mockReturnValue(false);
    const mod = await import('../server/core/hubspot/queue');
    enqueueHubSpotSync = mod.enqueueHubSpotSync;
    getQueueStats = mod.getQueueStats;
    recoverStuckProcessingJobs = mod.recoverStuckProcessingJobs;
    processHubSpotQueue = mod.processHubSpotQueue;
  });

  describe('enqueueHubSpotSync', () => {
    it('inserts a new job and returns its id', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 42 }] });
      const id = await enqueueHubSpotSync('create_contact', { email: 'test@example.com' });
      expect(id).toBe(42);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO hubspot_sync_queue'),
        expect.arrayContaining(['create_contact']),
        3
      );
    });

    it('returns existing id when idempotency key matches pending job', async () => {
      mockQueryWithRetry.mockResolvedValueOnce({ rows: [{ id: 99 }] });
      const id = await enqueueHubSpotSync('sync_tier', { email: 'dup@example.com' }, {
        idempotencyKey: 'tier_sync_dup_key',
      });
      expect(id).toBe(99);
    });

    it('returns null on conflict (DO NOTHING)', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const id = await enqueueHubSpotSync('update_contact', { email: 'x@x.com' }, {
        idempotencyKey: 'key_conflict',
      });
      expect(id).toBeNull();
    });

    it('returns null and logs error on database failure', async () => {
      mockQueryWithRetry.mockRejectedValue(new Error('DB connection lost'));
      const id = await enqueueHubSpotSync('create_contact', { email: 'fail@test.com' });
      expect(id).toBeNull();
    });

    it('applies default priority of 5 and maxRetries of 5', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 1 }] });
      await enqueueHubSpotSync('create_contact', { email: 'test@example.com' });
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO hubspot_sync_queue'),
        expect.arrayContaining([5, 5]),
        3
      );
    });

    it('allows custom priority and maxRetries', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ id: 2 }] });
      await enqueueHubSpotSync('sync_tier', { email: 'test@example.com' }, {
        priority: 1,
        maxRetries: 10,
      });
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO hubspot_sync_queue'),
        expect.arrayContaining([1, 10]),
        3
      );
    });
  });

  describe('getQueueStats', () => {
    it('parses queue statistics from database row', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ pending: '3', processing: '1', failed: '2', dead: '0', completed_today: '10' }],
      });
      const stats = await getQueueStats();
      expect(stats).toEqual({
        pending: 3,
        processing: 1,
        failed: 2,
        dead: 0,
        completedToday: 10,
      });
    });

    it('handles numeric values (not just strings)', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ pending: 5, processing: 0, failed: 0, dead: 0, completed_today: 25 }],
      });
      const stats = await getQueueStats();
      expect(stats.pending).toBe(5);
      expect(stats.completedToday).toBe(25);
    });
  });

  describe('recoverStuckProcessingJobs', () => {
    it('returns count of recovered jobs', async () => {
      mockQueryWithRetry.mockResolvedValue({ rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      const count = await recoverStuckProcessingJobs();
      expect(count).toBe(3);
    });

    it('returns 0 when no stuck jobs found', async () => {
      mockQueryWithRetry.mockResolvedValue({ rowCount: 0, rows: [] });
      const count = await recoverStuckProcessingJobs();
      expect(count).toBe(0);
    });

    it('returns 0 on database error', async () => {
      mockQueryWithRetry.mockRejectedValue(new Error('DB error'));
      const count = await recoverStuckProcessingJobs();
      expect(count).toBe(0);
    });
  });

  describe('processHubSpotQueue', () => {
    it('returns zero stats when queue is empty', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const stats = await processHubSpotQueue();
      expect(stats).toEqual({ processed: 0, succeeded: 0, failed: 0 });
    });

    it('processes a successful create_contact job', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            operation: 'create_contact',
            payload: { email: 'test@test.com', firstName: 'Test', lastName: 'User' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('dead-letters job with unrecoverable MISSING_SCOPES error', async () => {
      const members = await import('../server/core/hubspot/members');
      vi.mocked(members.findOrCreateHubSpotContact).mockRejectedValueOnce(
        new Error('MISSING_SCOPES: contacts')
      );

      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 2,
            operation: 'create_contact',
            payload: { email: 'dead@test.com', firstName: 'D', lastName: 'L' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("status = 'dead'"),
        expect.arrayContaining([expect.stringContaining('Unrecoverable error')]),
        3
      );
    });

    it('dead-letters job with 403 Forbidden error', async () => {
      const members = await import('../server/core/hubspot/members');
      vi.mocked(members.findOrCreateHubSpotContact).mockRejectedValueOnce(
        new Error('403 Forbidden: insufficient permissions')
      );

      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 3,
            operation: 'create_contact',
            payload: { email: 'forbidden@test.com' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.failed).toBe(1);
    });

    it('retries recoverable errors with exponential backoff', async () => {
      const members = await import('../server/core/hubspot/members');
      vi.mocked(members.findOrCreateHubSpotContact).mockRejectedValueOnce(
        new Error('Temporary network error')
      );

      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 4,
            operation: 'create_contact',
            payload: { email: 'retry@test.com' },
            retry_count: 1,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("status = 'failed'"),
        expect.arrayContaining([2, 'Temporary network error']),
        3
      );
    });

    it('dead-letters job when max retries exceeded', async () => {
      const members = await import('../server/core/hubspot/members');
      vi.mocked(members.findOrCreateHubSpotContact).mockRejectedValueOnce(
        new Error('Persistent error')
      );

      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 5,
            operation: 'create_contact',
            payload: { email: 'maxretry@test.com' },
            retry_count: 4,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining("status = 'dead'"),
        expect.arrayContaining(['Persistent error']),
        3
      );
    });

    it('sets rate limit flag when rate limit error detected', async () => {
      const members = await import('../server/core/hubspot/members');
      vi.mocked(members.findOrCreateHubSpotContact).mockRejectedValueOnce(
        new Error('429 Too Many Requests')
      );
      mockIsRateLimitError.mockReturnValue(true);

      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 6,
            operation: 'create_contact',
            payload: { email: 'ratelimit@test.com' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(mockIsRateLimitError).toHaveBeenCalled();
    });

    it('processes sync_tier operation correctly', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 7,
            operation: 'sync_tier',
            payload: { email: 'tier@test.com', newTier: 'Gold' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(1);
    });

    it('handles unknown operation by throwing error', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 8,
            operation: 'unknown_op',
            payload: { email: 'test@test.com' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('handles superseded job (rowCount 0 on completion)', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({
          rows: [{
            id: 9,
            operation: 'create_contact',
            payload: { email: 'superseded@test.com', firstName: 'S', lastName: 'P' },
            retry_count: 0,
            max_retries: 5,
          }],
        })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const stats = await processHubSpotQueue(10);
      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(0);
    });
  });
});
