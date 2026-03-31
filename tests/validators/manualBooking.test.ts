// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { staffManualBookingSchema } from '../../shared/validators/manualBooking';

describe('staffManualBookingSchema', () => {
  const valid = {
    user_email: 'staff@example.com',
    request_date: '2025-06-15',
    start_time: '10:00',
    duration_minutes: 60,
    trackman_booking_id: '19510379',
  };

  it('accepts a valid manual booking', () => {
    expect(staffManualBookingSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts trackman_external_id instead of trackman_booking_id', () => {
    const { trackman_booking_id, ...rest } = valid;
    expect(staffManualBookingSchema.safeParse({
      ...rest,
      trackman_external_id: '12345',
    }).success).toBe(true);
  });

  it('accepts numeric trackman_booking_id and transforms to string', () => {
    const result = staffManualBookingSchema.parse({ ...valid, trackman_booking_id: 19510379 });
    expect(result.trackman_booking_id).toBe('19510379');
  });

  it('rejects missing both trackman_booking_id and trackman_external_id', () => {
    const { trackman_booking_id, ...rest } = valid;
    expect(staffManualBookingSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-numeric trackman_booking_id', () => {
    expect(staffManualBookingSchema.safeParse({
      ...valid,
      trackman_booking_id: 'abc-uuid-123',
    }).success).toBe(false);
  });

  it('rejects empty user_email', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, user_email: '' }).success).toBe(false);
  });

  it('rejects invalid date format', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, request_date: '06/15/2025' }).success).toBe(false);
  });

  it('rejects invalid time format', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, start_time: '10am' }).success).toBe(false);
  });

  it('rejects duration below 1 minute', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, duration_minutes: 0 }).success).toBe(false);
  });

  it('rejects duration above 480 minutes', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, duration_minutes: 481 }).success).toBe(false);
  });

  it('accepts optional participants', () => {
    expect(staffManualBookingSchema.safeParse({
      ...valid,
      request_participants: [
        { email: 'guest@example.com', type: 'guest', name: 'Guest' },
      ],
    }).success).toBe(true);
  });

  it('transforms numeric userId in participant to string', () => {
    const result = staffManualBookingSchema.parse({
      ...valid,
      request_participants: [
        { email: 'member@example.com', type: 'member', userId: 42 },
      ],
    });
    expect(result.request_participants![0].userId).toBe('42');
  });

  it('accepts player count between 1 and 4', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, declared_player_count: 4 }).success).toBe(true);
  });

  it('rejects player count above 4', () => {
    expect(staffManualBookingSchema.safeParse({ ...valid, declared_player_count: 5 }).success).toBe(false);
  });

  it('accepts nullable optional fields', () => {
    expect(staffManualBookingSchema.safeParse({
      ...valid,
      user_name: null,
      resource_id: null,
      request_participants: null,
      paymentStatus: null,
    }).success).toBe(true);
  });

  it('accepts time with seconds', () => {
    expect(staffManualBookingSchema.safeParse({
      ...valid,
      start_time: '10:00:00',
    }).success).toBe(true);
  });
});
