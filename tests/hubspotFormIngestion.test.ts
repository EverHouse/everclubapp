// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbExecute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  formSubmissions: {
    id: 'id', email: 'email', formType: 'form_type',
    hubspotSubmissionId: 'hubspot_submission_id', createdAt: 'created_at',
  },
  systemSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(), and: vi.fn(), gte: vi.fn(), lte: vi.fn(),
  sql: Object.assign(
    (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
    { raw: vi.fn() }
  ),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hubspot/api-client', () => ({
  Client: vi.fn(),
}));

vi.mock('node-fetch', () => ({ default: vi.fn() }));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn().mockResolvedValue(''),
}));

describe('HubSpot Form Ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HUBSPOT_FORM_MEMBERSHIP;
    delete process.env.HUBSPOT_FORM_PRIVATE_HIRE;
    delete process.env.HUBSPOT_FORM_EVENT_INQUIRY;
    delete process.env.HUBSPOT_FORM_GUEST_CHECKIN;
  });

  describe('resolveFormId priority chain', () => {
    it('returns env var over hardcoded ID when env var is set', async () => {
      process.env.HUBSPOT_FORM_MEMBERSHIP = 'env-form-id-123';
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('membership');
      expect(id).toBe('env-form-id-123');
    });

    it('falls back to hardcoded ID when env var is absent', async () => {
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('membership');
      expect(id).toBe('6973a2ea-f8a5-4925-9898-2fcc373512f0');
    });

    it('returns hardcoded private-hire form ID', async () => {
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('private-hire');
      expect(id).toBe('7b2eca31-2f78-40bc-9a67-e25ecd140047');
    });

    it('returns hardcoded event-inquiry form ID', async () => {
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('event-inquiry');
      expect(id).toBe('b69f9fe4-9b3b-4d1e-a689-ba3127e5f8f2');
    });

    it('returns null for unknown form type with no env var', async () => {
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('nonexistent-type');
      expect(id).toBeNull();
    });
  });

  describe('syncHubSpotFormSubmissions deduplication', () => {
    it('returns zero stats and sets auth backoff when no token available', async () => {
      vi.resetModules();
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const { syncHubSpotFormSubmissions, resetFormSyncAccessDeniedFlag, getFormSyncStatus } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      const result = await syncHubSpotFormSubmissions();
      expect(result.totalFetched).toBe(0);
      expect(result.newInserted).toBe(0);
      expect(result.errors).toEqual([]);
      const status = getFormSyncStatus();
      expect(status.authFailure).toBe(true);
      expect(status.authFailureUntil).toBeGreaterThan(Date.now());
    });

    it('skips sync during auth backoff period and logs it', async () => {
      vi.resetModules();
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const { syncHubSpotFormSubmissions, resetFormSyncAccessDeniedFlag } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      await syncHubSpotFormSubmissions();
      const logger = await import('../server/core/logger');
      vi.mocked(logger.logger.info).mockClear();
      const result2 = await syncHubSpotFormSubmissions();
      expect(result2.totalFetched).toBe(0);
      expect(vi.mocked(logger.logger.info)).toHaveBeenCalledWith(
        expect.stringContaining('backoff')
      );
    });

    it('force option bypasses auth backoff', async () => {
      vi.resetModules();
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const { syncHubSpotFormSubmissions, resetFormSyncAccessDeniedFlag } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      await syncHubSpotFormSubmissions();
      const result2 = await syncHubSpotFormSubmissions({ force: true });
      expect(result2.totalFetched).toBe(0);
    });
  });

  describe('getFormSyncStatus', () => {
    it('returns clean status after reset', async () => {
      const { getFormSyncStatus, resetFormSyncAccessDeniedFlag } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      const status = getFormSyncStatus();
      expect(status.authFailure).toBe(false);
    });
  });
});
