// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbExecute = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  formSubmissions: {},
  systemSettings: { key: 'key', value: 'value', category: 'category', updatedBy: 'updated_by', updatedAt: 'updated_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
}));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn().mockImplementation((_key: string, defaultVal: string) => Promise.resolve(defaultVal)),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node-fetch', () => ({ default: vi.fn() }));

vi.mock('@hubspot/api-client', () => ({
  Client: vi.fn().mockImplementation(() => ({
    marketing: { forms: { formsApi: { getPage: vi.fn().mockResolvedValue({ results: [] }) } } },
  })),
}));

describe('HubSpot Form Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HUBSPOT_FORM_MEMBERSHIP;
    delete process.env.HUBSPOT_FORM_PRIVATE_HIRE;
    delete process.env.HUBSPOT_FORM_EVENT_INQUIRY;
    delete process.env.HUBSPOT_FORM_GUEST_CHECKIN;
    delete process.env.HUBSPOT_FORM_CONTACT;
  });

  describe('resolveFormId', () => {
    it('returns env var when set', async () => {
      process.env.HUBSPOT_FORM_MEMBERSHIP = 'env-form-id-123';
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('membership');
      expect(id).toBe('env-form-id-123');
    });

    it('falls back to admin settings when no env var', async () => {
      const settings = await import('../server/core/settingsHelper');
      vi.mocked(settings.getSettingValue).mockResolvedValueOnce('admin-form-id');
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('membership');
      expect(id).toBe('admin-form-id');
    });

    it('falls back to hardcoded known IDs', async () => {
      const settings = await import('../server/core/settingsHelper');
      vi.mocked(settings.getSettingValue).mockResolvedValueOnce('');
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('membership');
      expect(id).toBe('6973a2ea-f8a5-4925-9898-2fcc373512f0');
    });

    it('returns null for unknown form type with no env/settings/hardcoded', async () => {
      const settings = await import('../server/core/settingsHelper');
      vi.mocked(settings.getSettingValue).mockResolvedValueOnce('');
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('unknown-form-type');
      expect(id).toBeNull();
    });
  });

  describe('getFormSyncStatus', () => {
    it('returns initial status with no backoffs active', async () => {
      const { getFormSyncStatus, resetFormSyncAccessDeniedFlag } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      const status = getFormSyncStatus();
      expect(status.accessDenied).toBe(false);
      expect(status.accessDeniedUntil).toBeNull();
      expect(status.authFailure).toBe(false);
      expect(status.authFailureUntil).toBeNull();
    });
  });

  describe('resetFormSyncAccessDeniedFlag', () => {
    it('clears all backoff flags', async () => {
      const { resetFormSyncAccessDeniedFlag, getFormSyncStatus } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      const status = getFormSyncStatus();
      expect(status.accessDenied).toBe(false);
      expect(status.authFailure).toBe(false);
    });
  });

  describe('setPrivateAppToken', () => {
    it('inserts or updates the token in system_settings', async () => {
      const mockOnConflict = vi.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: mockOnConflict,
        }),
      });
      const { setPrivateAppToken, getFormSyncStatus } = await import('../server/core/hubspot/formSync');
      await setPrivateAppToken('new-token-abc', 'admin@test.com');
      expect(mockDbInsert).toHaveBeenCalled();
      const status = getFormSyncStatus();
      expect(status.accessDenied).toBe(false);
      expect(status.authFailure).toBe(false);
    });
  });

  describe('syncHubSpotFormSubmissions', () => {
    it('returns zero stats when no private app token is available', async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const { syncHubSpotFormSubmissions, resetFormSyncAccessDeniedFlag } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      const result = await syncHubSpotFormSubmissions();
      expect(result.totalFetched).toBe(0);
      expect(result.newInserted).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('sets auth failure backoff when no token available', async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      const { syncHubSpotFormSubmissions, resetFormSyncAccessDeniedFlag, getFormSyncStatus } = await import('../server/core/hubspot/formSync');
      resetFormSyncAccessDeniedFlag();
      await syncHubSpotFormSubmissions();
      const status = getFormSyncStatus();
      expect(status.authFailure).toBe(true);
      expect(status.authFailureUntil).toBeGreaterThan(Date.now());
    });

    it('skips sync during auth backoff period', async () => {
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

    it('force option bypasses backoff', async () => {
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

  describe('form type resolution', () => {
    it('resolves private-hire form ID from hardcoded', async () => {
      const settings = await import('../server/core/settingsHelper');
      vi.mocked(settings.getSettingValue).mockResolvedValue('');
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('private-hire');
      expect(id).toBe('7b2eca31-2f78-40bc-9a67-e25ecd140047');
    });

    it('resolves event-inquiry form ID from hardcoded', async () => {
      const settings = await import('../server/core/settingsHelper');
      vi.mocked(settings.getSettingValue).mockResolvedValue('');
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('event-inquiry');
      expect(id).toBe('b69f9fe4-9b3b-4d1e-a689-ba3127e5f8f2');
    });

    it('env var takes highest priority over all sources', async () => {
      process.env.HUBSPOT_FORM_GUEST_CHECKIN = 'env-guest-id';
      const { resolveFormId } = await import('../server/core/hubspot/formSync');
      const id = await resolveFormId('guest-checkin');
      expect(id).toBe('env-guest-id');
    });
  });
});
