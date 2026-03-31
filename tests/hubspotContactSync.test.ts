// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockUpdate = vi.fn().mockResolvedValue({});
const mockDoSearch = vi.fn();
const mockCreate = vi.fn();

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: {
      contacts: {
        searchApi: { doSearch: (...args: unknown[]) => mockDoSearch(...args) },
        basicApi: {
          update: (...args: unknown[]) => mockUpdate(...args),
          create: (...args: unknown[]) => mockCreate(...args),
        },
      },
    },
  }),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/hubspot/readOnlyGuard', () => ({
  isHubSpotReadOnly: vi.fn().mockReturnValue(false),
  logHubSpotWriteSkipped: vi.fn(),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
  getErrorStatusCode: vi.fn(),
}));

vi.mock('@hubspot/api-client/lib/codegen/crm/contacts', () => ({
  FilterOperatorEnum: { Eq: 'EQ' },
}));

describe('HubSpot Contact Sync', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    const guard = await import('../server/core/hubspot/readOnlyGuard');
    vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(false);
  });

  describe('syncSmsPreferencesToHubSpot', () => {
    it('normalizes email to lowercase and trims whitespace', async () => {
      const { syncSmsPreferencesToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [{ id: '123' }] });
      await syncSmsPreferencesToHubSpot(' Test@Example.COM ', {
        smsPromoOptIn: true,
        smsTransactionalOptIn: null,
        smsRemindersOptIn: false,
      });
      expect(mockDoSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          filterGroups: [{ filters: [expect.objectContaining({ value: 'test@example.com' })] }],
        })
      );
    });

    it('maps SMS preferences to correct HubSpot properties', async () => {
      const { syncSmsPreferencesToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [{ id: '456' }] });
      await syncSmsPreferencesToHubSpot('user@test.com', {
        smsPromoOptIn: true,
        smsTransactionalOptIn: false,
        smsRemindersOptIn: null,
      });
      expect(mockUpdate).toHaveBeenCalledWith('456', {
        properties: {
          hs_sms_promotional: 'true',
          hs_sms_customer_updates: 'false',
        },
      });
    });

    it('returns success:true with no update when all preferences are null', async () => {
      const { syncSmsPreferencesToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [{ id: '789' }] });
      const result = await syncSmsPreferencesToHubSpot('user@test.com', {
        smsPromoOptIn: null,
        smsTransactionalOptIn: null,
        smsRemindersOptIn: null,
      });
      expect(result.success).toBe(true);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('returns error when contact not found', async () => {
      const { syncSmsPreferencesToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [] });
      const result = await syncSmsPreferencesToHubSpot('missing@test.com', {
        smsPromoOptIn: true,
        smsTransactionalOptIn: null,
        smsRemindersOptIn: null,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Contact not found in HubSpot');
    });

    it('skips write when read-only mode is active', async () => {
      const guard = await import('../server/core/hubspot/readOnlyGuard');
      vi.mocked(guard.isHubSpotReadOnly).mockReturnValue(true);
      const { syncSmsPreferencesToHubSpot } = await import('../server/core/hubspot/contacts');
      const result = await syncSmsPreferencesToHubSpot('user@test.com', {
        smsPromoOptIn: true,
        smsTransactionalOptIn: null,
        smsRemindersOptIn: null,
      });
      expect(result.success).toBe(true);
      expect(mockDoSearch).not.toHaveBeenCalled();
    });
  });

  describe('syncProfileDetailsToHubSpot', () => {
    it('maps profile fields to HubSpot property names', async () => {
      const { syncProfileDetailsToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [{ id: '100' }] });
      await syncProfileDetailsToHubSpot('user@test.com', {
        dateOfBirth: '1990-01-15',
        streetAddress: '123 Main St',
        city: 'Portland',
        state: 'OR',
        zipCode: '97201',
      });
      expect(mockUpdate).toHaveBeenCalledWith('100', {
        properties: {
          date_of_birth: '1990-01-15',
          address: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zip: '97201',
        },
      });
    });

    it('returns error when contact not found', async () => {
      const { syncProfileDetailsToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [] });
      const result = await syncProfileDetailsToHubSpot('missing@test.com', {
        dateOfBirth: '1990-01-01',
        streetAddress: null,
        city: null,
        state: null,
        zipCode: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('syncDayPassPurchaseToHubSpot', () => {
    it('creates new contact as lead when not found', async () => {
      const { syncDayPassPurchaseToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({ results: [] });
      mockCreate.mockResolvedValue({ id: 'new-contact-1' });
      const result = await syncDayPassPurchaseToHubSpot({
        email: 'visitor@test.com',
        firstName: 'Jane',
        lastName: 'Doe',
        productName: 'Day Pass',
        amountCents: 5000,
        purchaseDate: new Date('2026-03-15'),
      });
      expect(result.success).toBe(true);
      expect(result.contactId).toBe('new-contact-1');
    });

    it('uses existing contact when found with lifecycle customer', async () => {
      const { syncDayPassPurchaseToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockResolvedValue({
        results: [{ id: 'existing-1', properties: { lifecyclestage: 'customer', firstname: 'A', lastname: 'B' } }],
      });
      const result = await syncDayPassPurchaseToHubSpot({
        email: 'member@test.com',
        productName: 'Day Pass',
        amountCents: 3000,
        purchaseDate: new Date('2026-03-15'),
      });
      expect(result.success).toBe(true);
      expect(result.contactId).toBe('existing-1');
    });

    it('continues to create contact when search fails', async () => {
      const { syncDayPassPurchaseToHubSpot } = await import('../server/core/hubspot/contacts');
      mockDoSearch.mockRejectedValue(new Error('Search failed'));
      mockCreate.mockResolvedValue({ id: 'fallback-1' });
      const result = await syncDayPassPurchaseToHubSpot({
        email: 'test@test.com',
        firstName: 'Test',
        productName: 'Day Pass',
        amountCents: 2500,
        purchaseDate: new Date('2026-03-15'),
      });
      expect(result.success).toBe(true);
    });
  });
});
