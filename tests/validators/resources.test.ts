import { describe, it, expect } from 'vitest';
import {
  assignMemberSchema,
  dayPassRedemptionSchema,
  linkTrackmanSchema,
  assignWithPlayersSchema,
  changeOwnerSchema,
  createBookingSchema,
  manualBookingSchema,
  declineBookingSchema,
} from '../../shared/validators/resources';

describe('assignMemberSchema', () => {
  it('accepts valid input', () => {
    expect(assignMemberSchema.safeParse({
      member_email: 'a@b.com',
      member_name: 'John Doe',
    }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(assignMemberSchema.safeParse({
      member_email: 'bad',
      member_name: 'John',
    }).success).toBe(false);
  });

  it('rejects empty member_name', () => {
    expect(assignMemberSchema.safeParse({
      member_email: 'a@b.com',
      member_name: '',
    }).success).toBe(false);
  });

  it('rejects member_name exceeding 200 chars', () => {
    expect(assignMemberSchema.safeParse({
      member_email: 'a@b.com',
      member_name: 'x'.repeat(201),
    }).success).toBe(false);
  });

  it('accepts null member_id', () => {
    expect(assignMemberSchema.safeParse({
      member_email: 'a@b.com',
      member_name: 'John',
      member_id: null,
    }).success).toBe(true);
  });
});

describe('dayPassRedemptionSchema', () => {
  it('accepts valid input', () => {
    expect(dayPassRedemptionSchema.safeParse({
      participantEmail: 'a@b.com',
      dayPassId: 'dp_1',
    }).success).toBe(true);
  });

  it('rejects empty participantEmail', () => {
    expect(dayPassRedemptionSchema.safeParse({
      participantEmail: '',
      dayPassId: 'dp_1',
    }).success).toBe(false);
  });

  it('rejects extra fields (strict mode)', () => {
    expect(dayPassRedemptionSchema.safeParse({
      participantEmail: 'a@b.com',
      dayPassId: 'dp_1',
      extra: true,
    }).success).toBe(false);
  });
});

describe('linkTrackmanSchema', () => {
  it('accepts valid input with string trackman_booking_id', () => {
    expect(linkTrackmanSchema.safeParse({
      trackman_booking_id: '12345',
    }).success).toBe(true);
  });

  it('accepts numeric trackman_booking_id', () => {
    expect(linkTrackmanSchema.safeParse({
      trackman_booking_id: 12345,
    }).success).toBe(true);
  });

  it('accepts with owner details', () => {
    expect(linkTrackmanSchema.safeParse({
      trackman_booking_id: '12345',
      owner: { email: 'a@b.com', name: 'John' },
    }).success).toBe(true);
  });

  it('rejects owner with invalid email', () => {
    expect(linkTrackmanSchema.safeParse({
      trackman_booking_id: '12345',
      owner: { email: 'bad', name: 'John' },
    }).success).toBe(false);
  });

  it('rejects owner with empty name', () => {
    expect(linkTrackmanSchema.safeParse({
      trackman_booking_id: '12345',
      owner: { email: 'a@b.com', name: '' },
    }).success).toBe(false);
  });
});

describe('assignWithPlayersSchema', () => {
  const valid = {
    owner: { email: 'a@b.com', name: 'John' },
  };

  it('accepts valid input', () => {
    expect(assignWithPlayersSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing owner', () => {
    expect(assignWithPlayersSchema.safeParse({}).success).toBe(false);
  });

  it('accepts optional dayPassRedemptions', () => {
    expect(assignWithPlayersSchema.safeParse({
      ...valid,
      dayPassRedemptions: [{ participantEmail: 'g@b.com', dayPassId: 'dp_1' }],
    }).success).toBe(true);
  });
});

describe('changeOwnerSchema', () => {
  it('accepts valid input', () => {
    expect(changeOwnerSchema.safeParse({
      new_email: 'a@b.com',
      new_name: 'Jane',
    }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(changeOwnerSchema.safeParse({
      new_email: 'bad',
      new_name: 'Jane',
    }).success).toBe(false);
  });

  it('rejects empty new_name', () => {
    expect(changeOwnerSchema.safeParse({
      new_email: 'a@b.com',
      new_name: '',
    }).success).toBe(false);
  });
});

describe('createBookingSchema (resources)', () => {
  const valid = {
    resource_id: 1,
    user_email: 'a@b.com',
    booking_date: '2025-06-15',
    start_time: '10:00',
    end_time: '11:00',
  };

  it('accepts valid booking', () => {
    expect(createBookingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid date format', () => {
    expect(createBookingSchema.safeParse({ ...valid, booking_date: '06-15-2025' }).success).toBe(false);
  });

  it('rejects invalid time format (requires HH:MM)', () => {
    expect(createBookingSchema.safeParse({ ...valid, start_time: '10:00:00' }).success).toBe(false);
  });

  it('rejects non-positive resource_id', () => {
    expect(createBookingSchema.safeParse({ ...valid, resource_id: 0 }).success).toBe(false);
  });

  it('rejects notes exceeding 1000 chars', () => {
    expect(createBookingSchema.safeParse({ ...valid, notes: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('manualBookingSchema (resources)', () => {
  const valid = {
    member_email: 'a@b.com',
    resource_id: 1,
    booking_date: '2025-06-15',
    start_time: '10:00',
    duration_minutes: 60,
    booking_source: 'staff_portal',
  };

  it('accepts valid manual booking', () => {
    expect(manualBookingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing booking_source', () => {
    const { booking_source, ...rest } = valid;
    expect(manualBookingSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty booking_source', () => {
    expect(manualBookingSchema.safeParse({ ...valid, booking_source: '' }).success).toBe(false);
  });

  it('defaults guest_count to 0', () => {
    const result = manualBookingSchema.parse(valid);
    expect(result.guest_count).toBe(0);
  });

  it('rejects duration above 480', () => {
    expect(manualBookingSchema.safeParse({ ...valid, duration_minutes: 481 }).success).toBe(false);
  });

  it('rejects negative guest_count', () => {
    expect(manualBookingSchema.safeParse({ ...valid, guest_count: -1 }).success).toBe(false);
  });
});

describe('declineBookingSchema', () => {
  it('accepts empty object', () => {
    expect(declineBookingSchema.safeParse({}).success).toBe(true);
  });

  it('accepts optional reason', () => {
    expect(declineBookingSchema.safeParse({ reason: 'No availability' }).success).toBe(true);
  });

  it('rejects reason exceeding 500 chars', () => {
    expect(declineBookingSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});
