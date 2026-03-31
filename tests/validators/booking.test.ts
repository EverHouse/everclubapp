import { describe, it, expect } from 'vitest';
import { createBookingRequestSchema } from '../../shared/validators/booking';

describe('createBookingRequestSchema', () => {
  const validBooking = {
    user_email: 'member@example.com',
    request_date: '2025-06-15',
    start_time: '14:00',
    duration_minutes: 60,
  };

  it('accepts a minimal valid booking', () => {
    const result = createBookingRequestSchema.safeParse(validBooking);
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated booking', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      user_name: 'John Doe',
      resource_id: 3,
      resource_preference: 'bay-1',
      declared_player_count: 2,
      notes: 'Birthday party',
      user_tier: 'gold',
      member_notes: 'VIP guest',
      guardian_name: 'Jane Doe',
      guardian_relationship: 'Parent',
      guardian_phone: '555-1234',
      guardian_consent: true,
      request_participants: [
        { email: 'guest@example.com', type: 'guest', name: 'Guest One' },
        { email: 'member2@example.com', type: 'member', name: 'Member Two' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts start_time with seconds', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      start_time: '14:00:00',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing user_email', () => {
    const { user_email, ...rest } = validBooking;
    const result = createBookingRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      user_email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    for (const bad of ['06/15/2025', '2025-6-15', '20250615', 'tomorrow']) {
      const result = createBookingRequestSchema.safeParse({
        ...validBooking,
        request_date: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects invalid time format', () => {
    for (const bad of ['2pm', '14', '14:0', 'noon']) {
      const result = createBookingRequestSchema.safeParse({
        ...validBooking,
        start_time: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects duration below minimum', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      duration_minutes: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duration above maximum', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      duration_minutes: 481,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer duration', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      duration_minutes: 60.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects player count above 4', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      declared_player_count: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects player count below 1', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      declared_player_count: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects notes exceeding 1000 characters', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      notes: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 participants', () => {
    const participants = Array.from({ length: 11 }, (_, i) => ({
      email: `guest${i}@example.com`,
      type: 'guest' as const,
    }));
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      request_participants: participants,
    });
    expect(result.success).toBe(false);
  });

  it('rejects guest participant without email', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      request_participants: [{ type: 'guest', name: 'No Email Guest' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts member participant with userId only', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      request_participants: [{ type: 'member', userId: 'user-123' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects member participant without email or userId', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      request_participants: [{ type: 'member', name: 'No ID' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects XSS payloads in string fields', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      user_email: '<script>alert("xss")</script>',
    });
    expect(result.success).toBe(false);
  });

  it('rejects SQL injection in email', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      user_email: "' OR 1=1 --",
    });
    expect(result.success).toBe(false);
  });

  it('allows nullable optional fields to be null', () => {
    const result = createBookingRequestSchema.safeParse({
      ...validBooking,
      resource_id: null,
      notes: null,
      declared_player_count: null,
      request_participants: null,
    });
    expect(result.success).toBe(true);
  });
});
