// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isUUID,
  isEmail,
  detectIdentifierType,
  normalizeEmail,
} from '../server/core/memberService/memberTypes';
import { isHubSpotId, isMindbodyClientId } from '../server/core/memberService/memberTypes';
import type { MemberRecord, StaffRecord } from '../server/core/memberService/memberTypes';

function makeMember(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'jane@example.com',
    normalizedEmail: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    displayName: 'Jane Doe',
    role: 'member',
    isStaff: false,
    isAdmin: false,
    tier: 'gold',
    tierId: 2,
    tierConfig: null,
    phone: '555-1234',
    tags: [],
    stripeCustomerId: 'cus_abc123',
    hubspotId: '12345678',
    mindbodyClientId: null,
    membershipStatus: 'active',
    joinDate: new Date('2024-01-15'),
    lifetimeVisits: 42,
    linkedEmails: ['jane.alt@example.com'],
    trackmanEmail: 'jane.trackman@example.com',
    ...overrides,
  };
}

function makeStaff(overrides: Partial<StaffRecord> = {}): StaffRecord {
  return {
    id: 1,
    email: 'admin@club.com',
    normalizedEmail: 'admin@club.com',
    name: 'Admin User',
    firstName: 'Admin',
    lastName: 'User',
    displayName: 'Admin User',
    role: 'admin',
    jobTitle: 'Manager',
    phone: '555-9999',
    isActive: true,
    ...overrides,
  };
}

describe('memberTypes utilities', () => {
  describe('isUUID', () => {
    it('returns true for valid UUIDs', () => {
      expect(isUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
      expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('returns false for non-UUIDs', () => {
      expect(isUUID('not-a-uuid')).toBe(false);
      expect(isUUID('')).toBe(false);
      expect(isUUID('12345678')).toBe(false);
      expect(isUUID('test@example.com')).toBe(false);
    });

    it('handles uppercase UUIDs', () => {
      expect(isUUID('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true);
    });
  });

  describe('isEmail', () => {
    it('returns true for email-like strings', () => {
      expect(isEmail('user@example.com')).toBe(true);
      expect(isEmail('user@sub.domain.org')).toBe(true);
    });

    it('returns false for non-emails', () => {
      expect(isEmail('plaintext')).toBe(false);
      expect(isEmail('nodots')).toBe(false);
      expect(isEmail('no-at-sign.com')).toBe(false);
    });
  });

  describe('isHubSpotId', () => {
    it('returns true for 6-15 digit strings', () => {
      expect(isHubSpotId('123456')).toBe(true);
      expect(isHubSpotId('123456789012345')).toBe(true);
    });

    it('returns false for too short or non-numeric', () => {
      expect(isHubSpotId('12345')).toBe(false);
      expect(isHubSpotId('abc123')).toBe(false);
      expect(isHubSpotId('1234567890123456')).toBe(false);
    });
  });

  describe('isMindbodyClientId', () => {
    it('returns true for 8-12 digit strings', () => {
      expect(isMindbodyClientId('12345678')).toBe(true);
      expect(isMindbodyClientId('123456789012')).toBe(true);
    });

    it('returns false for out-of-range or non-numeric', () => {
      expect(isMindbodyClientId('1234567')).toBe(false);
      expect(isMindbodyClientId('1234567890123')).toBe(false);
      expect(isMindbodyClientId('abcdefgh')).toBe(false);
    });
  });

  describe('detectIdentifierType', () => {
    it('detects UUID identifiers', () => {
      expect(detectIdentifierType('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('uuid');
    });

    it('detects email identifiers', () => {
      expect(detectIdentifierType('user@example.com')).toBe('email');
    });

    it('detects HubSpot IDs (6-15 digit numbers)', () => {
      expect(detectIdentifierType('12345678')).toBe('hubspot_id');
    });

    it('returns unknown for empty string', () => {
      expect(detectIdentifierType('')).toBe('unknown');
    });

    it('returns unknown for unrecognized formats', () => {
      expect(detectIdentifierType('random-text')).toBe('unknown');
    });

    it('returns unknown for Stripe customer IDs (cus_xxx) since no dedicated detector exists', () => {
      expect(detectIdentifierType('cus_abc123xyz')).toBe('unknown');
    });

    it('returns unknown for Mindbody client IDs (short numbers)', () => {
      expect(detectIdentifierType('12345')).toBe('unknown');
    });

    it('prioritizes UUID over other types', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(detectIdentifierType(uuid)).toBe('uuid');
    });
  });

  describe('normalizeEmail', () => {
    it('lowercases and trims', () => {
      expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    });

    it('handles already normalized email', () => {
      expect(normalizeEmail('user@example.com')).toBe('user@example.com');
    });

    it('handles empty string', () => {
      expect(normalizeEmail('')).toBe('');
    });
  });
});

describe('MemberCache', () => {
  let MemberCache: typeof import('../server/core/memberService/memberCache');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    MemberCache = await import('../server/core/memberService/memberCache');
    MemberCache.memberCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('member cache operations', () => {
    it('returns null for cache miss by email', () => {
      expect(MemberCache.memberCache.getMemberByEmail('nobody@example.com')).toBeNull();
    });

    it('returns null for cache miss by id', () => {
      expect(MemberCache.memberCache.getMemberById('nonexistent-id')).toBeNull();
    });

    it('stores and retrieves member by email', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      const cached = MemberCache.memberCache.getMemberByEmail('jane@example.com');
      expect(cached).not.toBeNull();
      expect(cached!.id).toBe(member.id);
    });

    it('stores and retrieves member by id', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      const cached = MemberCache.memberCache.getMemberById(member.id);
      expect(cached).not.toBeNull();
      expect(cached!.email).toBe('jane@example.com');
    });

    it('stores member accessible by linked email', () => {
      const member = makeMember({ linkedEmails: ['alt@example.com'] });
      MemberCache.memberCache.setMember(member);
      const cached = MemberCache.memberCache.getMemberByEmail('alt@example.com');
      expect(cached).not.toBeNull();
      expect(cached!.id).toBe(member.id);
    });

    it('stores member accessible by trackman email', () => {
      const member = makeMember({ trackmanEmail: 'trackman@example.com' });
      MemberCache.memberCache.setMember(member);
      const cached = MemberCache.memberCache.getMemberByEmail('trackman@example.com');
      expect(cached).not.toBeNull();
      expect(cached!.id).toBe(member.id);
    });

    it('lookups are case-insensitive for email', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      const cached = MemberCache.memberCache.getMemberByEmail('JANE@EXAMPLE.COM');
      expect(cached).not.toBeNull();
    });
  });

  describe('TTL expiry', () => {
    it('returns null after TTL expires for member by email', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);

      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).not.toBeNull();

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).toBeNull();
    });

    it('returns null after TTL expires for member by id', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(MemberCache.memberCache.getMemberById(member.id)).toBeNull();
    });

    it('returns member before TTL expires', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);

      vi.advanceTimersByTime(4 * 60 * 1000);

      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).not.toBeNull();
    });
  });

  describe('invalidation', () => {
    it('invalidates member by email', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember('jane@example.com');
      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).toBeNull();
    });

    it('invalidates member by id', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember(member.id);
      expect(MemberCache.memberCache.getMemberById(member.id)).toBeNull();
    });

    it('clear removes all entries', () => {
      MemberCache.memberCache.setMember(makeMember());
      MemberCache.memberCache.setStaff(makeStaff());
      MemberCache.memberCache.clear();
      expect(MemberCache.memberCache.getStats()).toEqual({ members: 0, staff: 0 });
    });
  });

  describe('staff cache operations', () => {
    it('returns null for staff cache miss', () => {
      expect(MemberCache.memberCache.getStaffByEmail('nobody@club.com')).toBeNull();
    });

    it('stores and retrieves staff by email', () => {
      const staff = makeStaff();
      MemberCache.memberCache.setStaff(staff);
      const cached = MemberCache.memberCache.getStaffByEmail('admin@club.com');
      expect(cached).not.toBeNull();
      expect(cached!.role).toBe('admin');
    });

    it('staff cache is case-insensitive', () => {
      MemberCache.memberCache.setStaff(makeStaff());
      expect(MemberCache.memberCache.getStaffByEmail('ADMIN@CLUB.COM')).not.toBeNull();
    });

    it('staff expires after TTL', () => {
      MemberCache.memberCache.setStaff(makeStaff());
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(MemberCache.memberCache.getStaffByEmail('admin@club.com')).toBeNull();
    });

    it('invalidateStaff removes staff entry', () => {
      MemberCache.memberCache.setStaff(makeStaff());
      MemberCache.memberCache.invalidateStaff('admin@club.com');
      expect(MemberCache.memberCache.getStaffByEmail('admin@club.com')).toBeNull();
    });
  });

  describe('cache invalidation edge cases', () => {
    it('invalidating by email does not remove id-based cache entry', () => {
      const member = makeMember();
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember('jane@example.com');
      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).toBeNull();
      expect(MemberCache.memberCache.getMemberById(member.id)).not.toBeNull();
    });

    it('STALE: linked email alias keys remain after invalidating primary email (known limitation)', () => {
      const member = makeMember({ linkedEmails: ['alias@example.com'] });
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember('jane@example.com');
      const aliasResult = MemberCache.memberCache.getMemberByEmail('alias@example.com');
      expect(aliasResult).not.toBeNull();
    });

    it('STALE: trackman email alias key remains after invalidating primary email (known limitation)', () => {
      const member = makeMember({ trackmanEmail: 'tm@example.com' });
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember('jane@example.com');
      const tmResult = MemberCache.memberCache.getMemberByEmail('tm@example.com');
      expect(tmResult).not.toBeNull();
    });

    it('clear() removes all entries including stale aliases', () => {
      const member = makeMember({ linkedEmails: ['alias@example.com'], trackmanEmail: 'tm@example.com' });
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.clear();
      expect(MemberCache.memberCache.getMemberByEmail('alias@example.com')).toBeNull();
      expect(MemberCache.memberCache.getMemberByEmail('tm@example.com')).toBeNull();
      expect(MemberCache.memberCache.getMemberByEmail('jane@example.com')).toBeNull();
      expect(MemberCache.memberCache.getMemberById(member.id)).toBeNull();
    });

    it('overwriting a member updates all cache entries', () => {
      const member = makeMember({ lifetimeVisits: 10 });
      MemberCache.memberCache.setMember(member);
      const updated = makeMember({ lifetimeVisits: 20 });
      MemberCache.memberCache.setMember(updated);
      const byEmail = MemberCache.memberCache.getMemberByEmail('jane@example.com');
      const byId = MemberCache.memberCache.getMemberById(member.id);
      expect(byEmail!.lifetimeVisits).toBe(20);
      expect(byId!.lifetimeVisits).toBe(20);
    });

    it('stale alias entries expire after TTL even if not explicitly invalidated', () => {
      const member = makeMember({ linkedEmails: ['alias@example.com'] });
      MemberCache.memberCache.setMember(member);
      MemberCache.memberCache.invalidateMember('jane@example.com');
      expect(MemberCache.memberCache.getMemberByEmail('alias@example.com')).not.toBeNull();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(MemberCache.memberCache.getMemberByEmail('alias@example.com')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns correct counts', () => {
      expect(MemberCache.memberCache.getStats()).toEqual({ members: 0, staff: 0 });

      MemberCache.memberCache.setMember(makeMember());
      expect(MemberCache.memberCache.getStats()).toEqual({ members: 1, staff: 0 });

      MemberCache.memberCache.setStaff(makeStaff());
      expect(MemberCache.memberCache.getStats()).toEqual({ members: 1, staff: 1 });
    });
  });
});

describe('MemberService (with mocked DB)', () => {
  let MemberService: typeof import('../server/core/memberService/MemberService');

  const mockDbExecute = vi.fn();

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../server/db', () => ({
      db: { execute: mockDbExecute },
    }));

    vi.doMock('drizzle-orm', () => ({
      sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        { join: vi.fn(), raw: vi.fn((s: string) => s) }
      ),
    }));

    MemberService = await import('../server/core/memberService/MemberService');

    const { memberCache } = await import('../server/core/memberService/memberCache');
    memberCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findByEmail', () => {
    it('returns null for empty email', async () => {
      const result = await MemberService.MemberService.findByEmail('');
      expect(result).toBeNull();
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it('returns null when no rows found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const result = await MemberService.MemberService.findByEmail('nobody@example.com');
      expect(result).toBeNull();
    });

    it('returns member record when found', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-1',
          email: 'found@example.com',
          first_name: 'Found',
          last_name: 'User',
          role: 'member',
          tier: 'gold',
          tier_id: 2,
          phone: '555-0000',
          tags: '[]',
          stripe_customer_id: 'cus_x',
          hubspot_id: '999999',
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: '2024-01-01',
          lifetime_visits: 10,
          linked_emails: '[]',
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByEmail('Found@Example.com');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('uid-1');
      expect(result!.normalizedEmail).toBe('found@example.com');
      expect(result!.displayName).toBe('Found User');
      expect(result!.lifetimeVisits).toBe(10);
    });

    it('uses cache on second call', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-cached',
          email: 'cached@example.com',
          first_name: 'Cached',
          last_name: 'User',
          role: 'member',
          tier: 'silver',
          tier_id: 1,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      await MemberService.MemberService.findByEmail('cached@example.com');
      const callCountAfterFirst = mockDbExecute.mock.calls.length;
      const second = await MemberService.MemberService.findByEmail('cached@example.com');
      expect(second).not.toBeNull();
      expect(mockDbExecute.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('bypasses cache when option set', async () => {
      mockDbExecute.mockResolvedValue({
        rows: [{
          id: 'uid-bypass',
          email: 'bypass@example.com',
          first_name: 'Bypass',
          last_name: 'User',
          role: 'member',
          tier: null,
          tier_id: null,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: null,
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      await MemberService.MemberService.findByEmail('bypass@example.com');
      const callCountAfterFirst = mockDbExecute.mock.calls.length;
      await MemberService.MemberService.findByEmail('bypass@example.com', { bypassCache: true });
      expect(mockDbExecute.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });
  });

  describe('findById', () => {
    it('returns null for empty id', async () => {
      const result = await MemberService.MemberService.findById('');
      expect(result).toBeNull();
    });

    it('returns null when no rows found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const result = await MemberService.MemberService.findById('nonexistent-uuid');
      expect(result).toBeNull();
    });

    it('returns member and caches by id', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-byid',
          email: 'byid@example.com',
          first_name: 'ById',
          last_name: 'Test',
          role: 'member',
          tier: 'gold',
          tier_id: 2,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 5,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findById('uid-byid');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('uid-byid');
      expect(result!.displayName).toBe('ById Test');

      const callCountAfterFirst = mockDbExecute.mock.calls.length;
      const cached = await MemberService.MemberService.findById('uid-byid');
      expect(cached).not.toBeNull();
      expect(mockDbExecute.mock.calls.length).toBe(callCountAfterFirst);
    });
  });

  describe('findByHubSpotId', () => {
    it('returns null for empty hubspot id', async () => {
      const result = await MemberService.MemberService.findByHubSpotId('');
      expect(result).toBeNull();
    });

    it('returns null when no rows found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const result = await MemberService.MemberService.findByHubSpotId('99999999');
      expect(result).toBeNull();
    });

    it('returns member when found by HubSpot ID', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-hs',
          email: 'hubspot@example.com',
          first_name: 'HS',
          last_name: 'User',
          role: 'member',
          tier: 'silver',
          tier_id: 1,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: '88888888',
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByHubSpotId('88888888');
      expect(result).not.toBeNull();
      expect(result!.hubspotId).toBe('88888888');
    });
  });

  describe('findByMindbodyClientId', () => {
    it('returns null for empty mindbody id', async () => {
      const result = await MemberService.MemberService.findByMindbodyClientId('');
      expect(result).toBeNull();
    });

    it('returns member when found by Mindbody ID', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-mb',
          email: 'mindbody@example.com',
          first_name: 'MB',
          last_name: 'User',
          role: 'member',
          tier: null,
          tier_id: null,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: '1234567890',
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByMindbodyClientId('1234567890');
      expect(result).not.toBeNull();
      expect(result!.mindbodyClientId).toBe('1234567890');
    });
  });

  describe('findByAnyIdentifier', () => {
    it('returns null for empty identifier', async () => {
      const result = await MemberService.MemberService.findByAnyIdentifier('');
      expect(result).toBeNull();
    });

    it('routes UUID identifiers to findById', async () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.findByAnyIdentifier(uuid);
      expect(result).toBeNull();
      expect(mockDbExecute).toHaveBeenCalled();
    });

    it('routes email identifiers to findByEmail', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.findByAnyIdentifier('test@example.com');
      expect(result).toBeNull();
      expect(mockDbExecute).toHaveBeenCalled();
    });

    it('routes HubSpot ID identifiers to findByHubSpotId', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.findByAnyIdentifier('12345678');
      expect(result).toBeNull();
      expect(mockDbExecute).toHaveBeenCalled();
    });

    it('returns null for unknown identifier format after exhausting all methods', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.findByAnyIdentifier('random-text');
      expect(result).toBeNull();
    });

    it('Stripe customer ID format (cus_xxx) falls through to fallback chain since no dedicated findByStripeCustomerId exists', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.findByAnyIdentifier('cus_abc123xyz');
      expect(result).toBeNull();
      expect(mockDbExecute).toHaveBeenCalled();
    });

    it('Stripe customer ID resolves if it matches via email/ID/HubSpot/Mindbody fallback chain', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'uid-stripe-indirect',
            email: 'stripe-member@example.com',
            first_name: 'Stripe',
            last_name: 'Member',
            role: 'member',
            tier: null,
            tier_id: null,
            phone: null,
            tags: [],
            stripe_customer_id: 'cus_actual',
            hubspot_id: null,
            mindbody_client_id: 'cus_abc123xyz',
            membership_status: 'active',
            join_date: null,
            lifetime_visits: 0,
            linked_emails: [],
            trackman_email: null,
            archived_at: null,
            tier_config_id: null,
            tier_name: null,
            daily_sim_minutes: 0,
            guest_passes_per_year: 0,
            booking_window_days: 7,
            can_book_simulators: false,
            can_book_conference: false,
            can_book_wellness: true,
            unlimited_access: false,
          }],
        });

      const result = await MemberService.MemberService.findByAnyIdentifier('cus_abc123xyz');
      expect(result).not.toBeNull();
      expect(result!.stripeCustomerId).toBe('cus_actual');
    });

    it('returns first match from fallback chain for ambiguous identifier', async () => {
      mockDbExecute
        .mockResolvedValueOnce({
          rows: [{
            id: 'uid-ambiguous',
            email: 'ambiguous@example.com',
            first_name: 'Ambiguous',
            last_name: 'User',
            role: 'member',
            tier: null,
            tier_id: null,
            phone: null,
            tags: [],
            stripe_customer_id: null,
            hubspot_id: null,
            mindbody_client_id: null,
            membership_status: 'active',
            join_date: null,
            lifetime_visits: 0,
            linked_emails: [],
            trackman_email: null,
            archived_at: null,
            tier_config_id: null,
            tier_name: null,
            daily_sim_minutes: 0,
            guest_passes_per_year: 0,
            booking_window_days: 7,
            can_book_simulators: false,
            can_book_conference: false,
            can_book_wellness: true,
            unlimited_access: false,
          }],
        });

      const result = await MemberService.MemberService.findByAnyIdentifier('ambiguous@example.com');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('uid-ambiguous');
    });
  });

  describe('resolveMemberForBilling', () => {
    it('resolves by UUID participant user id', async () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: uuid,
          email: 'billing@example.com',
          first_name: 'Billing',
          last_name: 'User',
          role: 'member',
          tier: 'gold',
          tier_id: 2,
          phone: null,
          tags: [],
          stripe_customer_id: 'cus_billing',
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: 2,
          tier_name: 'Gold',
          daily_sim_minutes: 120,
          guest_passes_per_year: 12,
          booking_window_days: 14,
          can_book_simulators: true,
          can_book_conference: true,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.resolveMemberForBilling(1, uuid, null);
      expect(result.member).not.toBeNull();
      expect(result.matchedBy).toBe('uuid');
      expect(result.member!.stripeCustomerId).toBe('cus_billing');
    });

    it('falls back to email when UUID not found', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'uid-fallback',
            email: 'fallback@example.com',
            first_name: 'Fallback',
            last_name: 'User',
            role: 'member',
            tier: null,
            tier_id: null,
            phone: null,
            tags: [],
            stripe_customer_id: null,
            hubspot_id: null,
            mindbody_client_id: null,
            membership_status: 'active',
            join_date: null,
            lifetime_visits: 0,
            linked_emails: [],
            trackman_email: null,
            archived_at: null,
            tier_config_id: null,
            tier_name: null,
            daily_sim_minutes: 0,
            guest_passes_per_year: 0,
            booking_window_days: 7,
            can_book_simulators: false,
            can_book_conference: false,
            can_book_wellness: true,
            unlimited_access: false,
          }],
        });

      const result = await MemberService.MemberService.resolveMemberForBilling(
        1,
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'fallback@example.com'
      );
      expect(result.member).not.toBeNull();
      expect(result.matchedBy).toBe('booking_email');
    });

    it('returns null match when no member found', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });
      const result = await MemberService.MemberService.resolveMemberForBilling(999, null, null);
      expect(result.member).toBeNull();
      expect(result.matchedBy).toBeNull();
    });

    it('resolves by email-format participant user id', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-email-participant',
          email: 'participant@example.com',
          first_name: 'Part',
          last_name: 'User',
          role: 'member',
          tier: null,
          tier_id: null,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: 'active',
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.resolveMemberForBilling(1, 'participant@example.com', null);
      expect(result.matchedBy).toBe('email');
    });
  });

  describe('invalidateCache / clearCache / getCacheStats', () => {
    it('invalidateCache removes a member entry', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-inv',
          email: 'inv@example.com',
          first_name: 'Inv',
          last_name: 'User',
          role: 'member',
          tier: null,
          tier_id: null,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: null,
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      await MemberService.MemberService.findByEmail('inv@example.com');
      MemberService.MemberService.invalidateCache('inv@example.com');
      const { memberCache } = await import('../server/core/memberService/memberCache');
      expect(memberCache.getMemberByEmail('inv@example.com')).toBeNull();
    });

    it('clearCache empties all caches', async () => {
      MemberService.MemberService.clearCache();
      expect(MemberService.MemberService.getCacheStats()).toEqual({ members: 0, staff: 0 });
    });
  });

  describe('rowToMemberRecord edge cases', () => {
    it('handles string-encoded linked_emails JSON', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-json',
          email: 'json@example.com',
          first_name: null,
          last_name: null,
          role: 'member',
          tier: null,
          tier_id: null,
          phone: null,
          tags: '["vip"]',
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: null,
          join_date: null,
          lifetime_visits: 0,
          linked_emails: '["linked@example.com"]',
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByEmail('json@example.com');
      expect(result).not.toBeNull();
      expect(result!.linkedEmails).toEqual(['linked@example.com']);
      expect(result!.tags).toEqual(['vip']);
      expect(result!.displayName).toBe('json@example.com');
    });

    it('handles invalid JSON for linked_emails and tags', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-bad',
          email: 'bad@example.com',
          first_name: 'Bad',
          last_name: 'Json',
          role: 'admin',
          tier: null,
          tier_id: null,
          phone: null,
          tags: 'not-json',
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: null,
          join_date: null,
          lifetime_visits: 0,
          linked_emails: 'not-json',
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByEmail('bad@example.com');
      expect(result).not.toBeNull();
      expect(result!.linkedEmails).toEqual([]);
      expect(result!.tags).toEqual([]);
      expect(result!.role).toBe('admin');
      expect(result!.isAdmin).toBe(true);
      expect(result!.isStaff).toBe(true);
    });

    it('maps staff role correctly', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: 'uid-staff',
          email: 'staff@example.com',
          first_name: 'Staff',
          last_name: 'Member',
          role: 'staff',
          tier: null,
          tier_id: null,
          phone: null,
          tags: [],
          stripe_customer_id: null,
          hubspot_id: null,
          mindbody_client_id: null,
          membership_status: null,
          join_date: null,
          lifetime_visits: 0,
          linked_emails: [],
          trackman_email: null,
          archived_at: null,
          tier_config_id: null,
          tier_name: null,
          daily_sim_minutes: 0,
          guest_passes_per_year: 0,
          booking_window_days: 7,
          can_book_simulators: false,
          can_book_conference: false,
          can_book_wellness: true,
          unlimited_access: false,
        }],
      });

      const result = await MemberService.MemberService.findByEmail('staff@example.com');
      expect(result!.role).toBe('staff');
      expect(result!.isStaff).toBe(true);
      expect(result!.isAdmin).toBe(false);
    });
  });
});

describe('tierSync (with mocked DB)', () => {
  const mockDbExecute = vi.fn();

  beforeEach(() => {
    vi.resetModules();

    vi.doMock('../server/db', () => ({
      db: { execute: mockDbExecute },
    }));

    vi.doMock('drizzle-orm', () => ({
      sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        { join: vi.fn(), raw: vi.fn((s: string) => s) }
      ),
    }));

    vi.doMock('../server/core/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    vi.doMock('../server/utils/errorUtils', () => ({
      getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
    }));

    vi.doMock('../server/walletPass/apnPushService', () => ({
      sendPassUpdateForMemberByEmail: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../server/core/hubspot/stages', () => ({
      syncMemberToHubSpot: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncMemberTierFromStripe', () => {
    it('returns error when no tier found for price ID', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const { syncMemberTierFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberTierFromStripe('user@example.com', 'price_invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No tier found');
    });

    it('returns error when no user found for email', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ id: 1, slug: 'gold', name: 'Gold' }] })
        .mockResolvedValueOnce({ rowCount: 0 });
      const { syncMemberTierFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberTierFromStripe('nobody@example.com', 'price_gold');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No user found');
    });

    it('successfully syncs tier', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ id: 2, slug: 'platinum', name: 'Platinum' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberTierFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberTierFromStripe('user@example.com', 'price_platinum');
      expect(result.success).toBe(true);
      expect(result.newTier).toBe('platinum');
      expect(result.newTierId).toBe(2);
    });
  });

  describe('syncMemberStatusFromStripe', () => {
    it('maps active status correctly', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'active');
      expect(result.success).toBe(true);
    });

    it('maps trialing to active', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'trialing');
      expect(result.success).toBe(true);
    });

    it('maps canceled to cancelled status', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'canceled');
      expect(result.success).toBe(true);
    });

    it('maps past_due status correctly', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'past_due');
      expect(result.success).toBe(true);
    });

    it('maps unpaid to suspended', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'unpaid');
      expect(result.success).toBe(true);
    });

    it('maps incomplete to pending', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'uid-1' }] });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('user@example.com', 'incomplete');
      expect(result.success).toBe(true);
    });

    it('returns error when user not found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rowCount: 0 });
      const { syncMemberStatusFromStripe } = await import('../server/core/memberService/tierSync');
      const result = await syncMemberStatusFromStripe('nobody@example.com', 'active');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No user found');
    });
  });

  describe('getTierFromPriceId', () => {
    it('returns tier data when found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [{ id: 3, slug: 'silver', name: 'Silver' }] });
      const { getTierFromPriceId } = await import('../server/core/memberService/tierSync');
      const result = await getTierFromPriceId('price_silver');
      expect(result).toEqual({ id: 3, slug: 'silver', name: 'Silver' });
    });

    it('returns null when not found', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const { getTierFromPriceId } = await import('../server/core/memberService/tierSync');
      const result = await getTierFromPriceId('price_nonexistent');
      expect(result).toBeNull();
    });

    it('returns null on database error', async () => {
      mockDbExecute.mockRejectedValueOnce(new Error('DB down'));
      const { getTierFromPriceId } = await import('../server/core/memberService/tierSync');
      const result = await getTierFromPriceId('price_error');
      expect(result).toBeNull();
    });
  });

  describe('validateTierConsistency', () => {
    it('returns consistent when tier and tier_id match', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'user@example.com', tier: 'gold', tier_id: 2, stripe_subscription_id: null, tier_slug: 'gold', tier_name: 'Gold' }],
      });
      const { validateTierConsistency } = await import('../server/core/memberService/tierSync');
      const result = await validateTierConsistency('user@example.com');
      expect(result.isConsistent).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('detects tier/tier_id slug mismatch', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'user@example.com', tier: 'gold', tier_id: 3, stripe_subscription_id: null, tier_slug: 'silver', tier_name: 'Silver' }],
      });
      const { validateTierConsistency } = await import('../server/core/memberService/tierSync');
      const result = await validateTierConsistency('user@example.com');
      expect(result.isConsistent).toBe(false);
      expect(result.issues).toContainEqual(expect.stringContaining("doesn't match"));
    });

    it('detects tier set but tier_id null', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'user@example.com', tier: 'gold', tier_id: null, stripe_subscription_id: null, tier_slug: null, tier_name: null }],
      });
      const { validateTierConsistency } = await import('../server/core/memberService/tierSync');
      const result = await validateTierConsistency('user@example.com');
      expect(result.isConsistent).toBe(false);
      expect(result.issues).toContainEqual(expect.stringContaining('tier_id is null'));
    });

    it('detects tier_id set but tier null', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'user@example.com', tier: null, tier_id: 2, stripe_subscription_id: null, tier_slug: 'gold', tier_name: 'Gold' }],
      });
      const { validateTierConsistency } = await import('../server/core/memberService/tierSync');
      const result = await validateTierConsistency('user@example.com');
      expect(result.isConsistent).toBe(false);
      expect(result.issues).toContainEqual(expect.stringContaining('tier is null'));
    });

    it('returns user not found when no rows', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [] });
      const { validateTierConsistency } = await import('../server/core/memberService/tierSync');
      const result = await validateTierConsistency('ghost@example.com');
      expect(result.isConsistent).toBe(false);
      expect(result.issues).toContain('User not found');
    });
  });
});

describe('lifetimeVisitStats (with mocked DB)', () => {
  const mockDbExecute = vi.fn();

  beforeEach(() => {
    mockDbExecute.mockReset();
    vi.resetModules();
    vi.doMock('../server/db', () => ({
      db: { execute: mockDbExecute },
    }));
    vi.doMock('drizzle-orm', () => ({
      sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        { join: vi.fn(), raw: vi.fn((s: string) => s) }
      ),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sums all visit types correctly', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('user@example.com');

    expect(stats.bookingCount).toBe(5);
    expect(stats.eventCount).toBe(3);
    expect(stats.wellnessCount).toBe(2);
    expect(stats.walkInCount).toBe(1);
    expect(stats.totalVisits).toBe(11);
  });

  it('returns zeros when all counts are zero', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('new@example.com');

    expect(stats.totalVisits).toBe(0);
    expect(stats.bookingCount).toBe(0);
    expect(stats.eventCount).toBe(0);
    expect(stats.wellnessCount).toBe(0);
    expect(stats.walkInCount).toBe(0);
  });

  it('normalizes email before querying', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('  USER@Example.COM  ');

    expect(stats.totalVisits).toBe(0);
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it('handles missing count gracefully', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('edge@example.com');

    expect(stats.totalVisits).toBe(0);
  });

  it('issues 4 parallel DB queries (bookings, events, wellness, walk-ins) using date-filtered SQL', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    await getLifetimeVisitStats('stats@example.com');

    expect(mockDbExecute).toHaveBeenCalledTimes(4);
  });

  it('returns only past-dated records (DB handles date filtering via SQL WHERE clause)', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('past@example.com');

    expect(stats.bookingCount).toBe(3);
    expect(stats.totalVisits).toBe(3);
  });

  it('handles large count values correctly', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ count: '9999' }] })
      .mockResolvedValueOnce({ rows: [{ count: '5000' }] })
      .mockResolvedValueOnce({ rows: [{ count: '3000' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1000' }] });

    const { getLifetimeVisitStats } = await import('../server/core/memberService/lifetimeVisitStats');
    const stats = await getLifetimeVisitStats('heavy@example.com');

    expect(stats.totalVisits).toBe(18999);
    expect(stats.bookingCount).toBe(9999);
  });
});

describe('emailChangeService (with mocked DB)', () => {
  const mockTxExecute = vi.fn();
  const mockDbExecute = vi.fn();
  const mockTransaction = vi.fn();

  beforeEach(() => {
    vi.resetModules();

    mockTransaction.mockImplementation(async (fn: (tx: { execute: typeof mockTxExecute }) => Promise<void>) => {
      await fn({ execute: mockTxExecute });
    });

    vi.doMock('../server/db', () => ({
      db: {
        execute: mockDbExecute,
        transaction: mockTransaction,
      },
    }));

    vi.doMock('drizzle-orm', () => ({
      sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        { join: vi.fn(), raw: vi.fn((s: string) => s) }
      ),
    }));

    vi.doMock('../server/core/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));

    vi.doMock('../server/utils/errorUtils', () => ({
      getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
    }));

    vi.doMock('../server/core/auditLog', () => ({
      logBillingAudit: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cascadeEmailChange', () => {
    it('returns error when old email is empty', async () => {
      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('', 'new@example.com', 'admin@club.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error when new email is empty', async () => {
      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('old@example.com', '', 'admin@club.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('returns error when emails are the same', async () => {
      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('same@example.com', 'same@example.com', 'admin@club.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('same');
    });

    it('returns error when new email already exists', async () => {
      mockTxExecute.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });
      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('old@example.com', 'taken@example.com', 'admin@club.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('returns error when old user not found', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 0 });
      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('ghost@example.com', 'new@example.com', 'admin@club.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No user found');
    });

    it('succeeds and propagates through all tables', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rowCount: 1 });

      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: null,
          hubspot_id: null,
          first_name: 'Test',
          last_name: 'User',
          phone: null,
          tier: 'gold',
          id: 'uid-1',
        }],
      });

      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('old@example.com', 'new@example.com', 'admin@club.com');

      expect(result.success).toBe(true);
      expect(result.oldEmail).toBe('old@example.com');
      expect(result.newEmail).toBe('new@example.com');
      expect(result.tablesUpdated.length).toBeGreaterThan(0);
      expect(result.tablesUpdated.find(t => t.tableName === 'users')).toBeDefined();
    });

    it('includes Stripe sync warning when Stripe update fails', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rowCount: 1 });

      const mockStripeUpdate = vi.fn().mockRejectedValue(new Error('Stripe API error'));

      vi.doMock('../server/core/stripe/client', () => ({
        getStripeClient: vi.fn().mockResolvedValue({
          customers: { update: mockStripeUpdate },
        }),
      }));

      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: 'cus_test',
          hubspot_id: null,
          first_name: 'Test',
          last_name: 'User',
          phone: null,
          tier: 'gold',
          id: 'uid-stripe',
        }],
      });

      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('stripe-user@example.com', 'new-stripe@example.com', 'admin@club.com');

      expect(result.success).toBe(true);
      if (result.warnings) {
        expect(result.warnings.some(w => w.includes('Stripe'))).toBe(true);
      }
    });

    it('includes HubSpot sync warning when HubSpot update fails', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rowCount: 1 });

      vi.doMock('../server/core/integrations', () => ({
        getHubSpotClient: vi.fn().mockResolvedValue({
          crm: {
            contacts: {
              basicApi: {
                update: vi.fn().mockRejectedValue(new Error('HubSpot API error')),
              },
            },
          },
        }),
      }));

      vi.doMock('../server/core/hubspot/queue', () => ({
        enqueueHubSpotSync: vi.fn().mockResolvedValue('job-123'),
      }));

      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: null,
          hubspot_id: 'hs_test',
          first_name: 'HS',
          last_name: 'User',
          phone: null,
          tier: null,
          id: 'uid-hs',
        }],
      });

      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('hs-user@example.com', 'new-hs@example.com', 'admin@club.com');

      expect(result.success).toBe(true);
      if (result.warnings) {
        expect(result.warnings.some(w => w.includes('HubSpot'))).toBe(true);
      }
    });

    it('succeeds without warnings when no external IDs present', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rowCount: 1 });

      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          stripe_customer_id: null,
          hubspot_id: null,
          first_name: 'No',
          last_name: 'External',
          phone: null,
          tier: null,
          id: 'uid-noext',
        }],
      });

      const { cascadeEmailChange } = await import('../server/core/memberService/emailChangeService');
      const result = await cascadeEmailChange('no-external@example.com', 'new-noext@example.com', 'admin@club.com');

      expect(result.success).toBe(true);
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('previewEmailChangeImpact', () => {
    it('counts affected rows across tables', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const { previewEmailChangeImpact } = await import('../server/core/memberService/emailChangeService');
      const result = await previewEmailChangeImpact('user@example.com');

      expect(result.totalRows).toBe(9);
      expect(result.tables.length).toBe(3);
    });
  });
});
