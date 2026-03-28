export function parseTimeSlotToMinutes(timeStr: string): number {
  const [time, period] = timeStr.trim().split(/\s+/);
  // eslint-disable-next-line prefer-const
  let [h, m] = time.split(':').map(Number);
  if (period?.toUpperCase() === 'PM' && h !== 12) h += 12;
  if (period?.toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

export function parseDurationFromTimeSlot(timeSlot: string): number {
  const match = timeSlot.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  if (!match) return 60;
  const startMins = parseTimeSlotToMinutes(match[1]);
  const endMins = parseTimeSlotToMinutes(match[2]);
  return endMins > startMins ? endMins - startMins : 1440 - startMins + endMins;
}

export function buildFeeEstimateParams(opts: {
  ownerEmail: string;
  durationMinutes: number;
  playerCount: number;
  guestCount: number;
  date?: string;
  resourceType?: string;
  guestsWithInfo?: number;
  memberUserIds?: string[];
  memberEmails?: string[];
  viewAsEmail?: string;
  dayPassEmails?: string[];
  includeOwnerEmail?: boolean;
}): URLSearchParams {
  const {
    ownerEmail,
    durationMinutes,
    playerCount,
    guestCount,
    date,
    resourceType,
    guestsWithInfo,
    memberUserIds,
    memberEmails,
    viewAsEmail,
    dayPassEmails,
  } = opts;

  const params = new URLSearchParams({
    durationMinutes: durationMinutes.toString(),
    guestCount: guestCount.toString(),
    playerCount: playerCount.toString(),
  });

  if (date) params.set('date', date);
  if (resourceType) params.set('resourceType', resourceType);
  if (guestsWithInfo !== undefined) params.set('guestsWithInfo', guestsWithInfo.toString());
  if (memberUserIds && memberUserIds.length > 0) params.set('memberUserIds', memberUserIds.join(','));
  if (memberEmails && memberEmails.length > 0) params.set('memberEmails', memberEmails.join(','));
  if (viewAsEmail) params.set('email', viewAsEmail);
  else if (ownerEmail && opts.includeOwnerEmail) params.set('email', ownerEmail);
  if (dayPassEmails && dayPassEmails.length > 0) params.set('dayPassEmails', dayPassEmails.join(','));

  return params;
}

export function calculateEndTime(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(':').map(Number);
  const endTotalMinutes = (parts[0] * 60 + parts[1]) + durationMinutes;
  const endH = Math.floor(endTotalMinutes / 60) % 24;
  const endM = endTotalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

export function validatePlayerSlots(
  playerSlots: Array<{ type: string; selectedId?: string; email?: string; firstName?: string; lastName?: string; name?: string; selectedName?: string }>,
): { valid: boolean; error?: string } {
  const emptyMemberSlots = playerSlots.filter(slot => slot.type === 'member' && !slot.selectedId);
  if (emptyMemberSlots.length > 0) {
    return { valid: false, error: 'Please search and select a member for each Member slot, or switch unfilled slots to Guest.' };
  }

  const invalidGuestSlot = playerSlots.find(slot => slot.type === 'guest' && !slot.selectedId && slot.email && !slot.email.includes('@'));
  if (invalidGuestSlot) {
    return { valid: false, error: 'Please enter a valid email address for each guest.' };
  }

  const guestMissingEmail = playerSlots.find(slot => slot.type === 'guest' && slot.selectedId && !(slot.email && slot.email.includes('@')));
  if (guestMissingEmail) {
    return { valid: false, error: 'Guest slots require a valid email address. Please add an email for each guest.' };
  }

  return { valid: true };
}

export function buildRequestParticipants(
  playerSlots: Array<{ type: string; selectedId?: string; email?: string; name?: string; selectedName?: string }>
): Array<{ email?: string; type: string; userId?: string; name?: string }> | undefined {
  if (playerSlots.length === 0) return undefined;
  const filtered = playerSlots.filter(slot => slot.selectedId || (slot.email && slot.email.includes('@')));
  if (filtered.length === 0) return undefined;
  return filtered.map(slot => {
    const hasValidEmail = slot.email && slot.email.includes('@') && !slot.email.includes('*');
    return {
      email: hasValidEmail ? slot.email : undefined,
      type: slot.type,
      userId: slot.selectedId,
      name: slot.selectedId ? slot.selectedName : (slot.name || slot.selectedName)
    };
  });
}
