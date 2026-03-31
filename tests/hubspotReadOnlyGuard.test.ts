import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('HubSpot Read-Only Guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns true (read-only) when isProduction is false', async () => {
    vi.doMock('../server/core/db', () => ({ isProduction: false }));
    const { isHubSpotReadOnly } = await import('../server/core/hubspot/readOnlyGuard');
    expect(isHubSpotReadOnly()).toBe(true);
  });

  it('returns false (writable) when isProduction is true', async () => {
    vi.doMock('../server/core/db', () => ({ isProduction: true }));
    const { isHubSpotReadOnly } = await import('../server/core/hubspot/readOnlyGuard');
    expect(isHubSpotReadOnly()).toBe(false);
  });

  it('logs read-only message only once', async () => {
    vi.doMock('../server/core/db', () => ({ isProduction: false }));
    const loggerMod = await import('../server/core/logger');
    const { isHubSpotReadOnly } = await import('../server/core/hubspot/readOnlyGuard');
    isHubSpotReadOnly();
    isHubSpotReadOnly();
    isHubSpotReadOnly();
    const infoCalls = vi.mocked(loggerMod.logger.info).mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('READ-ONLY')
    );
    expect(infoCalls.length).toBe(1);
  });

  it('logHubSpotWriteSkipped logs operation details', async () => {
    vi.doMock('../server/core/db', () => ({ isProduction: false }));
    const loggerMod = await import('../server/core/logger');
    const { logHubSpotWriteSkipped } = await import('../server/core/hubspot/readOnlyGuard');
    logHubSpotWriteSkipped('sync_member', 'user@test.com');
    expect(loggerMod.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('sync_member')
    );
    expect(loggerMod.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('user@test.com')
    );
  });
});
