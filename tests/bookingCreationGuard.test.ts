// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlCalls } = vi.hoisted(() => {
  const sqlCalls: Array<{ strings: string[]; values: unknown[] }> = [];
  return { sqlCalls };
});

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatTime12Hour: vi.fn((t: string) => t),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: Error) => e.message),
  getErrorCode: vi.fn(() => null),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ strings: Array.from(strings), values });
      return {};
    }),
    { raw: vi.fn((s: string) => s) }
  ),
}));

import { acquireBookingLocks, checkResourceOverlap, BookingConflictError } from '../server/core/bookingService/bookingCreationGuard';

function createMockTx(responses: Array<{ rows: Record<string, unknown>[] }>) {
  let callIdx = 0;
  return {
    execute: vi.fn(async () => {
      if (callIdx < responses.length) {
        return responses[callIdx++];
      }
      return { rows: [] };
    }),
  };
}

describe('acquireBookingLocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
  });

  describe('pending limit enforcement', () => {
    it('should allow booking when member has no pending requests', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      })).resolves.not.toThrow();
    });

    it('should reject when member already has a pending simulator request', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 1 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      })).rejects.toThrow(BookingConflictError);
    });

    it('should reject when member has 5 pending conference room requests', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 5 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 10,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'conference_room',
      })).rejects.toThrow(BookingConflictError);
    });

    it('should allow conference room booking when member has fewer than 5 pending', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 4 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 10,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'conference_room',
      })).resolves.not.toThrow();
    });

    it('should skip pending limit check for staff requests', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'staff@example.com',
        isStaffRequest: true,
        isViewAsMode: false,
        resourceType: 'simulator',
      })).resolves.not.toThrow();
    });

    it('should skip pending limit for staff even in view-as mode (quotas only apply to non-staff)', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: true,
        isViewAsMode: true,
        resourceType: 'simulator',
      })).resolves.not.toThrow();
    });
  });

  describe('null resource_id (Any Bay) counting toward pending limits', () => {
    it('should count null resource_id bookings toward pending limit', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [{ cnt: 1 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: null,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      })).rejects.toThrow(BookingConflictError);
    });

    it('should allow Any Bay booking when no pending requests exist', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ]);

      await expect(acquireBookingLocks(tx, {
        resourceId: null,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'member@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      })).resolves.not.toThrow();
    });
  });

  describe('participant email locking', () => {
    it('should acquire locks for all unique participant emails', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ]);

      await acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'owner@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
        participantEmails: ['guest1@example.com', 'guest2@example.com'],
      });

      expect(tx.execute).toHaveBeenCalled();
    });

    it('should deduplicate participant emails with owner email', async () => {
      const tx = createMockTx([
        { rows: [] },
        { rows: [] },
        { rows: [{ cnt: 0 }] },
      ]);

      await acquireBookingLocks(tx, {
        resourceId: 1,
        requestDate: '2025-01-15',
        startTime: '10:00',
        endTime: '11:00',
        requestEmail: 'owner@example.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
        participantEmails: ['owner@example.com'],
      });

      expect(tx.execute).toHaveBeenCalled();
    });
  });
});

describe('checkResourceOverlap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip overlap check when resourceId is null (Any Bay)', async () => {
    const tx = createMockTx([]);

    await expect(checkResourceOverlap(tx, {
      resourceId: null,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
    })).resolves.not.toThrow();

    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('should throw BookingConflictError when resource has overlapping booking', async () => {
    const tx = createMockTx([
      {
        rows: [{
          id: 50,
          start_time: '10:00',
          end_time: '11:00',
        }]
      },
    ]);

    await expect(checkResourceOverlap(tx, {
      resourceId: 1,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
    })).rejects.toThrow(BookingConflictError);
  });

  it('should pass when resource has no overlapping bookings', async () => {
    const tx = createMockTx([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await expect(checkResourceOverlap(tx, {
      resourceId: 1,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
    })).resolves.not.toThrow();
  });
});

describe('acquireBookingLocks — SQL query construction verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
  });

  it('should include "resource_id IS NULL" in pending limit query to count Any Bay bookings', async () => {
    const tx = createMockTx([
      { rows: [] },
      { rows: [] },
      { rows: [{ cnt: 0 }] },
    ]);

    await acquireBookingLocks(tx, {
      resourceId: 1,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
      requestEmail: 'member@example.com',
      isStaffRequest: false,
      isViewAsMode: false,
      resourceType: 'simulator',
    });

    const pendingLimitQuery = sqlCalls.find(call =>
      call.strings.some(s => s.includes('resource_id IS NULL'))
    );
    expect(pendingLimitQuery).toBeDefined();

    const queryText = pendingLimitQuery!.strings.join('');
    expect(queryText).toContain('resource_id IS NULL');
  });

  it('should include resource type filter in pending limit query', async () => {
    const tx = createMockTx([
      { rows: [] },
      { rows: [] },
      { rows: [{ cnt: 0 }] },
    ]);

    await acquireBookingLocks(tx, {
      resourceId: 1,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
      requestEmail: 'member@example.com',
      isStaffRequest: false,
      isViewAsMode: false,
      resourceType: 'simulator',
    });

    const resourceTypeQuery = sqlCalls.find(call =>
      call.strings.some(s => s.includes('resources')) &&
      call.values.some(v => v === 'simulator')
    );
    expect(resourceTypeQuery).toBeDefined();
  });

  it('should filter on pending and pending_approval statuses in limit query', async () => {
    const tx = createMockTx([
      { rows: [] },
      { rows: [] },
      { rows: [{ cnt: 0 }] },
    ]);

    await acquireBookingLocks(tx, {
      resourceId: 1,
      requestDate: '2025-01-15',
      startTime: '10:00',
      endTime: '11:00',
      requestEmail: 'member@example.com',
      isStaffRequest: false,
      isViewAsMode: false,
      resourceType: 'simulator',
    });

    const statusQuery = sqlCalls.find(call =>
      call.strings.some(s => s.includes('pending'))
    );
    expect(statusQuery).toBeDefined();

    const queryText = statusQuery!.strings.join('');
    expect(queryText).toContain('pending');
    expect(queryText).toContain('pending_approval');
  });
});
