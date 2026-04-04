import React from 'react';
import Icon from '../../../../components/icons/Icon';
import { formatTimeForSheet } from './integrityHelpers';
import type { IssueActionSharedProps } from './issueActionTypes';
import type { IssueContext } from './dataIntegrityTypes';

const BookingIssueActions: React.FC<IssueActionSharedProps> = ({
  issue,
  fixIssueMutation,
  fixingIssues,
  cancellingBookings,
  handleCancelBooking,
  setBookingSheet,
  undoAction,
  loadingMemberEmail,
  handleViewProfile,
}) => {
  return (
    <>
      {issue.table === 'booking_requests' && !issue.ignored && issue.category !== 'billing_issue' && (
        <>
          {issue.context?.trackmanBookingId && (
            <button
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: issue.recordId as number,
                bayName: issue.context?.resourceName,
                bookingDate: issue.context?.bookingDate,
                timeSlot: issue.context?.startTime,
                memberName: issue.context?.memberName,
                memberEmail: issue.context?.memberEmail,
                trackmanBookingId: issue.context?.trackmanBookingId,
                importedName: issue.context?.importedName,
                notes: issue.context?.notes,
                originalEmail: issue.context?.originalEmail
              })}
              className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors"
              title="Review Unmatched Booking"
            >
              <Icon name="calendar_month" className="text-[16px]" />
            </button>
          )}
          {!issue.context?.trackmanBookingId && (
            <button
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: issue.recordId as number,
                bayName: issue.context?.resourceName,
                bookingDate: issue.context?.bookingDate,
                timeSlot: issue.context?.startTime,
                memberName: issue.context?.memberName,
                memberEmail: issue.context?.memberEmail,
              })}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
              title="Open booking details"
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
          <button
            onClick={() => handleCancelBooking(issue.recordId as number)}
            disabled={cancellingBookings.has(issue.recordId as number)}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Cancel this booking"
          >
            {cancellingBookings.has(issue.recordId as number) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="cancel" className="text-[16px]" />
            )}
          </button>
          <button
            onClick={() => {
              undoAction({
                message: `Booking #${issue.recordId} marked as attended`,
                onExecute: async () => {
                  await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/complete-booking', body: { recordId: issue.recordId } });
                },
              });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark as attended"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="check_circle" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'trackman_unmatched_bookings' && (
        <>
          <button
            onClick={() => setBookingSheet({
              isOpen: true,
              bookingId: issue.recordId as number,
              bayName: issue.context?.bayNumber ? `Bay ${issue.context.bayNumber}` : undefined,
              bookingDate: issue.context?.bookingDate,
              timeSlot: issue.context?.startTime,
              memberName: issue.context?.userName,
              memberEmail: issue.context?.userEmail,
              trackmanBookingId: issue.context?.trackmanBookingId,
              importedName: issue.context?.importedName || issue.context?.userName,
              notes: issue.context?.notes,
              originalEmail: issue.context?.originalEmail,
              isUnmatched: true
            })}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors"
            title="Assign to a member"
          >
            <Icon name="person_add" className="text-[16px]" />
          </button>
          <button
            onClick={() => {
              undoAction({
                message: 'Trackman booking dismissed',
                onExecute: async () => {
                  await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/dismiss-trackman-unmatched', body: { recordId: issue.recordId } });
                },
              });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Dismiss this unmatched booking"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="visibility_off" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && (issue.table === 'wellness_classes' || issue.table === 'events') && issue.description?.includes('needs review') && (
        <>
          <button
            onClick={() => {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/approve-review-item', body: { recordId: issue.recordId, table: issue.table } });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Approve this item"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="check_circle" className="text-[16px]" />
            )}
          </button>
          <button
            onClick={() => {
              if (confirm(`Remove this ${issue.table === 'wellness_classes' ? 'wellness class' : 'event'}? This cannot be undone.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-review-item', body: { recordId: issue.recordId, table: issue.table } });
              }
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Remove this item"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="delete" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'booking_participants' && issue.category === 'missing_relationship' && (
        <button
          onClick={() => {
            undoAction({
              message: `"${issue.context?.memberName || 'Participant'}" converted to guest`,
              onExecute: async () => {
                await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/convert-participant-to-guest', body: { recordId: issue.recordId } });
              },
            });
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
          title="Convert to guest (keeps booking record)"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="person_off" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'booking_fee_snapshots' && issue.context?.stripePaymentIntentId && (
        <button
          onClick={() => {
            if (confirm(`Cancel payment intent ${issue.context!.stripePaymentIntentId} in Stripe and mark the fee snapshot as cancelled?`)) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/cancel-orphaned-pi', body: { paymentIntentId: issue.context!.stripePaymentIntentId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.context?.stripePaymentIntentId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Cancel payment intent in Stripe"
        >
          {fixingIssues.has(String(issue.context?.stripePaymentIntentId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="money_off" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && (issue.table === 'guest_passes' || issue.table === 'booking_fee_snapshots' || issue.table === 'booking_participants') && (
        <button
          onClick={() => {
            if (confirm(`Delete this ${issue.table === 'guest_passes' ? 'guest pass' : issue.table === 'booking_fee_snapshots' ? 'fee snapshot' : 'participant'} record?`)) {
              const endpoint = issue.table === 'guest_passes'
                ? '/api/data-integrity/fix/delete-guest-pass'
                : issue.table === 'booking_fee_snapshots'
                ? '/api/data-integrity/fix/delete-fee-snapshot'
                : '/api/data-integrity/fix/delete-booking-participant';
              fixIssueMutation.mutate({ endpoint, body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Delete this orphaned record"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.context?.duplicateUsers && issue.context.duplicateUsers.length > 0 && (
        issue.context.duplicateUsers.map((user) => (
          <button
            key={user.userId}
            onClick={() => {
              if (confirm(`Unlink HubSpot contact from ${user.email}? This will make them a separate contact.`)) {
                fixIssueMutation.mutate({
                  endpoint: '/api/data-integrity/fix/unlink-hubspot',
                  body: { userId: user.userId, hubspotContactId: issue.context?.hubspotContactId }
                });
              }
            }}
            disabled={fixingIssues.has(String(user.userId))}
            className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
            title={`Unlink HubSpot from ${user.email}`}
          >
            {fixingIssues.has(String(user.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="link_off" className="text-[16px]" />
            )}
          </button>
        ))
      )}
      {!issue.ignored && issue.context?.duplicateUsers && issue.context.duplicateUsers.length === 2 && (
        <button
          onClick={() => {
            const users = issue.context!.duplicateUsers!;
            const primaryUser = users[0];
            const secondaryUser = users[1];
            if (confirm(`Merge ${secondaryUser.email} into ${primaryUser.email}? All records from ${secondaryUser.email} will be transferred to ${primaryUser.email} and ${secondaryUser.email} will be marked as merged.`)) {
              fixIssueMutation.mutate({
                endpoint: '/api/data-integrity/fix/merge-hubspot-duplicates',
                body: { 
                  primaryUserId: primaryUser.userId, 
                  secondaryUserId: secondaryUser.userId,
                  hubspotContactId: issue.context?.hubspotContactId
                }
              });
            }
          }}
          disabled={fixingIssues.has(String(issue.context.duplicateUsers[0]?.userId))}
          className="p-1.5 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
          title={`Merge ${issue.context.duplicateUsers[1]?.email} into ${issue.context.duplicateUsers[0]?.email}`}
        >
          {fixingIssues.has(String(issue.context.duplicateUsers[0]?.userId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="merge" className="text-[16px]" />
          )}
        </button>
      )}
    </>
  );
};

export default BookingIssueActions;
