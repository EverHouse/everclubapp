import sys

content = open('server/core/integrity/core.ts').read()

marker1 = """<<<<<<< HEAD
  const { checkUnmatchedTrackmanBookings, checkStalePastTours, checkBookingsWithoutSessions, checkOverlappingBookings, checkSessionsWithoutParticipants, checkGuestPassAccountingDrift, checkStalePendingBookings, checkStaleCheckedInBookings, checkStuckUnpaidBookings, checkApprovedBookingsForInactiveMembers, checkUsageLedgerGaps, checkSessionsExceedingResourceCapacity } = await import('./bookingChecks');
=======
  const { checkUnmatchedTrackmanBookings, checkStalePastTours, checkBookingsWithoutSessions, checkOverlappingBookings, checkSessionsWithoutParticipants, checkGuestPassAccountingDrift, checkStalePendingBookings, checkStaleCheckedInBookings, checkStuckUnpaidBookings, checkApprovedBookingsForInactiveMembers, checkUsageLedgerGaps, checkSessionOverlaps, checkWellnessBlockGaps } = await import('./bookingChecks');
>>>>>>> 264e0190 (Task #374: Integrity check for session overlaps across all resource types)"""

resolved1 = """  const { 
    checkUnmatchedTrackmanBookings, checkStalePastTours, checkBookingsWithoutSessions, 
    checkOverlappingBookings, checkSessionsWithoutParticipants, checkGuestPassAccountingDrift, 
    checkStalePendingBookings, checkStaleCheckedInBookings, checkStuckUnpaidBookings, 
    checkApprovedBookingsForInactiveMembers, checkUsageLedgerGaps, 
    checkSessionsExceedingResourceCapacity, checkSessionOverlaps, checkWellnessBlockGaps 
  } = await import('./bookingChecks');"""

if marker1 in content:
    content = content.replace(marker1, resolved1)
    print("Resolved runAllIntegrityChecks imports")
else:
    print("Failed to find runAllIntegrityChecks imports marker")

open('server/core/integrity/core.ts', 'w').write(content)
