import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/hubspot/readOnlyGuard', () => ({
  isHubSpotReadOnly: vi.fn().mockReturnValue(false),
  logHubSpotWriteSkipped: vi.fn(),
}));

const mockUpdate = vi.fn().mockResolvedValue({});
const mockDoSearch = vi.fn();

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: {
      contacts: {
        searchApi: { doSearch: (...args: unknown[]) => mockDoSearch(...args) },
        basicApi: { update: (...args: unknown[]) => mockUpdate(...args) },
      },
    },
  }),
  getHubSpotClientWithFallback: vi.fn().mockResolvedValue({
    client: {
      crm: { properties: { coreApi: { getByName: vi.fn(), create: vi.fn() } } },
    },
    source: 'connector',
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/stripe/customers', () => ({
  isPlaceholderEmail: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeEnvironmentInfo: vi.fn().mockResolvedValue({ isLive: false }),
}));

vi.mock('../server/core/hubspot/constants', () => ({
  DB_BILLING_PROVIDER_TO_HUBSPOT: {
    stripe: 'stripe',
    mindbody: 'mindbody',
    manual: 'manual',
    comped: 'Comped',
    none: 'None',
    family_addon: 'stripe',
  },
  getDbStatusToHubSpotMapping: vi.fn().mockResolvedValue({
    active: 'Active',
    trialing: 'trialing',
    past_due: 'past_due',
    inactive: 'Suspended',
    cancelled: 'Terminated',
    expired: 'Expired',
    terminated: 'Terminated',
    pending: 'Pending',
    suspended: 'Suspended',
    frozen: 'Froze',
  }),
}));

vi.mock('../server/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
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

vi.mock('@hubspot/api-client/lib/codegen/crm/contacts', () => ({
  FilterOperatorEnum: { Eq: 'EQ' },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
}));

vi.mock('../server/utils/tierUtils', () => ({
  denormalizeTierForHubSpotAsync: vi.fn().mockResolvedValue('Gold Membership'),
  CANONICAL_TIER_NAMES: {},
}));

describe('HubSpot Stages', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    const guard = await import('../server/core/hubspot/readOnlyGuard');
    vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(false);
  });

  describe('updateContactMembershipStatus', () => {
    it('updates a contact membership_status property', async () => {
      const { updateContactMembershipStatus } = await import('../server/core/hubspot/stages');
      const result = await updateContactMembershipStatus('contact-123', 'Active', 'admin');
      expect(result).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith('contact-123', {
        properties: { membership_status: 'Active' },
      });
    });

    it('returns false on API error', async () => {
      const { updateContactMembershipStatus } = await import('../server/core/hubspot/stages');
      mockUpdate.mockRejectedValueOnce(new Error('API error'));
      const result = await updateContactMembershipStatus('contact-456', 'Suspended', 'admin');
      expect(result).toBe(false);
    });

    it('skips write when read-only mode is active', async () => {
      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(true);
      const { updateContactMembershipStatus } = await import('../server/core/hubspot/stages');
      const result = await updateContactMembershipStatus('contact-789', 'Active', 'admin');
      expect(result).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('handles various valid status types', async () => {
      const { updateContactMembershipStatus } = await import('../server/core/hubspot/stages');
      const validStatuses = ['Active', 'trialing', 'past_due', 'Pending', 'Declined', 'Suspended', 'Expired', 'Froze', 'Terminated', 'Non-Member'] as const;
      for (const status of validStatuses) {
        mockUpdate.mockResolvedValue({});
        const result = await updateContactMembershipStatus(`c-${status}`, status, 'admin');
        expect(result).toBe(true);
      }
      expect(mockUpdate).toHaveBeenCalledTimes(validStatuses.length);
    });

    it('passes contact ID correctly to the API', async () => {
      const { updateContactMembershipStatus } = await import('../server/core/hubspot/stages');
      await updateContactMembershipStatus('hubspot-contact-abc', 'Active', 'system');
      expect(mockUpdate).toHaveBeenCalledWith('hubspot-contact-abc', expect.any(Object));
    });
  });

  describe('syncMemberToHubSpot', () => {
    it('skips placeholder emails', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(true);
      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      const result = await syncMemberToHubSpot({ email: 'placeholder@test.com' });
      expect(result.success).toBe(false);
    });

    it('searches HubSpot for contact by email', async () => {
      const { isPlaceholderEmail } = await import('../server/core/stripe/customers');
      vi.mocked(isPlaceholderEmail).mockReturnValue(false);
      mockDoSearch.mockResolvedValue({ results: [{ id: 'c-1', properties: {} }] });
      mockUpdate.mockResolvedValue({});
      const { syncMemberToHubSpot } = await import('../server/core/hubspot/stages');
      await syncMemberToHubSpot({ email: 'member@test.com' });
      expect(mockDoSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filterGroups: [{ filters: [expect.objectContaining({ value: 'member@test.com' })] }],
        })
      );
    });
  });
});
