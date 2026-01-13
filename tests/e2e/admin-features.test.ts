import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BASE_URL, assertServerAvailable, login, fetchWithSession, TestSession } from './setup';

describe('Admin Features E2E Tests', () => {
  const adminEmail = 'test-admin@example.com';
  const staffEmail = 'test-staff@example.com';
  let adminSession: TestSession;
  let staffSession: TestSession;

  beforeAll(async () => {
    await assertServerAvailable();
    adminSession = await login(adminEmail, 'admin');
    staffSession = await login(staffEmail, 'staff');
  });

  describe('Closure Reasons Management', () => {
    let createdReasonId: number | null = null;

    it('should fetch closure reasons list', async () => {
      const response = await fetch(`${BASE_URL}/api/closure-reasons`);
      expect(response.ok).toBe(true);
      
      const reasons = await response.json();
      expect(Array.isArray(reasons)).toBe(true);
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons[0]).toHaveProperty('id');
      expect(reasons[0]).toHaveProperty('label');
    });

    it('should allow admin to create closure reason', async () => {
      if (!adminSession) {
        expect.fail('Failed to establish admin test session');
      }

      const uniqueLabel = `Test Closure Reason ${Date.now()}`;
      const response = await fetchWithSession('/api/closure-reasons', adminSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: uniqueLabel, sortOrder: 999 })
      });
      
      expect(response.ok).toBe(true);
      const reason = await response.json();
      expect(reason.label).toContain('Test Closure Reason');
      createdReasonId = reason.id;
    });

    it('should allow admin to update closure reason', async () => {
      if (!adminSession) {
        expect.fail('Failed to establish admin test session');
      }
      if (!createdReasonId) {
        expect.fail('No closure reason was created in previous test');
      }

      const updatedLabel = `Updated Test Reason ${Date.now()}`;
      const response = await fetchWithSession(`/api/closure-reasons/${createdReasonId}`, adminSession, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: updatedLabel, sort_order: 998 })
      });
      
      expect(response.ok).toBe(true);
      const reason = await response.json();
      expect(reason.label).toContain('Updated Test Reason');
    });

    it('should allow admin to delete closure reason', async () => {
      if (!adminSession) {
        expect.fail('Failed to establish admin test session');
      }
      if (!createdReasonId) {
        expect.fail('No closure reason was created in previous test');
      }

      const response = await fetchWithSession(`/api/closure-reasons/${createdReasonId}`, adminSession, {
        method: 'DELETE'
      });
      
      expect(response.ok).toBe(true);
    });
  });

  describe('Notice Types Management', () => {
    let createdTypeId: number | null = null;

    it('should fetch notice types list', async () => {
      const response = await fetch(`${BASE_URL}/api/notice-types`);
      expect(response.ok).toBe(true);
      
      const types = await response.json();
      expect(Array.isArray(types)).toBe(true);
      expect(types.some((t: any) => t.is_preset || t.isPreset)).toBe(true);
    });

    it('should allow staff to create notice type', async () => {
      if (!staffSession) {
        expect.fail('Failed to establish staff test session');
      }

      const response = await fetchWithSession('/api/notice-types', staffSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Notice Type', sortOrder: 999 })
      });
      
      expect(response.ok).toBe(true);
      const type = await response.json();
      expect(type.name).toBe('Test Notice Type');
      expect(type.is_preset === false || type.isPreset === false).toBe(true);
      createdTypeId = type.id;
    });

    it('should prevent editing preset notice types', async () => {
      if (!staffSession) {
        expect.fail('Failed to establish staff test session');
      }

      const listResponse = await fetch(`${BASE_URL}/api/notice-types`);
      const types = await listResponse.json();
      const presetType = types.find((t: any) => t.is_preset || t.isPreset);
      
      if (!presetType) {
        console.log('Skipping: No preset type found in database');
        return;
      }

      const response = await fetchWithSession(`/api/notice-types/${presetType.id}`, staffSession, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked Name' })
      });
      
      expect(response.status).toBe(403);
    });

    it('should allow deleting custom notice type', async () => {
      if (!staffSession) {
        expect.fail('Failed to establish staff test session');
      }
      if (!createdTypeId) {
        expect.fail('No notice type was created in previous test');
      }

      const response = await fetchWithSession(`/api/notice-types/${createdTypeId}`, staffSession, {
        method: 'DELETE'
      });
      
      expect(response.ok).toBe(true);
    });
  });

  describe('Promotional Banner for Announcements', () => {
    let createdAnnouncementId: number | null = null;

    it('should fetch banner announcement endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/announcements/banner`);
      expect(response.ok).toBe(true);
    });

    it('should allow admin to create announcement with banner flag', async () => {
      if (!adminSession) {
        expect.fail('Failed to establish admin test session');
      }

      const response = await fetchWithSession('/api/announcements', adminSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Banner Announcement',
          content: 'This is a test announcement for E2E',
          priority: 'normal',
          is_active: true,
          showAsBanner: true
        })
      });
      
      expect(response.ok).toBe(true);
      const announcement = await response.json();
      expect(announcement.showAsBanner === true || announcement.show_as_banner === true).toBe(true);
      createdAnnouncementId = announcement.id;
    });

    it('should return banner in banner endpoint', async () => {
      if (!createdAnnouncementId) {
        expect.fail('No announcement was created in previous test');
      }

      const response = await fetch(`${BASE_URL}/api/announcements/banner`);
      const banner = await response.json();
      
      if (banner) {
        expect(banner.id).toBe(createdAnnouncementId);
        expect(banner.showAsBanner === true || banner.show_as_banner === true).toBe(true);
      }
    });

    afterAll(async () => {
      if (adminSession && createdAnnouncementId) {
        await fetchWithSession(`/api/announcements/${createdAnnouncementId}`, adminSession, {
          method: 'DELETE'
        });
      }
    });
  });
});
