import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockEnqueue = vi.fn().mockResolvedValue(1);
const mockExecute = vi.fn().mockResolvedValue({});

vi.mock('../server/core/hubspot/queue', () => ({
  enqueueHubSpotSync: (...args: unknown[]) => mockEnqueue(...args),
}));

vi.mock('../server/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { execute: (...args: unknown[]) => mockExecute(...args) };
      await fn(tx);
    }),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('HubSpot Queue Helpers', () => {
  let queueTierSync: typeof import('../server/core/hubspot/queueHelpers').queueTierSync;
  let queueIntegrityFixSync: typeof import('../server/core/hubspot/queueHelpers').queueIntegrityFixSync;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/core/hubspot/queueHelpers');
    queueTierSync = mod.queueTierSync;
    queueIntegrityFixSync = mod.queueIntegrityFixSync;
  });

  describe('queueTierSync', () => {
    it('supersedes older tier sync jobs in a transaction', async () => {
      await queueTierSync({
        email: 'member@test.com',
        newTier: 'Gold',
        oldTier: 'Silver',
        changedBy: 'admin',
      });
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('normalizes email to lowercase', async () => {
      await queueTierSync({
        email: 'MEMBER@TEST.COM',
        newTier: 'Gold',
      });
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const supersedeSql = mockExecute.mock.calls[0][0];
      expect(JSON.stringify(supersedeSql)).toContain('member@test.com');
    });

    it('replaces spaces in tier name with underscores for idempotency key', async () => {
      await queueTierSync({
        email: 'test@test.com',
        newTier: 'Platinum Plus',
      });
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const insertSql = mockExecute.mock.calls[1][0];
      expect(JSON.stringify(insertSql)).toContain('Platinum_Plus');
    });
  });

  describe('queueIntegrityFixSync', () => {
    it('enqueues a sync_tier operation with priority 2', async () => {
      await queueIntegrityFixSync({
        email: 'fix@test.com',
        tier: 'Gold',
        fixAction: 'status_correction',
      });
      expect(mockEnqueue).toHaveBeenCalledWith(
        'sync_tier',
        expect.objectContaining({
          email: 'fix@test.com',
          changedBy: 'data_integrity',
          changedByName: 'Data Integrity Fix',
        }),
        expect.objectContaining({
          priority: 2,
          maxRetries: 3,
        })
      );
    });

    it('generates daily-scoped idempotency key', async () => {
      await queueIntegrityFixSync({
        email: 'fix@test.com',
        fixAction: 'missing_tier',
      });
      const callArgs = mockEnqueue.mock.calls[0];
      const options = callArgs[2];
      expect(options.idempotencyKey).toMatch(/^integrity_fix_fix@test\.com_missing_tier_\d+$/);
    });

    it('normalizes email to lowercase', async () => {
      await queueIntegrityFixSync({
        email: 'FIX@TEST.COM',
        fixAction: 'test',
      });
      expect(mockEnqueue).toHaveBeenCalledWith(
        'sync_tier',
        expect.objectContaining({ email: 'fix@test.com' }),
        expect.anything()
      );
    });
  });
});
