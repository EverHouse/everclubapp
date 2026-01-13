import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BASE_URL, assertServerAvailable, login, fetchWithSession, TestSession } from './setup';

interface WellnessClass {
  id: number;
  title: string;
  capacity: number | null;
  waitlist_enabled: boolean;
  enrolledCount?: number;
  spotsRemaining?: number | null;
  waitlistCount?: number;
}

describe('Wellness Class Capacity & Waitlist E2E Tests', () => {
  const adminEmail = 'test-admin@example.com';
  const member1Email = 'test-member1@example.com';
  const member2Email = 'test-member2@example.com';
  let adminSession: TestSession;
  let member1Session: TestSession;
  let member2Session: TestSession;
  let testClassId: number | null = null;

  beforeAll(async () => {
    await assertServerAvailable();
    adminSession = await login(adminEmail, 'admin');
    member1Session = await login(member1Email, 'member', 'Premium');
    member2Session = await login(member2Email, 'member', 'Premium');
  });

  describe('Wellness Classes API', () => {
    it('should fetch wellness classes with capacity info', async () => {
      const response = await fetch(`${BASE_URL}/api/wellness-classes`);
      expect(response.ok).toBe(true);
      
      const classes = await response.json();
      expect(Array.isArray(classes)).toBe(true);
      
      if (classes.length > 0) {
        const cls = classes[0] as WellnessClass;
        expect(cls).toHaveProperty('id');
        expect(cls).toHaveProperty('title');
      }
    });

    it('should create wellness class with capacity and waitlist', async () => {
      if (!adminSession) {
        expect.fail('Failed to establish admin test session');
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      const classDate = tomorrow.toISOString().split('T')[0];

      const response = await fetchWithSession('/api/wellness-classes', adminSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Yoga Class',
          description: 'Test class for E2E testing',
          instructor: 'Test Instructor',
          category: 'Yoga',
          date: classDate,
          time: '09:00',
          duration: '60 min',
          spots: '2 spots',
          capacity: 2,
          waitlist_enabled: true
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        expect.fail(`Failed to create wellness class: ${response.status} - ${JSON.stringify(errorData)}`);
      }
      
      const cls = await response.json();
      expect(cls.capacity).toBe(2);
      expect(cls.waitlist_enabled).toBe(true);
      testClassId = cls.id;
    });

    it('should allow first member to enroll normally', async () => {
      if (!member1Session) {
        expect.fail('Failed to establish member1 test session');
      }
      if (!testClassId) {
        expect.fail('No wellness class was created in previous test');
      }

      const response = await fetchWithSession('/api/wellness-enrollments', member1Session, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id: testClassId,
          user_email: member1Email
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        expect.fail(`Enrollment failed: ${response.status} - ${JSON.stringify(errorData)}`);
      }
      
      const result = await response.json();
      expect(result.status).toBe('confirmed');
      expect(result.isWaitlisted).toBe(false);
    });

    it('should show updated enrollment count', async () => {
      if (!testClassId) {
        expect.fail('No wellness class was created in previous test');
      }

      const response = await fetch(`${BASE_URL}/api/wellness-classes`);
      const classes = await response.json();
      const testClass = classes.find((c: WellnessClass) => c.id === testClassId);
      
      if (testClass) {
        const enrolledCount = testClass.enrolled_count ?? testClass.enrolledCount ?? 0;
        expect(enrolledCount).toBeGreaterThanOrEqual(1);
      }
    });
  });

  afterAll(async () => {
    if (adminSession && testClassId) {
      await fetchWithSession(`/api/wellness-classes/${testClassId}`, adminSession, {
        method: 'DELETE'
      });
    }
  });
});

describe('RSVP Deletion E2E Tests', () => {
  let staffSession: TestSession;
  const staffEmail = 'test-staff@example.com';

  beforeAll(async () => {
    await assertServerAvailable();
    staffSession = await login(staffEmail, 'staff');
  });

  it('should have events API endpoint', async () => {
    const response = await fetch(`${BASE_URL}/api/events`);
    expect(response.ok).toBe(true);
    
    const events = await response.json();
    expect(Array.isArray(events)).toBe(true);
  });

  it('should allow staff to view RSVPs for an event', async () => {
    if (!staffSession) {
      expect.fail('Failed to establish staff test session');
    }

    const eventsResponse = await fetch(`${BASE_URL}/api/events`);
    const events = await eventsResponse.json();
    
    if (events.length === 0) {
      console.log('Skipping: No events available in database');
      return;
    }

    const eventId = events[0].id;
    const response = await fetchWithSession(`/api/events/${eventId}/rsvps`, staffSession);
    expect(response.ok).toBe(true);
  });
});
