import React from 'react';
import Icon from '../../../../components/icons/Icon';
import type { IssueActionSharedProps } from './issueActionTypes';

const MemberBillingIssueActions: React.FC<IssueActionSharedProps> = ({
  issue,
  fixIssueMutation,
  fixingIssues,
  setBookingSheet,
  loadingMemberEmail,
  handleViewProfile,
}) => {
  return (
    <>
      {!issue.ignored && issue.table === 'booking_requests' && issue.category === 'billing_issue' && typeof issue.recordId === 'number' && (
        <button
          type="button"
          onClick={() => setBookingSheet({
            isOpen: true,
            bookingId: issue.recordId as number,
            memberEmail: issue.context?.memberEmail || issue.context?.userEmail,
            bookingDate: issue.context?.bookingDate,
            timeSlot: issue.context?.startTime,
          })}
          className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
          title="Open booking to review and create invoice"
        >
          <Icon name="open_in_new" className="text-[16px]" />
        </button>
      )}
      {!issue.ignored && issue.table === 'booking_requests' && issue.category === 'billing_issue' && typeof issue.recordId === 'string' && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
              disabled={loadingMemberEmail === issue.context?.memberEmail}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
              title="View member profile to review billing"
            >
              <Icon name="person" className="text-[16px]" />
            </button>
          )}
          {issue.context?.bookingIds && issue.context.bookingIds.length > 0 && (
            <button
              type="button"
              onClick={() => setBookingSheet({
                isOpen: true,
                bookingId: issue.context!.bookingIds![0],
                memberEmail: issue.context?.memberEmail,
              })}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors"
              title={`Open first booking (#${issue.context.bookingIds[0]}) sharing this invoice`}
            >
              <Icon name="open_in_new" className="text-[16px]" />
            </button>
          )}
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'sync_mismatch' && issue.context?.memberStatus && ['pending', 'non-member'].includes(issue.context.memberStatus) && (
        <>
          <button
            type="button"
            onClick={() => {
              if (issue.context?.memberEmail) handleViewProfile(issue.context.memberEmail);
            }}
            disabled={loadingMemberEmail === issue.context?.memberEmail}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
            title="View member profile"
          >
            <Icon name="person" className="text-[16px]" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Activate "${issue.context?.memberName || 'this member'}"? Their status will change to active.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/activate-stuck-member', body: { userId: issue.context?.userId } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Activate this member"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="check_circle" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.context?.issueType === 'stale_subscription' && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => {
                if (issue.context?.memberEmail) handleViewProfile(issue.context.memberEmail);
              }}
              disabled={loadingMemberEmail === issue.context?.memberEmail}
              className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
              title="View member profile"
            >
              <Icon name="person" className="text-[16px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (confirm(`Clear stale subscription for "${issue.context?.memberName || 'this member'}"? ${['active', 'past_due', 'trialing'].includes(issue.context?.memberStatus || '') ? 'Their status will change to inactive.' : 'Their status will remain unchanged.'}`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/clear-stale-subscription', body: { userId: issue.context?.userId } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Clear stale subscription ID"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="link_off" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'guest_passes' && issue.category === 'billing_issue' && (
        <button
          type="button"
          onClick={() => {
            if (confirm('Recalculate guest pass usage from actual booking records?')) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/recalculate-guest-passes', body: { userId: issue.context?.userId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.context?.userId))}
          className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
          title="Recalculate guest pass usage"
        >
          {fixingIssues.has(String(issue.context?.userId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="calculate" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'guest_pass_holds' && issue.category === 'orphan_record' && (
        <button
          type="button"
          onClick={() => {
            if (confirm('Release this expired guest pass hold?')) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/release-guest-pass-hold', body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Release expired hold"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="lock_open" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'usage_ledger' && issue.category === 'billing_issue' && (
        <button
          type="button"
          onClick={() => {
            fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/recalculate-session-fees', body: { recordId: issue.recordId } });
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
          title="Recalculate fees for this session"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="calculate" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'payment_intents' && issue.category === 'orphan_record' && (
        <button
          type="button"
          onClick={() => {
            if (confirm('Cancel this orphaned payment intent in Stripe?')) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/cancel-orphaned-pi', body: { paymentIntentId: String(issue.recordId) } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Cancel orphaned payment intent"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="money_off" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'wellness_enrollments' && issue.category === 'orphan_record' && (
        <button
          type="button"
          onClick={() => {
            if (confirm('Delete this orphaned wellness enrollment?')) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-orphan-enrollment', body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Delete orphaned enrollment"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'event_rsvps' && issue.category === 'orphan_record' && (
        <button
          type="button"
          onClick={() => {
            if (confirm('Delete this orphaned event RSVP?')) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-orphan-rsvp', body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Delete orphaned RSVP"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && (issue.table === 'notifications' || issue.table === 'push_subscriptions' || issue.table === 'user_dismissed_notices') && issue.category === 'orphan_record' && issue.context?.email && (
        <button
          type="button"
          onClick={() => {
            const count = issue.context?.count || 'all';
            if (confirm(`Delete ${count} orphaned ${issue.table?.replace(/_/g, ' ')} record(s) for "${issue.context?.email}"?`)) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-orphan-records-by-email', body: { table: issue.table, email: issue.context?.email } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title={`Delete orphaned ${issue.table?.replace(/_/g, ' ')} records`}
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
    </>
  );
};

export default MemberBillingIssueActions;
