// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
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
  users: { email: 'email', trackmanEmail: 'trackman_email', manuallyLinkedEmails: 'manually_linked_emails' },
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

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: {
      contacts: {
        basicApi: { getPage: vi.fn().mockResolvedValue({ results: [], paging: {} }) },
      },
    },
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/trackman/constants', () => ({
  VALID_MEMBER_STATUSES: ['active', 'trialing', 'past_due', 'cancelled', 'suspended'],
  UserIdRow: undefined,
  LinkedEmailRow: undefined,
  HubSpotMember: undefined,
}));

vi.mock('../server/core/trackman/parser', () => ({
  parseCSVLine: vi.fn((line: string) => line.split(',')),
}));


describe('Trackman Ambiguous Matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('resolveEmail', () => {
    it('prefers trackman email mapping over member mapping', async () => {
      const { resolveEmail } = await import('../server/core/trackman/matching');
      const membersByEmail = new Map([['guest@trackman.com', 'member@test.com']]);
      const trackmanEmailMapping = new Map([['guest@trackman.com', 'override@test.com']]);
      const result = resolveEmail('guest@trackman.com', membersByEmail, trackmanEmailMapping);
      expect(result).toBe('override@test.com');
    });

    it('falls back to member mapping when no trackman mapping exists', async () => {
      const { resolveEmail } = await import('../server/core/trackman/matching');
      const membersByEmail = new Map([['guest@trackman.com', 'member@test.com']]);
      const trackmanEmailMapping = new Map();
      const result = resolveEmail('guest@trackman.com', membersByEmail, trackmanEmailMapping);
      expect(result).toBe('member@test.com');
    });

    it('returns original email when no mapping exists', async () => {
      const { resolveEmail } = await import('../server/core/trackman/matching');
      const result = resolveEmail('unknown@trackman.com', new Map(), new Map());
      expect(result).toBe('unknown@trackman.com');
    });

    it('normalizes emails to lowercase', async () => {
      const { resolveEmail } = await import('../server/core/trackman/matching');
      const trackmanMap = new Map([['user@test.com', 'Mapped@Test.COM']]);
      const result = resolveEmail('User@Test.COM', new Map(), trackmanMap);
      expect(result).toBe('mapped@test.com');
    });
  });

  describe('isEmailLinkedToUser', () => {
    it('returns true when emails match directly (case insensitive)', async () => {
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('User@Test.com', 'user@test.com');
      expect(result).toBe(true);
    });

    it('returns true when trackman_email or manually_linked_emails match', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('trackman@linked.com', 'member@test.com');
      expect(result).toBe(true);
    });

    it('returns false when no link exists between emails', async () => {
      mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
      const { isEmailLinkedToUser } = await import('../server/core/trackman/matching');
      const result = await isEmailLinkedToUser('unlinked@other.com', 'member@test.com');
      expect(result).toBe(false);
    });
  });

  describe('getUserIdByEmail', () => {
    it('returns user ID when user exists', async () => {
      mockDbExecute.mockResolvedValue({ rows: [{ id: 'user-abc-123' }], rowCount: 1 });
      const { getUserIdByEmail } = await import('../server/core/trackman/matching');
      const result = await getUserIdByEmail('member@test.com');
      expect(result).toBe('user-abc-123');
    });

    it('returns null when user does not exist', async () => {
      mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
      const { getUserIdByEmail } = await import('../server/core/trackman/matching');
      const result = await getUserIdByEmail('nonexistent@test.com');
      expect(result).toBeNull();
    });
  });

  describe('getAllHubSpotMembers', () => {
    it('filters contacts by valid membership statuses', async () => {
      const { getHubSpotClient } = await import('../server/core/integrations');
      const mockClient = await vi.mocked(getHubSpotClient)();
      vi.mocked(mockClient.crm.contacts.basicApi.getPage).mockResolvedValue({
        results: [
          { id: '1', properties: { email: 'active@test.com', membership_status: 'active', firstname: 'A', lastname: 'B' } },
          { id: '2', properties: { email: 'unknown@test.com', membership_status: 'unknown_status', firstname: 'C', lastname: 'D' } },
          { id: '3', properties: { email: 'trial@test.com', membership_status: 'trialing', firstname: 'E', lastname: 'F' } },
        ],
        paging: {},
      } as ReturnType<typeof mockClient.crm.contacts.basicApi.getPage> extends Promise<infer R> ? R : never);

      const { getAllHubSpotMembers } = await import('../server/core/trackman/matching');
      const result = await getAllHubSpotMembers();
      expect(result.length).toBe(2);
      expect(result[0].email).toBe('active@test.com');
      expect(result[1].email).toBe('trial@test.com');
    });

    it('returns empty array on HubSpot API error', async () => {
      const { getHubSpotClient } = await import('../server/core/integrations');
      const mockClient = await vi.mocked(getHubSpotClient)();
      vi.mocked(mockClient.crm.contacts.basicApi.getPage).mockRejectedValue(new Error('Rate limited'));

      const { getAllHubSpotMembers } = await import('../server/core/trackman/matching');
      const result = await getAllHubSpotMembers();
      expect(result).toEqual([]);
    });
  });
});
