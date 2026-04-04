import React from 'react';
import Icon from '../../../../components/icons/Icon';
import type { IssueActionSharedProps } from './issueActionTypes';

const MemberSyncIssueActions: React.FC<IssueActionSharedProps> = ({
  issue,
  fixIssueMutation,
  fixingIssues,
  loadingMemberEmail,
  handleViewProfile,
  undoAction,
}) => {
  return (
    <>
      {!issue.ignored && issue.table === 'users' && issue.category === 'sync_mismatch' && issue.description?.toLowerCase().includes('tier') && issue.context?.userId && (
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
          {(() => {
            const tierComparison = issue.context?.syncComparison?.find(c => c.field === 'Membership Tier' || c.field === 'App Tier vs Stripe Product');
            return tierComparison?.externalValue ? (
              <button
                type="button"
                onClick={() => {
                  const stripeTier = String(tierComparison.externalValue || '');
                  if (confirm(`Accept Stripe tier "${stripeTier}" for "${issue.context?.memberName}"? This will update their database tier to match Stripe.`)) {
                    fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/accept-tier', body: { userId: String(issue.context?.userId), acceptedTier: stripeTier, source: 'stripe' } });
                  }
                }}
                disabled={fixingIssues.has(String(issue.context?.userId))}
                className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
                title="Accept tier from Stripe"
              >
                {fixingIssues.has(String(issue.context?.userId)) ? (
                  <Icon name="progress_activity" className="animate-spin text-[16px]" />
                ) : (
                  <Icon name="sync" className="text-[16px]" />
                )}
              </button>
            ) : null;
          })()}
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'data_quality' && issue.context?.errorType === 'orphaned_stripe_customer' && issue.context?.userId && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
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
              if (confirm(`Clear the orphaned Stripe customer ID for "${issue.context?.memberName || 'this member'}"? The Stripe customer no longer exists.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/clear-stripe-customer-id', body: { userId: String(issue.context?.userId) } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Clear orphaned Stripe customer ID"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="link_off" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'data_quality' && issue.context?.errorType !== 'orphaned_stripe_customer' && issue.description?.toLowerCase().includes('stripe') && issue.context?.memberEmail && (
        <button
          type="button"
          onClick={() => handleViewProfile(issue.context!.memberEmail!)}
          disabled={loadingMemberEmail === issue.context?.memberEmail}
          className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
          title="View member profile"
        >
          <Icon name="person" className="text-[16px]" />
        </button>
      )}
      {!issue.ignored && issue.table === 'tours' && issue.category === 'data_quality' && (
        <>
          <button
            type="button"
            onClick={() => {
              undoAction({
                message: `Tour for "${issue.context?.guestName || 'guest'}" marked completed`,
                onExecute: async () => {
                  await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/update-tour-status', body: { recordId: issue.recordId, newStatus: 'completed' } });
                },
              });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark tour as completed"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="check_circle" className="text-[16px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              undoAction({
                message: `Tour for "${issue.context?.guestName || 'guest'}" marked no-show`,
                onExecute: async () => {
                  await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/update-tour-status', body: { recordId: issue.recordId, newStatus: 'no_show' } });
                },
              });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark tour as no-show"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="person_off" className="text-[16px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              undoAction({
                message: `Tour for "${issue.context?.guestName || 'guest'}" cancelled`,
                onExecute: async () => {
                  await fixIssueMutation.mutateAsync({ endpoint: '/api/data-integrity/fix/update-tour-status', body: { recordId: issue.recordId, newStatus: 'cancelled' } });
                },
              });
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
            title="Cancel tour"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="cancel" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'booking_sessions' && issue.category === 'data_quality' && (
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete session #${issue.recordId} with invalid times? This cannot be undone.`)) {
              fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/delete-empty-session', body: { recordId: issue.recordId } });
            }
          }}
          disabled={fixingIssues.has(String(issue.recordId))}
          className="p-1.5 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
          title="Delete invalid session"
        >
          {fixingIssues.has(String(issue.recordId)) ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="delete" className="text-[16px]" />
          )}
        </button>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'sync_mismatch' && issue.context?.billingProvider === 'mindbody' && issue.context?.stripeSubscriptionId && issue.context.stripeSubscriptionId !== 'none' && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
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
              if (confirm(`Switch "${issue.context?.memberName}" billing to Stripe? This member has a Stripe subscription but is marked as MindBody-billed.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'stripe' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Switch billing to Stripe"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="swap_horiz" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'sync_mismatch' && issue.context?.billingProvider === 'none' && issue.context?.userId && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
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
              if (confirm(`Set "${issue.context?.memberName}" billing provider to Stripe?`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'stripe' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Set billing to Stripe"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="credit_card" className="text-[16px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Set "${issue.context?.memberName}" billing provider to manual?`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'manual' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
            title="Set billing to manual"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="edit_note" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {!issue.ignored && issue.category === 'billing_issue' && issue.context?.userId && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
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
              if (confirm(`Reconnect "${issue.context?.memberName}" to Stripe? This will search Stripe by email (${issue.context?.memberEmail}) and restore their customer + subscription IDs. No new charges.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/reconnect-stripe-subscription', body: { userId: String(issue.context?.userId) } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
            title="Reconnect to Stripe — find existing customer & subscription by email"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="link" className="text-[16px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Mark "${issue.context?.memberName}" as COMPED? Their tier and active status will be kept, but billing provider will be set to comped. No Stripe charges will be created.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'comped' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark as Comped — keep tier, no billing"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="volunteer_activism" className="text-[16px]" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Mark "${issue.context?.memberName}" as MANUAL billing? Their tier and active status will be kept, billing will be tracked outside the system.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/change-billing-provider', body: { userId: String(issue.context?.userId), newProvider: 'manual' } });
              }
            }}
            disabled={fixingIssues.has(String(issue.context?.userId))}
            className="p-1.5 text-purple-600 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark as Manual — billed outside the system"
          >
            {fixingIssues.has(String(issue.context?.userId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="edit_note" className="text-[16px]" />
            )}
          </button>
          {issue.context?.stripeCustomerId === 'none' && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Search Stripe for "${issue.context?.memberEmail}" and link the customer record? This will NOT create a subscription or charge them.`)) {
                  fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/link-stripe-customer-only', body: { userId: String(issue.context?.userId) } });
                }
              }}
              disabled={fixingIssues.has(String(issue.context?.userId))}
              className="p-1.5 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30 rounded transition-colors disabled:opacity-50"
              title="Link Stripe Customer (no subscription)"
            >
              {fixingIssues.has(String(issue.context?.userId)) ? (
                <Icon name="progress_activity" className="animate-spin text-[16px]" />
              ) : (
                <Icon name="link" className="text-[16px]" />
              )}
            </button>
          )}
        </>
      )}
      {!issue.ignored && issue.table === 'users' && issue.category === 'data_quality' && issue.description?.includes('waiver') && (
        <>
          {issue.context?.memberEmail && (
            <button
              type="button"
              onClick={() => handleViewProfile(issue.context!.memberEmail!)}
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
              if (confirm(`Mark waiver as signed for "${issue.context?.memberName || 'this member'}"? Use this if the member has signed their waiver in person.`)) {
                fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/mark-waiver-signed', body: { recordId: issue.recordId } });
              }
            }}
            disabled={fixingIssues.has(String(issue.recordId))}
            className="p-1.5 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 rounded transition-colors disabled:opacity-50"
            title="Mark waiver as signed"
          >
            {fixingIssues.has(String(issue.recordId)) ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="verified" className="text-[16px]" />
            )}
          </button>
        </>
      )}
    </>
  );
};

export default MemberSyncIssueActions;
