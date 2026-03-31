import { describe, it, expect } from 'vitest';
import {
  addParticipantSchema,
  batchRosterSchema,
  previewFeesSchema,
  playerCountSchema,
  removeParticipantSchema,
  memberCancelSchema,
} from '../../shared/validators/roster';

describe('addParticipantSchema', () => {
  it('accepts valid member participant', () => {
    expect(addParticipantSchema.safeParse({
      type: 'member',
      userId: 'u1',
    }).success).toBe(true);
  });

  it('accepts valid guest participant with guest pass', () => {
    expect(addParticipantSchema.safeParse({
      type: 'guest',
      guest: { name: 'Guest One', email: 'guest@example.com' },
      useGuestPass: true,
    }).success).toBe(true);
  });

  it('accepts guest without guest pass even without guest details', () => {
    expect(addParticipantSchema.safeParse({
      type: 'guest',
      useGuestPass: false,
    }).success).toBe(true);
  });

  it('rejects guest using guest pass without guest details', () => {
    expect(addParticipantSchema.safeParse({
      type: 'guest',
      useGuestPass: true,
    }).success).toBe(false);
  });

  it('rejects invalid participant type', () => {
    expect(addParticipantSchema.safeParse({
      type: 'visitor',
      userId: 'u1',
    }).success).toBe(false);
  });

  it('rejects guest name exceeding 200 chars', () => {
    expect(addParticipantSchema.safeParse({
      type: 'guest',
      guest: { name: 'x'.repeat(201), email: 'a@b.com' },
      useGuestPass: true,
    }).success).toBe(false);
  });

  it('rejects guest with invalid email', () => {
    expect(addParticipantSchema.safeParse({
      type: 'guest',
      guest: { name: 'Guest', email: 'bad' },
      useGuestPass: true,
    }).success).toBe(false);
  });

  it('accepts optional rosterVersion and deferFeeRecalc', () => {
    expect(addParticipantSchema.safeParse({
      type: 'member',
      userId: 'u1',
      rosterVersion: 3,
      deferFeeRecalc: true,
    }).success).toBe(true);
  });
});

describe('batchRosterSchema', () => {
  const validOp = { action: 'add' as const, type: 'member' as const, userId: 'u1' };

  it('accepts valid batch with one operation', () => {
    expect(batchRosterSchema.safeParse({
      rosterVersion: 1,
      operations: [validOp],
    }).success).toBe(true);
  });

  it('rejects empty operations array', () => {
    expect(batchRosterSchema.safeParse({
      rosterVersion: 1,
      operations: [],
    }).success).toBe(false);
  });

  it('rejects more than 20 operations', () => {
    const ops = Array.from({ length: 21 }, () => validOp);
    expect(batchRosterSchema.safeParse({
      rosterVersion: 1,
      operations: ops,
    }).success).toBe(false);
  });

  it('rejects missing rosterVersion', () => {
    expect(batchRosterSchema.safeParse({
      operations: [validOp],
    }).success).toBe(false);
  });

  it('accepts remove operation with participantId', () => {
    expect(batchRosterSchema.safeParse({
      rosterVersion: 2,
      operations: [{ action: 'remove', participantId: 42 }],
    }).success).toBe(true);
  });

  it('rejects invalid action', () => {
    expect(batchRosterSchema.safeParse({
      rosterVersion: 1,
      operations: [{ action: 'update' }],
    }).success).toBe(false);
  });
});

describe('previewFeesSchema', () => {
  it('accepts empty provisional participants', () => {
    expect(previewFeesSchema.safeParse({}).success).toBe(true);
  });

  it('accepts participants with mixed types', () => {
    expect(previewFeesSchema.safeParse({
      provisionalParticipants: [
        { type: 'member', userId: 'u1' },
        { type: 'guest', email: 'g@b.com', name: 'Guest' },
      ],
    }).success).toBe(true);
  });

  it('defaults provisionalParticipants to empty array', () => {
    const result = previewFeesSchema.parse({});
    expect(Array.isArray(result.provisionalParticipants)).toBe(true);
    expect(result.provisionalParticipants).toHaveLength(0);
  });
});

describe('playerCountSchema', () => {
  it('accepts valid player count', () => {
    expect(playerCountSchema.safeParse({ playerCount: 2 }).success).toBe(true);
  });

  it('rejects player count below 1', () => {
    expect(playerCountSchema.safeParse({ playerCount: 0 }).success).toBe(false);
  });

  it('rejects player count above 4', () => {
    expect(playerCountSchema.safeParse({ playerCount: 5 }).success).toBe(false);
  });

  it('rejects non-integer player count', () => {
    expect(playerCountSchema.safeParse({ playerCount: 2.5 }).success).toBe(false);
  });

  it('rejects missing playerCount', () => {
    expect(playerCountSchema.safeParse({}).success).toBe(false);
  });
});

describe('removeParticipantSchema', () => {
  it('accepts empty object', () => {
    expect(removeParticipantSchema.safeParse({}).success).toBe(true);
  });

  it('accepts optional rosterVersion', () => {
    expect(removeParticipantSchema.safeParse({ rosterVersion: 5 }).success).toBe(true);
  });

  it('rejects non-integer rosterVersion', () => {
    expect(removeParticipantSchema.safeParse({ rosterVersion: 1.5 }).success).toBe(false);
  });
});

describe('memberCancelSchema', () => {
  it('accepts empty object', () => {
    expect(memberCancelSchema.safeParse({}).success).toBe(true);
  });

  it('accepts valid acting_as_email', () => {
    expect(memberCancelSchema.safeParse({ acting_as_email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects invalid acting_as_email', () => {
    expect(memberCancelSchema.safeParse({ acting_as_email: 'bad' }).success).toBe(false);
  });
});
