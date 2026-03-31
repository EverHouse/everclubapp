// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AddMemberInput } from '../server/core/hubspot/members';
import type { SyncMemberToHubSpotInput } from '../server/core/hubspot/stages';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/hubspot/readOnlyGuard', () => ({
  isHubSpotReadOnly: vi.fn().mockReturnValue(false),
  logHubSpotWriteSkipped: vi.fn(),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: {
      contacts: {
        searchApi: { doSearch: vi.fn().mockResolvedValue({ results: [] }) },
        basicApi: { update: vi.fn(), create: vi.fn() },
      },
      companies: { basicApi: { create: vi.fn(), update: vi.fn() } },
    },
  }),
  getHubSpotClientWithFallback: vi.fn().mockResolvedValue({
    client: { crm: { properties: { coreApi: { getByName: vi.fn(), create: vi.fn() } } } },
    source: 'connector',
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/hubspot/constants', () => ({
  DB_BILLING_PROVIDER_TO_HUBSPOT: { stripe: 'stripe', manual: 'manual', mindbody: 'mindbody' },
  getDbStatusToHubSpotMapping: vi.fn().mockResolvedValue({ active: 'Active', cancelled: 'Cancelled', trialing: 'Trialing' }),
  DB_STATUS_TO_HUBSPOT_STATUS: { active: 'Active', cancelled: 'Cancelled', trialing: 'Trialing' },
}));

vi.mock('../server/core/stripe/customers', () => ({
  isPlaceholderEmail: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeEnvironmentInfo: vi.fn().mockResolvedValue({ isLive: false }),
}));

vi.mock('@hubspot/api-client/lib/codegen/crm/contacts', () => ({
  FilterOperatorEnum: { Eq: 'EQ' },
}));

const mockDbExecute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockDbSelect = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  users: { email: 'email', firstName: 'first_name', lastName: 'last_name', billingProvider: 'billing_provider' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
}));

vi.mock('../server/utils/tierUtils', () => ({
  denormalizeTierForHubSpotAsync: vi.fn().mockResolvedValue('Gold'),
  CANONICAL_TIER_NAMES: {},
}));

describe('HubSpot Deal/Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('syncNewMemberToHubSpot (deal creation - currently disabled)', () => {
    it('is a no-op that logs and returns immediately without calling HubSpot', async () => {
      const { syncNewMemberToHubSpot } = await import('../server/core/hubspot/members');
      const logger = await import('../server/core/logger');
      const { getHubSpotClient } = await import('../server/core/integrations');
      const input: AddMemberInput = {
        email: 'newmember@test.com',
        firstName: 'New',
        lastName: 'Member',
        tier: 'Gold',
        createdBy: 'admin',
      };
      await syncNewMemberToHubSpot(input);
      expect(vi.mocked(logger.logger.info)).toHaveBeenCalledWith(
        expect.stringContaining('Deal creation disabled')
      );
      expect(vi.mocked(getHubSpotClient)).not.toHaveBeenCalled();
    });

    it('does not create any CRM deals or write to the database', async () => {
      const { syncNewMemberToHubSpot } = await import('../server/core/hubspot/members');
      const input: AddMemberInput = {
        email: 'another@test.com',
        firstName: 'Another',
        lastName: 'User',
        tier: 'Silver',
        createdBy: 'admin',
      };
      const result = await syncNewMemberToHubSpot(input);
      expect(result).toBeUndefined();
      expect(mockDbExecute).not.toHaveBeenCalled();
    });
  });

  describe('syncMemberToHubSpot (field mapping and conflict resolution)', () => {
    it('skips placeholder emails and returns error', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(true);
      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const input: SyncMemberToHubSpotInput = { email: 'guest_123@trackman.com', status: 'active' };
      const result = await syncMemberToHubSpot(input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Placeholder email');
      expect(result.updated).toEqual({});
    });

    it('returns success without updates when read-only mode is active', async () => {
      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(true);
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(false);
      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const input: SyncMemberToHubSpotInput = { email: 'member@test.com', status: 'active' };
      const result = await syncMemberToHubSpot(input);
      expect(result.success).toBe(true);
      expect(result.updated).toEqual({});
      expect(vi.mocked(guard.logHubSpotWriteSkipped)).toHaveBeenCalledWith('sync_member', 'member@test.com');
    });

    it('maps active status to customer lifecycle stage and Active membership_status', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(false);
      const { getHubSpotClient } = await import('../server/core/integrations');
      const mockClient = await vi.mocked(getHubSpotClient)();
      const mockDoSearch = vi.mocked(mockClient.crm.contacts.searchApi.doSearch);
      mockDoSearch.mockResolvedValue({
        results: [{
          id: 'c-active',
          properties: { lifecyclestage: 'other', membership_status: '' }
        }]
      } as ReturnType<typeof mockDoSearch> extends Promise<infer R> ? R : never);
      const mockUpdate = vi.mocked(mockClient.crm.contacts.basicApi.update);
      mockUpdate.mockResolvedValue({} as ReturnType<typeof mockUpdate> extends Promise<infer R> ? R : never);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      });

      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(false);

      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const input: SyncMemberToHubSpotInput = { email: 'active@test.com', status: 'active' };
      const result = await syncMemberToHubSpot(input);
      expect(result.success).toBe(true);
      expect(result.updated.status).toBe(true);
      expect(result.contactId).toBe('c-active');
    });

    it('skips status push for MindBody-billed members to prevent sync loop', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(false);
      const { getHubSpotClient } = await import('../server/core/integrations');
      const mockClient = await vi.mocked(getHubSpotClient)();
      vi.mocked(mockClient.crm.contacts.searchApi.doSearch).mockResolvedValue({
        results: [{
          id: 'c-mb',
          properties: { lifecyclestage: 'customer', membership_status: 'Active' }
        }]
      } as ReturnType<typeof mockClient.crm.contacts.searchApi.doSearch> extends Promise<infer R> ? R : never);
      vi.mocked(mockClient.crm.contacts.basicApi.update).mockResolvedValue({} as ReturnType<typeof mockClient.crm.contacts.basicApi.update> extends Promise<infer R> ? R : never);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ billingProvider: 'mindbody' }]) }),
        }),
      });

      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(false);

      const logger = await import('../server/core/logger');
      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const input: SyncMemberToHubSpotInput = { email: 'mindbody@test.com', status: 'active' };
      await syncMemberToHubSpot(input);
      expect(vi.mocked(logger.logger.info)).toHaveBeenCalledWith(
        expect.stringContaining('Mindbody-billed member')
      );
    });

    it('returns contact not found when createIfMissing is false', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(false);
      const { getHubSpotClient } = await import('../server/core/integrations');
      const mockClient = await vi.mocked(getHubSpotClient)();
      vi.mocked(mockClient.crm.contacts.searchApi.doSearch).mockResolvedValue({
        results: []
      } as ReturnType<typeof mockClient.crm.contacts.searchApi.doSearch> extends Promise<infer R> ? R : never);

      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(false);

      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const input: SyncMemberToHubSpotInput = { email: 'missing@test.com', createIfMissing: false };
      const result = await syncMemberToHubSpot(input);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('syncTierToHubSpot', () => {
    it('skips sync when read-only mode is active and logs the skip', async () => {
      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(true);
      const { syncTierToHubSpot } = await import('../server/core/hubspot/members');
      await syncTierToHubSpot({
        email: 'tier@test.com',
        newTier: 'Gold',
        oldTier: 'Silver',
        changedBy: 'admin',
      });
      expect(vi.mocked(guard.logHubSpotWriteSkipped)).toHaveBeenCalledWith('sync_tier', 'tier@test.com');
    });
  });
});
