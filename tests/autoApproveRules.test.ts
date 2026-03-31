// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => {
    if (e instanceof Error) return e.message;
    return String(e);
  }),
}));

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sqlStrings: Array.from(strings),
    __sqlValues: values,
  });
  sqlTagFn.join = vi.fn();
  sqlTagFn.raw = vi.fn((str: string) => ({ __sqlStrings: [str], __sqlValues: [] }));
  return {
    sql: sqlTagFn,
    eq: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  systemSettings: { key: 'key', value: 'value' },
}));

import {
  isAutoApproveEnabled,
  getSettingBoolean,
  getSettingValue,
  invalidateSettingsCache,
} from '../server/core/settingsHelper';

describe('Auto-Approve Rule Evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSettingsCache();
  });

  describe('isAutoApproveEnabled', () => {
    it('returns true when conference_rooms auto-approve setting is true', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'true' }]),
        }),
      });

      const result = await isAutoApproveEnabled('conference_rooms');

      expect(result).toBe(true);
    });

    it('returns false when conference_rooms auto-approve setting is false', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'false' }]),
        }),
      });

      const result = await isAutoApproveEnabled('conference_rooms');

      expect(result).toBe(false);
    });

    it('returns true when trackman_imports auto-approve setting is true', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'true' }]),
        }),
      });

      const result = await isAutoApproveEnabled('trackman_imports');

      expect(result).toBe(true);
    });

    it('defaults to true when setting does not exist', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await isAutoApproveEnabled('conference_rooms');

      expect(result).toBe(true);
    });

    it('defaults to true when database query fails', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('DB connection failed')),
        }),
      });

      const result = await isAutoApproveEnabled('trackman_imports');

      expect(result).toBe(true);
    });
  });

  describe('getSettingBoolean', () => {
    it('returns true for string "true"', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'true' }]),
        }),
      });

      const result = await getSettingBoolean('some.key', false);

      expect(result).toBe(true);
    });

    it('returns false for string "false"', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'false' }]),
        }),
      });

      const result = await getSettingBoolean('some.key', true);

      expect(result).toBe(false);
    });

    it('returns false for non-"true" string values', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'yes' }]),
        }),
      });

      const result = await getSettingBoolean('some.key', true);

      expect(result).toBe(false);
    });

    it('uses default value when setting not found', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const resultTrue = await getSettingBoolean('missing.key', true);
      expect(resultTrue).toBe(true);

      invalidateSettingsCache();

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const resultFalse = await getSettingBoolean('missing.key2', false);
      expect(resultFalse).toBe(false);
    });
  });

  describe('getSettingValue — caching', () => {
    it('caches values and returns from cache on second call', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'cached_value' }]),
        }),
      });

      const first = await getSettingValue('cache.test');
      expect(first).toBe('cached_value');

      mockSelect.mockClear();

      const second = await getSettingValue('cache.test');
      expect(second).toBe('cached_value');
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('invalidates specific cache key', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'value1' }]),
        }),
      });

      await getSettingValue('key.to.invalidate');

      invalidateSettingsCache('key.to.invalidate');

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'value2' }]),
        }),
      });

      const result = await getSettingValue('key.to.invalidate');
      expect(result).toBe('value2');
    });

    it('invalidates all cache when no key provided', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'old_value' }]),
        }),
      });

      await getSettingValue('key1');
      await getSettingValue('key2');

      invalidateSettingsCache();

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 'new_value' }]),
        }),
      });

      const result = await getSettingValue('key1');
      expect(result).toBe('new_value');
    });
  });
});
