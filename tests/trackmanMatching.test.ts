// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/trackman/parser', () => ({
  parseCSVLine: vi.fn((line: string) => line.split(',')),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: {
      contacts: {
        basicApi: {
          getPage: vi.fn().mockResolvedValue({ results: [], paging: {} }),
        },
      },
    },
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

const mockDbExecute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockDbSelect = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  users: { email: 'email', manuallyLinkedEmails: 'manually_linked_emails' },
  staffUsers: { email: 'email', role: 'role', isActive: 'is_active' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
}));

vi.mock('../server/core/trackman/constants', () => ({
  VALID_MEMBER_STATUSES: ['active', 'expired', 'terminated', 'former_member', 'inactive'],
  UserIdRow: undefined,
  LinkedEmailRow: undefined,
  HubSpotMember: undefined,
}));

describe('Trackman Matching', () => {
  let resolveEmail: typeof import('../server/core/trackman/matching').resolveEmail;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/core/trackman/matching');
    resolveEmail = mod.resolveEmail;
  });

  describe('resolveEmail', () => {
    it('returns trackman mapping when available', () => {
      const membersByEmail = new Map<string, string>();
      const trackmanMapping = new Map([['old@test.com', 'new@test.com']]);
      expect(resolveEmail('old@test.com', membersByEmail, trackmanMapping)).toBe('new@test.com');
    });

    it('falls back to member mapping when no trackman mapping', () => {
      const membersByEmail = new Map([['alias@test.com', 'primary@test.com']]);
      const trackmanMapping = new Map<string, string>();
      expect(resolveEmail('alias@test.com', membersByEmail, trackmanMapping)).toBe('primary@test.com');
    });

    it('returns original email lowercased when no mappings match', () => {
      const membersByEmail = new Map<string, string>();
      const trackmanMapping = new Map<string, string>();
      expect(resolveEmail('User@TEST.com', membersByEmail, trackmanMapping)).toBe('user@test.com');
    });

    it('trackman mapping takes precedence over member mapping', () => {
      const membersByEmail = new Map([['shared@test.com', 'member-resolved@test.com']]);
      const trackmanMapping = new Map([['shared@test.com', 'trackman-resolved@test.com']]);
      expect(resolveEmail('shared@test.com', membersByEmail, trackmanMapping)).toBe('trackman-resolved@test.com');
    });
  });

  describe('getUserIdByEmail', () => {
    it('returns user id when found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 'user-123' }] });
      const { getUserIdByEmail } = await import('../server/core/trackman/matching');
      const result = await getUserIdByEmail('test@test.com');
      expect(result).toBe('user-123');
    });

    it('returns null when not found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const { getUserIdByEmail } = await import('../server/core/trackman/matching');
      const result = await getUserIdByEmail('unknown@test.com');
      expect(result).toBeNull();
    });
  });

  describe('isEmailLinkedToUser', () => {
    it('returns true when emails are the same', async () => {
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('test@test.com', 'TEST@TEST.COM');
      expect(result).toBe(true);
    });

    it('checks database for linked emails', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1 });
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('linked@test.com', 'primary@test.com');
      expect(result).toBe(true);
    });

    it('returns false when no link found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 0 });
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('unlinked@test.com', 'other@test.com');
      expect(result).toBe(false);
    });
  });
});
