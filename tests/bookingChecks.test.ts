// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((..._args: unknown[]) => 'mock-sql'), { join: vi.fn() }),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn(() => '2026-03-31'),
}));

import { db } from '../server/db';
import {
  checkUnmatchedTrackmanBookings,
  checkParticipantUserRelationships,
  checkNeedsReviewItems,
  checkBookingTimeValidity,
  checkStalePastTours,
  checkBookingsWithoutSessions,
  checkSessionsWithoutParticipants,
  checkOverlappingBookings,
  checkGuestPassAccountingDrift,
  checkStuckUnpaidBookings,
} from '../server/core/integrity/bookingChecks';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
});

describe('checkUnmatchedTrackmanBookings', () => {
  it('returns pass when no unmatched bookings exist', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const result = await checkUnmatchedTrackmanBookings();
    expect(result.checkName).toBe('Unmatched Trackman Bookings');
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it('returns warning when unmatched bookings exist (<=50)', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 1, trackman_booking_id: 'TM-123', user_name: 'John Doe',
          original_email: 'john@test.com', booking_date: '2026-03-30',
          bay_number: 5, start_time: '10:00', end_time: '11:00', notes: 'test'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] });

    const result = await checkUnmatchedTrackmanBookings();
    expect(result.status).toBe('warning');
    expect(result.issueCount).toBe(3);
    expect(result.issues[0].category).toBe('sync_mismatch');
    expect(result.issues[0].severity).toBe('warning');
    expect(result.issues[0].table).toBe('trackman_unmatched_bookings');
  });

  it('returns fail when more than 50 unmatched bookings exist', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 55 }] });

    const result = await checkUnmatchedTrackmanBookings();
    expect(result.status).toBe('fail');
    expect(result.issueCount).toBe(55);
  });

  it('returns warning with system_error on db failure', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB connection error'));

    const result = await checkUnmatchedTrackmanBookings();
    expect(result.status).toBe('warning');
    expect(result.issueCount).toBe(1);
    expect(result.issues[0].category).toBe('system_error');
    expect(result.issues[0].severity).toBe('error');
  });
});

describe('checkParticipantUserRelationships', () => {
  it('returns pass when all participants reference valid users', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkParticipantUserRelationships();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('returns warning for invalid user references', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 42, user_id: 'user-999', display_name: 'Ghost User',
        session_id: 1, session_date: '2026-03-30', start_time: '09:00', resource_name: 'Bay 1'
      }]
    });

    const result = await checkParticipantUserRelationships();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('missing_relationship');
    expect(result.issues[0].description).toContain('non-existent user');
  });

  it('returns fail when more than 10 invalid references', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: i, user_id: `user-${i}`, display_name: `User ${i}`,
      session_id: i, session_date: '2026-03-30', start_time: '09:00', resource_name: 'Bay 1'
    }));
    mockExecute.mockResolvedValueOnce({ rows });

    const result = await checkParticipantUserRelationships();
    expect(result.status).toBe('fail');
    expect(result.issueCount).toBe(11);
  });
});

describe('checkNeedsReviewItems', () => {
  it('returns pass when no items need review', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkNeedsReviewItems();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('returns info for events needing review', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ id: 1, title: 'Wine Tasting', event_date: '2026-04-01', start_time: '18:00' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkNeedsReviewItems();
    expect(result.status).toBe('info');
    expect(result.issues[0].table).toBe('events');
    expect(result.issues[0].severity).toBe('info');
  });

  it('returns info for wellness classes needing review', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 2, title: 'Yoga', date: '2026-04-02', start_time: '08:00', instructor: 'Jane' }]
      });

    const result = await checkNeedsReviewItems();
    expect(result.status).toBe('info');
    expect(result.issues[0].table).toBe('wellness_classes');
  });
});

describe('checkBookingTimeValidity', () => {
  it('returns pass when all times are valid', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkBookingTimeValidity();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects bookings with end_time before start_time', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: 1, user_email: 'test@example.com', user_name: 'Test User',
          request_date: '2026-03-30', start_time: '14:00', end_time: '12:00', resource_name: 'Bay 1'
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkBookingTimeValidity();
    expect(result.status).toBe('fail');
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('end_time');
  });

  it('detects sessions with invalid times', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 5, session_date: '2026-03-30', start_time: '15:00', end_time: '13:00', resource_name: 'Bay 2'
        }]
      });

    const result = await checkBookingTimeValidity();
    expect(result.status).toBe('fail');
    expect(result.issues[0].table).toBe('booking_sessions');
  });
});

describe('checkStalePastTours', () => {
  it('returns pass when no stale tours exist', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkStalePastTours();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects stale past tours still pending/scheduled', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10, title: 'Tour A', tour_date: '2026-03-28', status: 'pending',
          guest_name: 'Jane Doe', guest_email: 'jane@test.com', start_time: '14:00'
        }]
      });

    const result = await checkStalePastTours();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].description).toContain('in the past');
  });
});

describe('checkBookingsWithoutSessions', () => {
  it('returns pass when all active bookings have sessions', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkBookingsWithoutSessions();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects active bookings without sessions', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 100, user_email: 'member@test.com', request_date: '2026-03-29',
        status: 'approved', trackman_booking_id: 'TM-456', resource_id: 1,
        start_time: '10:00', end_time: '11:00', notes: '', resource_name: 'Bay 1',
        first_name: 'Test', last_name: 'Member'
      }]
    });

    const result = await checkBookingsWithoutSessions();
    expect(result.status).toBe('fail');
    expect(result.issues[0].category).toBe('data_quality');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('NO SESSION');
  });
});

describe('checkSessionsWithoutParticipants', () => {
  it('returns pass when all sessions have participants', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkSessionsWithoutParticipants();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects empty sessions', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 50, session_date: '2026-03-30', resource_id: 1,
        start_time: '09:00', end_time: '10:00', created_at: '2026-03-29',
        trackman_booking_id: null, resource_name: 'Bay 1',
        linked_booking_id: null, booking_trackman_id: null
      }]
    });

    const result = await checkSessionsWithoutParticipants();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('orphan_record');
    expect(result.issues[0].description).toContain('zero participants');
  });
});

describe('checkOverlappingBookings', () => {
  it('returns pass when no overlaps', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await checkOverlappingBookings();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects overlapping sessions', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session1_id: 1, session2_id: 2, resource_id: 1, session_date: '2026-03-30',
        start_time: '10:00', end_time: '11:00', overlap_start: '10:30', overlap_end: '11:30',
        booking1_id: 10, booking1_status: 'approved', booking2_id: 11, booking2_status: 'approved',
        member1_email: 'a@test.com', member1_first: 'Alice', member1_last: 'A',
        member2_email: 'b@test.com', member2_first: 'Bob', member2_last: 'B',
        resource_name: 'Bay 1'
      }]
    });

    const result = await checkOverlappingBookings();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('booking_issue');
    expect(result.issues[0].description).toContain('overlap');
  });

  it('returns warning with system_error on db failure', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Query timeout'));

    const result = await checkOverlappingBookings();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('system_error');
  });
});

describe('checkGuestPassAccountingDrift', () => {
  it('returns pass when no drift', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkGuestPassAccountingDrift();
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects over-used guest passes', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ id: 1, member_email: 'user@test.com', passes_used: 10, passes_total: 5 }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkGuestPassAccountingDrift();
    expect(result.status).toBe('fail');
    expect(result.issues[0].category).toBe('billing_issue');
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].description).toContain('passes_used');
  });

  it('detects orphan holds', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 2, member_email: 'user@test.com', booking_id: 999, passes_held: 2 }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkGuestPassAccountingDrift();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('orphan_record');
    expect(result.issues[0].description).toContain('non-existent booking');
  });

  it('detects expired holds', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 3, member_email: 'user@test.com', booking_id: 100, passes_held: 1, expires_at: '2026-03-20T00:00:00Z' }]
      });

    const result = await checkGuestPassAccountingDrift();
    expect(result.status).toBe('warning');
    expect(result.issues[0].description).toContain('expired');
  });

  it('returns warning with system_error on failure', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB error'));

    const result = await checkGuestPassAccountingDrift();
    expect(result.status).toBe('warning');
    expect(result.issues[0].category).toBe('system_error');
  });
});

describe('checkStuckUnpaidBookings', () => {
  it('returns pass when no stuck unpaid bookings', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkStuckUnpaidBookings();
    expect(result.checkName).toBe('Stuck Unpaid Bookings');
    expect(result.status).toBe('pass');
    expect(result.issueCount).toBe(0);
  });

  it('detects stuck unpaid bookings', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 200, user_email: 'stuck@test.com', user_name: 'Stuck User',
          request_date: '2026-03-28', start_time: '10:00', end_time: '11:00',
          resource_name: 'Bay 1', stuck_hours: 48, unpaid_cents: 5000
        }]
      });

    const result = await checkStuckUnpaidBookings();
    expect(result.issueCount).toBe(2);
    expect(result.issues[0].category).toBe('billing_issue');
    expect(result.issues[0].severity).toBe('error');
  });
});
