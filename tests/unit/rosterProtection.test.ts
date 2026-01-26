import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../server/core/db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn()
  }
}));

vi.mock('../../server/core/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

interface MockBooking {
  id: number;
  roster_version: number | null;
  owner_email: string;
  session_id: number | null;
  status: string;
}

interface MockParticipant {
  id: number;
  sessionId: number;
  userId?: string;
  displayName: string;
  participantType: 'owner' | 'member' | 'guest';
}

class MockRosterManager {
  private bookings: Map<number, MockBooking> = new Map();
  private participants: Map<number, MockParticipant[]> = new Map();
  private lockedBookingId: number | null = null;

  setBooking(booking: MockBooking): void {
    this.bookings.set(booking.id, booking);
    if (booking.session_id && !this.participants.has(booking.session_id)) {
      this.participants.set(booking.session_id, []);
    }
  }

  async getParticipantsResponse(bookingId: number): Promise<{
    booking: any;
    participants: MockParticipant[];
    rosterVersion: number;
  } | null> {
    const booking = this.bookings.get(bookingId);
    if (!booking) return null;

    const participants = booking.session_id 
      ? this.participants.get(booking.session_id) || []
      : [];

    return {
      booking: {
        id: booking.id,
        ownerEmail: booking.owner_email,
        status: booking.status,
        sessionId: booking.session_id
      },
      participants,
      rosterVersion: booking.roster_version ?? 0
    };
  }

  async lockBookingForUpdate(bookingId: number): Promise<{ roster_version: number } | null> {
    const booking = this.bookings.get(bookingId);
    if (!booking) return null;

    this.lockedBookingId = bookingId;
    return { roster_version: booking.roster_version ?? 0 };
  }

  async addParticipant(
    bookingId: number,
    participant: Omit<MockParticipant, 'id' | 'sessionId'>,
    clientRosterVersion?: number
  ): Promise<{
    success: boolean;
    error?: string;
    code?: string;
    currentVersion?: number;
    newRosterVersion?: number;
    participant?: MockParticipant;
  }> {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      return { success: false, error: 'Booking not found' };
    }

    const locked = await this.lockBookingForUpdate(bookingId);
    if (!locked) {
      return { success: false, error: 'Booking not found' };
    }

    const currentVersion = locked.roster_version;

    if (clientRosterVersion !== undefined && currentVersion !== clientRosterVersion) {
      return {
        success: false,
        error: 'Roster was modified by another user',
        code: 'ROSTER_CONFLICT',
        currentVersion
      };
    }

    if (!booking.session_id) {
      return { success: false, error: 'Booking does not have an active session' };
    }

    const sessionParticipants = this.participants.get(booking.session_id) || [];
    const newParticipant: MockParticipant = {
      id: Date.now(),
      sessionId: booking.session_id,
      ...participant
    };
    sessionParticipants.push(newParticipant);
    this.participants.set(booking.session_id, sessionParticipants);

    const newVersion = (booking.roster_version ?? 0) + 1;
    booking.roster_version = newVersion;
    this.bookings.set(bookingId, booking);

    this.lockedBookingId = null;

    return {
      success: true,
      newRosterVersion: newVersion,
      participant: newParticipant
    };
  }

  async removeParticipant(
    bookingId: number,
    participantId: number,
    clientRosterVersion?: number
  ): Promise<{
    success: boolean;
    error?: string;
    code?: string;
    currentVersion?: number;
    newRosterVersion?: number;
  }> {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      return { success: false, error: 'Booking not found' };
    }

    const locked = await this.lockBookingForUpdate(bookingId);
    if (!locked) {
      return { success: false, error: 'Booking not found' };
    }

    const currentVersion = locked.roster_version;

    if (clientRosterVersion !== undefined && currentVersion !== clientRosterVersion) {
      return {
        success: false,
        error: 'Roster was modified by another user',
        code: 'ROSTER_CONFLICT',
        currentVersion
      };
    }

    if (!booking.session_id) {
      return { success: false, error: 'Booking does not have an active session' };
    }

    const sessionParticipants = this.participants.get(booking.session_id) || [];
    const participantIndex = sessionParticipants.findIndex(p => p.id === participantId);
    
    if (participantIndex === -1) {
      return { success: false, error: 'Participant not found' };
    }

    sessionParticipants.splice(participantIndex, 1);
    this.participants.set(booking.session_id, sessionParticipants);

    const newVersion = (booking.roster_version ?? 0) + 1;
    booking.roster_version = newVersion;
    this.bookings.set(bookingId, booking);

    this.lockedBookingId = null;

    return {
      success: true,
      newRosterVersion: newVersion
    };
  }

  reset(): void {
    this.bookings.clear();
    this.participants.clear();
    this.lockedBookingId = null;
  }
}

describe('Roster Protection', () => {
  let rosterManager: MockRosterManager;

  beforeEach(() => {
    rosterManager = new MockRosterManager();
    vi.clearAllMocks();

    rosterManager.setBooking({
      id: 1,
      roster_version: 0,
      owner_email: 'owner@test.com',
      session_id: 100,
      status: 'approved'
    });
  });

  describe('Response Structure', () => {
    it('should include roster_version in participant response', async () => {
      const response = await rosterManager.getParticipantsResponse(1);

      expect(response).not.toBeNull();
      expect(response).toHaveProperty('rosterVersion');
      expect(typeof response!.rosterVersion).toBe('number');
    });

    it('should return roster_version as 0 for null version', async () => {
      rosterManager.setBooking({
        id: 2,
        roster_version: null,
        owner_email: 'owner2@test.com',
        session_id: 200,
        status: 'approved'
      });

      const response = await rosterManager.getParticipantsResponse(2);

      expect(response?.rosterVersion).toBe(0);
    });

    it('should return current roster_version value', async () => {
      rosterManager.setBooking({
        id: 3,
        roster_version: 5,
        owner_email: 'owner3@test.com',
        session_id: 300,
        status: 'approved'
      });

      const response = await rosterManager.getParticipantsResponse(3);

      expect(response?.rosterVersion).toBe(5);
    });
  });

  describe('Stale Version Rejection', () => {
    it('should reject modification with stale version', async () => {
      rosterManager.setBooking({
        id: 10,
        roster_version: 3,
        owner_email: 'owner@test.com',
        session_id: 1000,
        status: 'approved'
      });

      const result = await rosterManager.addParticipant(
        10,
        { displayName: 'New Member', participantType: 'member', userId: 'user123' },
        1
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('ROSTER_CONFLICT');
      expect(result.currentVersion).toBe(3);
    });

    it('should reject when version is off by one', async () => {
      rosterManager.setBooking({
        id: 11,
        roster_version: 5,
        owner_email: 'owner@test.com',
        session_id: 1100,
        status: 'approved'
      });

      const result = await rosterManager.addParticipant(
        11,
        { displayName: 'New Guest', participantType: 'guest' },
        4
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('ROSTER_CONFLICT');
    });

    it('should reject removal with stale version', async () => {
      rosterManager.setBooking({
        id: 12,
        roster_version: 2,
        owner_email: 'owner@test.com',
        session_id: 1200,
        status: 'approved'
      });

      await rosterManager.addParticipant(
        12,
        { displayName: 'Existing Member', participantType: 'member', userId: 'user456' },
        2
      );

      const result = await rosterManager.removeParticipant(12, 999, 2);

      expect(result.success).toBe(false);
      expect(result.code).toBe('ROSTER_CONFLICT');
    });
  });

  describe('Version Increment', () => {
    it('should increment version on successful modification', async () => {
      const initialResponse = await rosterManager.getParticipantsResponse(1);
      expect(initialResponse?.rosterVersion).toBe(0);

      const result = await rosterManager.addParticipant(
        1,
        { displayName: 'New Member', participantType: 'member', userId: 'user789' },
        0
      );

      expect(result.success).toBe(true);
      expect(result.newRosterVersion).toBe(1);

      const updatedResponse = await rosterManager.getParticipantsResponse(1);
      expect(updatedResponse?.rosterVersion).toBe(1);
    });

    it('should increment version on each modification', async () => {
      let result = await rosterManager.addParticipant(
        1,
        { displayName: 'Member 1', participantType: 'member', userId: 'user1' },
        0
      );
      expect(result.newRosterVersion).toBe(1);

      result = await rosterManager.addParticipant(
        1,
        { displayName: 'Member 2', participantType: 'member', userId: 'user2' },
        1
      );
      expect(result.newRosterVersion).toBe(2);

      result = await rosterManager.addParticipant(
        1,
        { displayName: 'Guest 1', participantType: 'guest' },
        2
      );
      expect(result.newRosterVersion).toBe(3);
    });

    it('should increment version on removal', async () => {
      const addResult = await rosterManager.addParticipant(
        1,
        { displayName: 'Temp Member', participantType: 'member', userId: 'tempUser' },
        0
      );
      expect(addResult.newRosterVersion).toBe(1);

      const participantId = addResult.participant!.id;

      const removeResult = await rosterManager.removeParticipant(1, participantId, 1);
      expect(removeResult.success).toBe(true);
      expect(removeResult.newRosterVersion).toBe(2);
    });
  });

  describe('Backward Compatibility', () => {
    it('should allow modification without version (backward compat)', async () => {
      const result = await rosterManager.addParticipant(
        1,
        { displayName: 'New Member', participantType: 'member', userId: 'userABC' },
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.newRosterVersion).toBe(1);
    });

    it('should allow removal without version (backward compat)', async () => {
      const addResult = await rosterManager.addParticipant(
        1,
        { displayName: 'Member to Remove', participantType: 'member', userId: 'userDEF' }
      );

      const participantId = addResult.participant!.id;

      const removeResult = await rosterManager.removeParticipant(1, participantId, undefined);
      expect(removeResult.success).toBe(true);
    });

    it('should still increment version even without client version', async () => {
      const result1 = await rosterManager.addParticipant(
        1,
        { displayName: 'Member 1', participantType: 'member', userId: 'user1' }
      );
      expect(result1.newRosterVersion).toBe(1);

      const result2 = await rosterManager.addParticipant(
        1,
        { displayName: 'Member 2', participantType: 'member', userId: 'user2' }
      );
      expect(result2.newRosterVersion).toBe(2);
    });
  });

  describe('Concurrency Scenarios', () => {
    it('should detect concurrent modifications', async () => {
      const initialResponse = await rosterManager.getParticipantsResponse(1);
      const version = initialResponse!.rosterVersion;

      const result1 = await rosterManager.addParticipant(
        1,
        { displayName: 'Member from User A', participantType: 'member', userId: 'userA' },
        version
      );
      expect(result1.success).toBe(true);

      const result2 = await rosterManager.addParticipant(
        1,
        { displayName: 'Member from User B', participantType: 'member', userId: 'userB' },
        version
      );
      expect(result2.success).toBe(false);
      expect(result2.code).toBe('ROSTER_CONFLICT');
    });

    it('should provide current version in conflict response', async () => {
      await rosterManager.addParticipant(
        1,
        { displayName: 'First Member', participantType: 'member', userId: 'first' },
        0
      );

      const staleResult = await rosterManager.addParticipant(
        1,
        { displayName: 'Late Member', participantType: 'member', userId: 'late' },
        0
      );

      expect(staleResult.success).toBe(false);
      expect(staleResult.currentVersion).toBe(1);
    });

    it('should allow retry with correct version after conflict', async () => {
      await rosterManager.addParticipant(
        1,
        { displayName: 'First Member', participantType: 'member', userId: 'first' },
        0
      );

      const conflictResult = await rosterManager.addParticipant(
        1,
        { displayName: 'Second Member', participantType: 'member', userId: 'second' },
        0
      );
      expect(conflictResult.success).toBe(false);
      expect(conflictResult.currentVersion).toBe(1);

      const retryResult = await rosterManager.addParticipant(
        1,
        { displayName: 'Second Member', participantType: 'member', userId: 'second' },
        conflictResult.currentVersion
      );
      expect(retryResult.success).toBe(true);
      expect(retryResult.newRosterVersion).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle booking not found', async () => {
      const result = await rosterManager.addParticipant(
        999,
        { displayName: 'Member', participantType: 'member', userId: 'user' },
        0
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Booking not found');
    });

    it('should handle booking without session', async () => {
      rosterManager.setBooking({
        id: 50,
        roster_version: 0,
        owner_email: 'owner@test.com',
        session_id: null,
        status: 'pending'
      });

      const result = await rosterManager.addParticipant(
        50,
        { displayName: 'Member', participantType: 'member', userId: 'user' },
        0
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Booking does not have an active session');
    });

    it('should handle participant not found for removal', async () => {
      const result = await rosterManager.removeParticipant(1, 99999, 0);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Participant not found');
    });
  });
});
