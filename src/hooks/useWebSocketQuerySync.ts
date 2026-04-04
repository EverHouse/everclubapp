import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bookingsKeys, simulatorKeys, financialsKeys, cafeKeys, toursKeys, commandCenterKeys } from './queries/adminKeys';
import { bookGolfKeys } from '../pages/Member/BookGolf/bookGolfTypes';
import { createBatchedInvalidator } from '../lib/batchedInvalidation';

const directoryKeys = {
  all: ['directory'] as const,
  syncStatus: () => [...directoryKeys.all, 'sync-status'] as const,
  team: () => [...directoryKeys.all, 'team'] as const,
};

const eventKeys = {
  all: ['admin-events'] as const,
  needsReview: () => ['events-needs-review'] as const,
  rsvps: (eventId?: number) => eventId ? ['event-rsvps', eventId] as const : ['event-rsvps'] as const,
};

const wellnessKeys = {
  all: ['wellness-classes'] as const,
  needsReview: () => ['wellness-needs-review'] as const,
  enrollments: (classId?: number) => classId ? ['class-enrollments', classId] as const : ['class-enrollments'] as const,
};

export function useWebSocketQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const batcher = createBatchedInvalidator(queryClient);
    const batchedInvalidate = batcher.invalidate;

    const invalidateCommandCenterBookings = () => {
      batchedInvalidate({ queryKey: commandCenterKeys.all });
    };

    const handleBookingUpdate = (event: CustomEvent) => {
      const detail = event.detail;
      if (!detail) return;

      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      invalidateCommandCenterBookings();

      if (detail.eventType === 'check_in' || detail.eventType === 'check_out' || detail.eventType === 'payment') {
        batchedInvalidate({ queryKey: financialsKeys.all });
      }

      if (detail.eventType?.startsWith('rsvp_')) {
        batchedInvalidate({ queryKey: eventKeys.all });
        batchedInvalidate({ queryKey: eventKeys.needsReview() });
        if (detail.bookingId) {
          batchedInvalidate({ queryKey: eventKeys.rsvps(detail.bookingId) });
        }
      }

      if (detail.eventType?.startsWith('wellness_')) {
        batchedInvalidate({ queryKey: wellnessKeys.all });
        batchedInvalidate({ queryKey: wellnessKeys.needsReview() });
        if (detail.bookingId) {
          batchedInvalidate({ queryKey: wellnessKeys.enrollments(detail.bookingId) });
        }
      }
    };

    const handleBookingActionCompleted = () => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      invalidateCommandCenterBookings();
    };

    const handleCafeMenuUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: cafeKeys.all });
    };

    const handleTourUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: toursKeys.all });
      batchedInvalidate({ queryKey: commandCenterKeys.scheduling() });
    };

    const handleDirectoryUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: directoryKeys.all });
      batchedInvalidate({ queryKey: directoryKeys.team() });
      batchedInvalidate({ queryKey: commandCenterKeys.hubspotContacts() });
    };

    const handleBillingUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: financialsKeys.all });
      batchedInvalidate({ queryKey: ['member'] });
      batchedInvalidate({ queryKey: directoryKeys.all });
      batchedInvalidate({ queryKey: commandCenterKeys.facility() });
    };

    const handleTierUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['members'] });
      batchedInvalidate({ queryKey: ['member'] });
      batchedInvalidate({ queryKey: ['membership-tiers'] });
      batchedInvalidate({ queryKey: directoryKeys.all });
    };

    const handleMemberStatsUpdated = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['member'] });
      batchedInvalidate({ queryKey: ['members'] });
      batchedInvalidate({ queryKey: bookGolfKeys.all });
    };

    const handleMemberDataUpdated = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['members'] });
      batchedInvalidate({ queryKey: ['member'] });
      batchedInvalidate({ queryKey: directoryKeys.all });
    };

    const handleDataIntegrityUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['data-integrity'] });
    };

    const handleDayPassUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookGolfKeys.all });
      batchedInvalidate({ queryKey: directoryKeys.all });
    };

    const handleClosureUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['closures'] });
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: bookGolfKeys.all });
      batchedInvalidate({ queryKey: commandCenterKeys.facility() });
    };

    const handleBookingRosterUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      batchedInvalidate({ queryKey: financialsKeys.all });
      batchedInvalidate({ queryKey: bookGolfKeys.all });
      invalidateCommandCenterBookings();
    };

    const handleBookingInvoiceUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: financialsKeys.all });
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: ['member'] });
    };

    const handleWaitlistUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      batchedInvalidate({ queryKey: bookGolfKeys.all });
      batchedInvalidate({ queryKey: wellnessKeys.all });
    };

    const handleTrackmanUnmatchedUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: ['trackman', 'unmatched'] });
      batchedInvalidate({ queryKey: ['trackman', 'needs-players'] });
      batchedInvalidate({ queryKey: ['data-integrity'] });
    };

    const handleBookingAutoConfirmed = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      invalidateCommandCenterBookings();
    };

    const handleBookingConfirmed = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      invalidateCommandCenterBookings();
    };

    const handleAvailabilityUpdate = (_event: CustomEvent) => {
      batchedInvalidate({ queryKey: bookingsKeys.all });
      batchedInvalidate({ queryKey: simulatorKeys.all });
      batchedInvalidate({ queryKey: bookGolfKeys.all });
      batchedInvalidate({ queryKey: commandCenterKeys.facility() });
    };

    window.addEventListener('booking-update', handleBookingUpdate as EventListener);
    window.addEventListener('booking-action-completed', handleBookingActionCompleted as EventListener);
    window.addEventListener('cafe-menu-update', handleCafeMenuUpdate as EventListener);
    window.addEventListener('tour-update', handleTourUpdate as EventListener);
    window.addEventListener('directory-update', handleDirectoryUpdate as EventListener);
    window.addEventListener('billing-update', handleBillingUpdate as EventListener);
    window.addEventListener('tier-update', handleTierUpdate as EventListener);
    window.addEventListener('member-stats-updated', handleMemberStatsUpdated as EventListener);
    window.addEventListener('member-data-updated', handleMemberDataUpdated as EventListener);
    window.addEventListener('data-integrity-update', handleDataIntegrityUpdate as EventListener);
    window.addEventListener('day-pass-update', handleDayPassUpdate as EventListener);
    window.addEventListener('closure-update', handleClosureUpdate as EventListener);
    window.addEventListener('booking-auto-confirmed', handleBookingAutoConfirmed as EventListener);
    window.addEventListener('booking-confirmed', handleBookingConfirmed as EventListener);
    window.addEventListener('availability-update', handleAvailabilityUpdate as EventListener);
    window.addEventListener('trackman-unmatched-update', handleTrackmanUnmatchedUpdate as EventListener);
    window.addEventListener('booking-roster-update', handleBookingRosterUpdate as EventListener);
    window.addEventListener('booking-invoice-update', handleBookingInvoiceUpdate as EventListener);
    window.addEventListener('waitlist-update', handleWaitlistUpdate as EventListener);

    return () => {
      batcher.cancel();
      window.removeEventListener('booking-update', handleBookingUpdate as EventListener);
      window.removeEventListener('booking-action-completed', handleBookingActionCompleted as EventListener);
      window.removeEventListener('cafe-menu-update', handleCafeMenuUpdate as EventListener);
      window.removeEventListener('tour-update', handleTourUpdate as EventListener);
      window.removeEventListener('directory-update', handleDirectoryUpdate as EventListener);
      window.removeEventListener('billing-update', handleBillingUpdate as EventListener);
      window.removeEventListener('tier-update', handleTierUpdate as EventListener);
      window.removeEventListener('member-stats-updated', handleMemberStatsUpdated as EventListener);
      window.removeEventListener('member-data-updated', handleMemberDataUpdated as EventListener);
      window.removeEventListener('data-integrity-update', handleDataIntegrityUpdate as EventListener);
      window.removeEventListener('day-pass-update', handleDayPassUpdate as EventListener);
      window.removeEventListener('closure-update', handleClosureUpdate as EventListener);
      window.removeEventListener('booking-auto-confirmed', handleBookingAutoConfirmed as EventListener);
      window.removeEventListener('booking-confirmed', handleBookingConfirmed as EventListener);
      window.removeEventListener('availability-update', handleAvailabilityUpdate as EventListener);
      window.removeEventListener('trackman-unmatched-update', handleTrackmanUnmatchedUpdate as EventListener);
      window.removeEventListener('booking-roster-update', handleBookingRosterUpdate as EventListener);
      window.removeEventListener('booking-invoice-update', handleBookingInvoiceUpdate as EventListener);
      window.removeEventListener('waitlist-update', handleWaitlistUpdate as EventListener);
    };
  }, [queryClient]);
}
