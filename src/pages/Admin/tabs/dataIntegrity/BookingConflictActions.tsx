import React from 'react';
import Icon from '../../../../components/icons/Icon';
import { formatTimeForSheet } from './integrityHelpers';
import type { IssueActionSharedProps } from './issueActionTypes';

const BookingConflictActions: React.FC<IssueActionSharedProps> = ({
  issue,
  fixIssueMutation,
  fixingIssues,
  cancellingBookings,
  handleCancelBooking,
  setBookingSheet,
  loadingMemberEmail,
  handleViewProfile,
}) => {
  return (
    <>
      {!issue.ignored && issue.table === 'booking_sessions' && issue.category === 'orphan_record' && (
        <>
          <button
            onClick={() => setBookingSheet({
              isOpen: true,
              bookingId: (issue.context?.linkedBookingId as number) || null,
              sessionId: issue.recordId,
              bayName: issue.context?.resourceName as string,
              bookingDate: issue.context?.bookingDate as string,
              timeSlot: `${formatTimeForSheet(issue.context?.startTime as string)} - ${formatTimeForSheet(issue.context?.endTime as string)}`,
              trackmanBookingId: issue.context?.trackmanBookingId as string,
              isUnmatched: true,
            })}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
            title="Assign member to this session"
          >
            <Icon name="person_add" className="text-[16px]" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete empty session #${issue.recordId}? This cannot be undone.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-empty-session', body: { recordId: issue.recordId } });
              }
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Delete empty session"
          >
            <Icon name="delete" className="text-[16px]" />
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.description?.includes('has no email') && (
        <button
          onClick={() => {
            if (confirm(`Delete member "${issue.context?.memberName || 'Unknown'}" (id: ${issue.recordId})? This will permanently remove their account and related records. This cannot be undone.`)) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-member-no-email', body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Delete this member (no email)"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && (issue.context?.email || (issue.context?.memberEmails && issue.context.memberEmails.length > 0)) && ((issue.context as Record<string, unknown> & { stripeCustomerIds?: string[] })?.stripeCustomerIds || issue.context?.stripeCustomerId) && (
        <button
          onClick={() => handleViewProfile(issue.context!.email || (issue.context!.memberEmails as unknown as string[] | undefined)?.[0] || '')}
          disabled={loadingMemberEmail === (issue.context!.email || (issue.context!.memberEmails as unknown as string[] | undefined)?.[0])}
          className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
          title="View member profile"
        >
          <Icon name="person" className="text-[16px]" />
        </button>
      )}
      {!issue.ignored && issue.context?.userId && issue.category === 'sync_mismatch' && issue.context?.memberEmail && (
        <>
          <button
            onClick={() => handleViewProfile(issue.context!.memberEmail!)}
            disabled={loadingMemberEmail === issue.context.memberEmail}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
            title="View member profile"
          >
            <Icon name="person" className="text-[16px]" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Deactivate "${issue.context?.memberName}"? This will set their membership to inactive.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/deactivate-stale-member', body: { userId: issue.context?.userId } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
            title="Deactivate member"
          >
            <Icon name="person_off" className="text-[16px]" />
          </button>
        </>
      )}
      {!issue.ignored && issue.context?.userId && issue.context?.mindbodyClientId === 'none' && issue.context?.billingProvider !== 'none' && !(issue.context?.billingProvider === 'mindbody' && issue.context?.stripeSubscriptionId && issue.context.stripeSubscriptionId !== 'none') && (
        <>
          <button
            onClick={() => handleViewProfile(issue.context!.memberEmail!)}
            disabled={loadingMemberEmail === issue.context.memberEmail}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
            title="View member profile"
          >
            <Icon name="person" className="text-[16px]" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Switch "${issue.context?.memberName}" billing to manual? This removes MindBody as their billing provider.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'manual' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
            title="Switch to manual billing"
          >
            <Icon name="swap_horiz" className="text-[16px]" />
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'booking_sessions' && issue.category === 'booking_issue' && (
        <>
          {issue.context?.booking1Id && (
            <button
              type="button"
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: issue.context!.booking1Id as number,
                memberEmail: issue.context?.member1Email as string,
                bookingDate: issue.context?.bookingDate as string,
                timeSlot: issue.context?.startTime as string,
              })}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
              title={`Open booking #${issue.context.booking1Id}${issue.context?.member1Name ? ` (${issue.context.member1Name})` : ''}`}
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
          {issue.context?.booking1Id && (
            <button
              type="button"
              onClick={() => handleCancelBooking(issue.context!.booking1Id as number)}
              disabled={cancellingBookings.has(issue.context!.booking1Id as number)}
              className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
              title={`Cancel booking #${issue.context.booking1Id}`}
            >
              {cancellingBookings.has(issue.context!.booking1Id as number) ? (
                <Icon name="progress_activity" className="animate-spin text-[16px]" />
              ) : (
                <Icon name="cancel" className="text-[16px]" />
              )}
            </button>
          )}
          {issue.context?.booking2Id && (
            <button
              type="button"
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: issue.context!.booking2Id as number,
                memberEmail: issue.context?.member2Email as string,
                bookingDate: issue.context?.bookingDate as string,
                timeSlot: issue.context?.startTime as string,
              })}
              className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors"
              title={`Open booking #${issue.context.booking2Id}${issue.context?.member2Name ? ` (${issue.context.member2Name})` : ''}`}
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
          {issue.context?.booking2Id && (
            <button
              type="button"
              onClick={() => handleCancelBooking(issue.context!.booking2Id as number)}
              disabled={cancellingBookings.has(issue.context!.booking2Id as number)}
              className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
              title={`Cancel booking #${issue.context.booking2Id}`}
            >
              {cancellingBookings.has(issue.context!.booking2Id as number) ? (
                <Icon name="progress_activity" className="animate-spin text-[16px]" />
              ) : (
                <Icon name="cancel" className="text-[16px]" />
              )}
            </button>
          )}
          {issue.context?.session1Id && !issue.context?.booking1Id && (
            <button
              type="button"
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: null,
                sessionId: String(issue.context!.session1Id),
                bayName: issue.context?.resourceName as string,
                bookingDate: issue.context?.bookingDate as string,
                timeSlot: `${formatTimeForSheet(issue.context?.startTime as string)} - ${formatTimeForSheet(issue.context?.endTime as string)}`,
              })}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
              title={`View session #${issue.context.session1Id}`}
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
          {issue.context?.session2Id && !issue.context?.booking2Id && (
            <button
              type="button"
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: null,
                sessionId: String(issue.context!.session2Id),
                bayName: issue.context?.resourceName as string,
                bookingDate: issue.context?.bookingDate as string,
                timeSlot: `${formatTimeForSheet(issue.context?.s2Start as string)} - ${formatTimeForSheet(issue.context?.s2End as string)}`,
              })}
              className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors"
              title={`View session #${issue.context.session2Id}`}
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
        </>
      )}
    </>
  );
};

export default BookingConflictActions;
