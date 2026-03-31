import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn().mockImplementation((_key: string, defaultVal: string) => Promise.resolve(defaultVal)),
}));

describe('HubSpot Constants', () => {
  describe('DB_STATUS_TO_HUBSPOT_STATUS', () => {
    it('maps active to Active', async () => {
      const { DB_STATUS_TO_HUBSPOT_STATUS } = await import('../server/core/hubspot/constants');
      expect(DB_STATUS_TO_HUBSPOT_STATUS['active']).toBe('Active');
    });

    it('maps cancelled to Terminated', async () => {
      const { DB_STATUS_TO_HUBSPOT_STATUS } = await import('../server/core/hubspot/constants');
      expect(DB_STATUS_TO_HUBSPOT_STATUS['cancelled']).toBe('Terminated');
    });

    it('maps frozen to Froze', async () => {
      const { DB_STATUS_TO_HUBSPOT_STATUS } = await import('../server/core/hubspot/constants');
      expect(DB_STATUS_TO_HUBSPOT_STATUS['frozen']).toBe('Froze');
    });

    it('maps all expected statuses', async () => {
      const { DB_STATUS_TO_HUBSPOT_STATUS } = await import('../server/core/hubspot/constants');
      const expectedStatuses = [
        'active', 'trialing', 'past_due', 'inactive', 'cancelled',
        'expired', 'terminated', 'former_member', 'pending',
        'suspended', 'frozen', 'non-member', 'declined', 'deleted',
      ];
      for (const status of expectedStatuses) {
        expect(DB_STATUS_TO_HUBSPOT_STATUS[status]).toBeDefined();
      }
    });
  });

  describe('MINDBODY_TO_CONTACT_STATUS_MAP', () => {
    it('maps frozen and froze to the same HubSpot status', async () => {
      const { MINDBODY_TO_CONTACT_STATUS_MAP } = await import('../server/core/hubspot/constants');
      expect(MINDBODY_TO_CONTACT_STATUS_MAP['frozen']).toBe('Froze');
      expect(MINDBODY_TO_CONTACT_STATUS_MAP['froze']).toBe('Froze');
    });
  });

  describe('DB_BILLING_PROVIDER_TO_HUBSPOT', () => {
    it('maps stripe to stripe', async () => {
      const { DB_BILLING_PROVIDER_TO_HUBSPOT } = await import('../server/core/hubspot/constants');
      expect(DB_BILLING_PROVIDER_TO_HUBSPOT['stripe']).toBe('stripe');
    });

    it('maps family_addon to stripe', async () => {
      const { DB_BILLING_PROVIDER_TO_HUBSPOT } = await import('../server/core/hubspot/constants');
      expect(DB_BILLING_PROVIDER_TO_HUBSPOT['family_addon']).toBe('stripe');
    });

    it('maps comped to Comped', async () => {
      const { DB_BILLING_PROVIDER_TO_HUBSPOT } = await import('../server/core/hubspot/constants');
      expect(DB_BILLING_PROVIDER_TO_HUBSPOT['comped']).toBe('Comped');
    });
  });

  describe('ACTIVE_STATUSES, INACTIVE_STATUSES, CHURNED_STATUSES', () => {
    it('ACTIVE_STATUSES includes active, trialing, past_due', async () => {
      const { ACTIVE_STATUSES } = await import('../server/core/hubspot/constants');
      expect(ACTIVE_STATUSES).toContain('active');
      expect(ACTIVE_STATUSES).toContain('trialing');
      expect(ACTIVE_STATUSES).toContain('past_due');
    });

    it('CHURNED_STATUSES includes terminated and cancelled', async () => {
      const { CHURNED_STATUSES } = await import('../server/core/hubspot/constants');
      expect(CHURNED_STATUSES).toContain('terminated');
      expect(CHURNED_STATUSES).toContain('cancelled');
    });

    it('no status appears in both ACTIVE and CHURNED', async () => {
      const { ACTIVE_STATUSES, CHURNED_STATUSES, INACTIVE_STATUSES } = await import('../server/core/hubspot/constants');
      for (const s of ACTIVE_STATUSES) {
        expect(CHURNED_STATUSES).not.toContain(s);
        expect(INACTIVE_STATUSES).not.toContain(s);
      }
    });
  });

  describe('getDbStatusToHubSpotMapping', () => {
    it('returns the default mapping when no settings override', async () => {
      const { getDbStatusToHubSpotMapping } = await import('../server/core/hubspot/constants');
      const mapping = await getDbStatusToHubSpotMapping();
      expect(mapping['active']).toBe('Active');
      expect(mapping['cancelled']).toBe('Terminated');
    });
  });

  describe('getDbTierToHubSpot', () => {
    it('returns tier mapping including founding member variants', async () => {
      const { getDbTierToHubSpot } = await import('../server/core/hubspot/constants');
      const map = getDbTierToHubSpot();
      const keys = Object.keys(map);
      expect(keys.length).toBeGreaterThan(0);
      const foundingKeys = keys.filter(k => k.includes('founding'));
      expect(foundingKeys.length).toBeGreaterThan(0);
    });
  });
});
