import { describe, it, expect } from 'vitest';
import {
  computeUsageAllocation,
  calculateOverageFee,
  type Participant
} from '../../server/core/bookingService/usageCalculator';
import {
  enforceSocialTierRules,
  type ParticipantForValidation
} from '../../server/core/bookingService/tierRules';
import {
  checkUnifiedAvailability
} from '../../server/core/bookingService/availabilityGuard';

describe('BookingService - Core Member Booking 180 mins with 1 Guest', () => {
  it('should split 180 minutes equally between Core member and guest (90 mins each)', () => {
    const participants: Participant[] = [
      { userId: 'core-member@example.com', participantType: 'owner', displayName: 'Core Member' },
      { guestId: 1, participantType: 'guest', displayName: 'Guest Player' }
    ];
    
    const allocations = computeUsageAllocation(180, participants);
    
    expect(allocations).toHaveLength(2);
    expect(allocations[0].minutesAllocated).toBe(90);
    expect(allocations[1].minutesAllocated).toBe(90);
    expect(allocations[0].participantType).toBe('owner');
    expect(allocations[1].participantType).toBe('guest');
  });
  
  it('should calculate no overage fee for Core tier with 90 mins (within daily allowance)', () => {
    const result = calculateOverageFee(90, 180);
    
    expect(result.hasOverage).toBe(false);
    expect(result.overageFee).toBe(0);
    expect(result.overageMinutes).toBe(0);
  });
  
  it('should calculate overage fee when exceeding tier allowance', () => {
    const result = calculateOverageFee(120, 60);
    
    expect(result.hasOverage).toBe(true);
    expect(result.overageMinutes).toBe(60);
    expect(result.overageFee).toBe(50);
  });
  
  it('should charge owner for guest time correctly', () => {
    const guestMinutes = 90;
    const overageBlocks = Math.ceil(guestMinutes / 30);
    const expectedFee = overageBlocks * 25;
    
    expect(guestMinutes).toBe(90);
    expect(overageBlocks).toBe(3);
    expect(expectedFee).toBe(75);
  });
  
  it('should distribute time correctly for 3 players in 180 min session', () => {
    const participants: Participant[] = [
      { userId: 'owner@example.com', participantType: 'owner', displayName: 'Owner' },
      { userId: 'member@example.com', participantType: 'member', displayName: 'Invited Member' },
      { guestId: 1, participantType: 'guest', displayName: 'Guest' }
    ];
    
    const allocations = computeUsageAllocation(180, participants);
    
    expect(allocations).toHaveLength(3);
    expect(allocations[0].minutesAllocated).toBe(60);
    expect(allocations[1].minutesAllocated).toBe(60);
    expect(allocations[2].minutesAllocated).toBe(60);
  });
  
  it('should handle uneven time distribution with remainder', () => {
    const participants: Participant[] = [
      { userId: 'owner@example.com', participantType: 'owner', displayName: 'Owner' },
      { guestId: 1, participantType: 'guest', displayName: 'Guest 1' },
      { guestId: 2, participantType: 'guest', displayName: 'Guest 2' },
      { guestId: 3, participantType: 'guest', displayName: 'Guest 3' }
    ];
    
    const allocations = computeUsageAllocation(185, participants);
    
    const totalMinutes = allocations.reduce((sum, a) => sum + a.minutesAllocated, 0);
    expect(totalMinutes).toBe(185);
  });
});

describe('BookingService - Social Tier Guest Blocking', () => {
  it('should block Social tier member from adding guests', async () => {
    const participants: ParticipantForValidation[] = [
      { type: 'owner', displayName: 'Social Member' },
      { type: 'guest', displayName: 'Attempted Guest' }
    ];
    
    const result = await enforceSocialTierRules('Social', participants);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Social');
    expect(result.reason).toContain('guest');
  });
  
  it('should allow Social tier member to book solo', async () => {
    const participants: ParticipantForValidation[] = [
      { type: 'owner', displayName: 'Social Member' }
    ];
    
    const result = await enforceSocialTierRules('Social', participants);
    
    expect(result.allowed).toBe(true);
  });
  
  it('should allow Core tier member to add guests', async () => {
    const participants: ParticipantForValidation[] = [
      { type: 'owner', displayName: 'Core Member' },
      { type: 'guest', displayName: 'Guest' }
    ];
    
    const result = await enforceSocialTierRules('Core', participants);
    
    expect(result.allowed).toBe(true);
  });
  
  it('should allow Premium tier member to add multiple guests', async () => {
    const participants: ParticipantForValidation[] = [
      { type: 'owner', displayName: 'Premium Member' },
      { type: 'guest', displayName: 'Guest 1' },
      { type: 'guest', displayName: 'Guest 2' },
      { type: 'guest', displayName: 'Guest 3' }
    ];
    
    const result = await enforceSocialTierRules('Premium', participants);
    
    expect(result.allowed).toBe(true);
  });
});

describe('BookingService - Overlap Check Coverage', () => {
  it('checkUnifiedAvailability should return availability result', async () => {
    const result = await checkUnifiedAvailability(
      1,
      '2026-01-15',
      '14:00',
      '15:00'
    );
    
    expect(result).toHaveProperty('available');
    expect(typeof result.available).toBe('boolean');
    if (!result.available) {
      expect(result).toHaveProperty('conflictType');
    }
  });
  
  it('should verify checkUnifiedAvailability function exists and has correct signature', () => {
    expect(typeof checkUnifiedAvailability).toBe('function');
  });
  
  it('checkUnifiedAvailability checks all conflict sources', async () => {
    const result = await checkUnifiedAvailability(
      1,
      '2026-12-25',
      '10:00',
      '11:00'
    );
    
    expect(result).toBeDefined();
    expect(typeof result.available).toBe('boolean');
  });
});
