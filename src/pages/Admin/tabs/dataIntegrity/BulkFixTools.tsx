import React from 'react';
import Icon from '../../../../components/icons/Icon';
import type { CheckFixToolsProps } from './CheckFixTools';

const BulkFixTools: React.FC<CheckFixToolsProps> = ({
  checkName,
  results,
  fixIssueMutation,
  selectedOrphans,
  setSelectedOrphans,
  toggleAllOrphans,
  isBulkActionRunning,
  batchProgress,
  handleBatchedBulkAction,
}) => {
  const normalizedCheckName = checkName.replace(/^\[DEV\]\s*/, '');

  switch (normalizedCheckName) {
    case 'Stale Stripe Subscription IDs': {
      const staleSubResult = results.find(r => r.checkName === 'Stale Stripe Subscription IDs');
      const staleSubIssues = staleSubResult?.issues.filter(i => !i.ignored) || [];
      const allStaleSubUserIds = staleSubIssues.map(i => String(i.context?.userId)).filter(Boolean);

      return (
        <div className="space-y-3 mb-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
            <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
              <strong>About:</strong> These members have Stripe subscription IDs in the database that no longer exist in Stripe.
              Clearing a stale subscription ID will also set active, past_due, or trialing members to inactive. Use the individual clear buttons below, or resolve all at once.
            </p>
          </div>
          {allStaleSubUserIds.length > 1 && (
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  <strong>{allStaleSubUserIds.length}</strong> stale subscription(s) found
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Clear all ${allStaleSubUserIds.length} stale subscription IDs? Active members will be set to inactive.`)) {
                      handleBatchedBulkAction(
                        '/api/data-integrity/fix/bulk-clear-stale-subscriptions',
                        allStaleSubUserIds,
                        {},
                        'Clear Stale Subscriptions'
                      );
                    }
                  }}
                  disabled={isBulkActionRunning}
                  className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  {isBulkActionRunning && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                  <Icon name="delete_sweep" className="text-[14px]" />
                  Clear All ({allStaleSubUserIds.length})
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'Stuck Transitional Members':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> These members have active Stripe subscriptions but are stuck in pending/non-member status. Use the activate button on individual issues below to fix them.
          </p>
        </div>
      );

    case 'Duplicate Stripe Customers':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Members with multiple Stripe customer records. Use the merge button on individual issues to consolidate into one customer record.
          </p>
        </div>
      );

    case 'Tier Reconciliation':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Members whose tier in the app doesn&apos;t match their Stripe subscription tier. Use the accept buttons on individual issues to resolve the mismatch.
          </p>
        </div>
      );

    case 'Invoice-Booking Reconciliation':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Bookings where participants have unpaid fees but no Stripe invoice was created. Open individual bookings below to review and create invoices.
          </p>
        </div>
      );

    case 'Guest Pass Accounting Drift':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Guest pass counts that don&apos;t match actual usage. Use recalculate buttons on individual issues, or release expired holds.
          </p>
        </div>
      );

    case 'Orphaned Payment Intents':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Payment intents in Stripe that aren&apos;t linked to any booking or invoice. Cancel them to keep your Stripe account clean.
          </p>
        </div>
      );

    case 'Billing Orphans': {
      const billingOrphansResult = results.find(r => r.checkName === 'Billing Orphans');
      const orphanIssues = billingOrphansResult?.issues.filter(i => !i.ignored) || [];
      const allOrphanUserIds = orphanIssues.map(i => String(i.context?.userId)).filter(Boolean);
      const stripeOrphans = orphanIssues.filter(i => i.context?.billingProvider === 'stripe');
      const otherOrphans = orphanIssues.filter(i => i.context?.billingProvider !== 'stripe');
      const selectedCount = allOrphanUserIds.filter(id => selectedOrphans.has(id)).length;
      const allSelected = allOrphanUserIds.length > 0 && allOrphanUserIds.every(id => selectedOrphans.has(id));
      const selectedUserIds = allOrphanUserIds.filter(id => selectedOrphans.has(id));

      return (
        <div className="space-y-3 mb-4">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <p className="text-xs text-red-700 dark:text-red-300 mb-2">
              <strong>Root Cause:</strong> The startup environment validation wiped Stripe subscription/customer IDs from the database when
              they didn&apos;t match the current Stripe environment. The actual Stripe customers and subscriptions still exist in Stripe.
              Use <strong>Reconnect Stripe</strong> to search Stripe by email and restore the connection.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <div className="flex items-center gap-3 mb-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => toggleAllOrphans(allOrphanUserIds)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Select All ({allOrphanUserIds.length})
              </label>
              {selectedCount > 0 && (
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  {selectedCount} selected
                </span>
              )}
              {isBulkActionRunning && batchProgress && (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                  <Icon name="progress_activity" className="animate-spin text-[14px]" />
                  {batchProgress.label}: batch {batchProgress.current} of {batchProgress.total}
                </span>
              )}
              {isBulkActionRunning && !batchProgress && (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                  <Icon name="progress_activity" className="animate-spin text-[14px]" />
                  Processing...
                </span>
              )}
            </div>
            {selectedCount > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    if (confirm(`Reconnect ${selectedCount} selected member(s) to Stripe? This will search Stripe for each member by email and restore their customer + subscription IDs. No new subscriptions or charges will be created.`)) {
                      handleBatchedBulkAction('/api/data-integrity/fix/bulk-reconnect-stripe', selectedUserIds, {}, 'Reconnect to Stripe');
                      setSelectedOrphans(new Set());
                    }
                  }}
                  disabled={fixIssueMutation.isPending || isBulkActionRunning}
                  className="tactile-btn px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  <Icon name="link" className="text-[14px]" />
                  Reconnect Selected to Stripe ({selectedCount})
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Mark ${selectedCount} selected member(s) as COMPED? Only use this if they should NOT be billed through Stripe.`)) {
                      handleBatchedBulkAction('/api/data-integrity/fix/bulk-change-billing-provider', selectedUserIds, { newProvider: 'comped' }, 'Mark as Comped');
                      setSelectedOrphans(new Set());
                    }
                  }}
                  disabled={fixIssueMutation.isPending || isBulkActionRunning}
                  className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  <Icon name="volunteer_activism" className="text-[14px]" />
                  Mark Selected as Comped
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Mark ${selectedCount} selected member(s) as MANUAL billing? Only use this for members billed outside the system.`)) {
                      handleBatchedBulkAction('/api/data-integrity/fix/bulk-change-billing-provider', selectedUserIds, { newProvider: 'manual' }, 'Mark as Manual');
                      setSelectedOrphans(new Set());
                    }
                  }}
                  disabled={fixIssueMutation.isPending || isBulkActionRunning}
                  className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  <Icon name="edit_note" className="text-[14px]" />
                  Mark Selected as Manual
                </button>
                <button
                  onClick={() => setSelectedOrphans(new Set())}
                  className="px-3 py-1.5 text-gray-600 dark:text-gray-400 rounded-lg text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1"
                >
                  <Icon name="close" className="text-[14px]" />
                  Clear
                </button>
              </div>
            )}
          </div>

          {stripeOrphans.length > 0 && selectedCount === 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                <strong>Reconnect All:</strong> {stripeOrphans.length} Stripe member(s) disconnected — search Stripe and restore their subscriptions
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    const userIds = stripeOrphans.map(i => String(i.context?.userId)).filter(Boolean);
                    if (confirm(`Reconnect ALL ${userIds.length} Stripe-orphaned member(s)? This searches Stripe by email and restores customer + subscription IDs. No new charges.`)) {
                      handleBatchedBulkAction('/api/data-integrity/fix/bulk-reconnect-stripe', userIds, {}, 'Reconnect to Stripe');
                    }
                  }}
                  disabled={fixIssueMutation.isPending || isBulkActionRunning}
                  className="tactile-btn px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  <Icon name="link" className="text-[14px]" />
                  Reconnect All Stripe Orphans
                </button>
                {isBulkActionRunning && batchProgress && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                    <Icon name="progress_activity" className="animate-spin text-[14px]" />
                    {batchProgress.label}: batch {batchProgress.current} of {batchProgress.total}
                  </span>
                )}
                {isBulkActionRunning && !batchProgress && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse">
                    <Icon name="progress_activity" className="animate-spin text-[14px]" />
                    Processing...
                  </span>
                )}
              </div>
            </div>
          )}
          {otherOrphans.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800/20 rounded-lg p-3">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                <strong>Other:</strong> {otherOrphans.length} member(s) — review individually or select above
              </p>
            </div>
          )}
        </div>
      );
    }

    case 'Orphaned Stripe Subscriptions': {
      const orphanedSubResult = results.find(r => r.checkName === 'Orphaned Stripe Subscriptions');
      const orphanedSubIssues = orphanedSubResult?.issues.filter(i => !i.ignored) || [];

      return (
        <div className="space-y-3 mb-4">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <p className="text-xs text-red-700 dark:text-red-300 mb-2">
              <strong>Email Mismatch:</strong> These Stripe subscriptions have a customer email that doesn&apos;t match any member email
              in the database. This could mean the member changed their email, or the subscription belongs to someone no longer in the system.
            </p>
          </div>
          {orphanedSubIssues.length > 0 && (
            <div className="space-y-2">
              {orphanedSubIssues.map((issue, idx) => (
                <div key={idx} className="bg-white dark:bg-gray-800/50 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Icon name="warning" className="text-red-500 text-[16px] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Subscription:</span>{' '}
                          <span className="font-mono text-red-600 dark:text-red-400">{issue.context?.stripeSubscriptionId}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Status:</span>{' '}
                          <span className="font-medium">{issue.context?.subscriptionStatus}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Stripe Email:</span>{' '}
                          <span className="font-medium text-red-600 dark:text-red-400">{issue.context?.stripeEmail}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">DB Email:</span>{' '}
                          <span className="font-medium text-green-600 dark:text-green-400">{issue.context?.databaseEmail}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Customer:</span>{' '}
                          <span className="font-mono text-gray-600 dark:text-gray-300">{issue.context?.stripeCustomerId}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">Member:</span>{' '}
                          <span className="font-medium">{issue.context?.memberName}</span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/30 rounded p-2">
                        <strong>Next steps:</strong> Verify if the member changed their email. If so, update the Stripe customer email to match.
                        If the subscription belongs to someone else, investigate and cancel if appropriate.
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'Usage Ledger Gaps':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>Quick Fix:</strong> Recalculate fees for all sessions missing usage ledger entries. Processes up to 500 sessions per run.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (confirm('Recalculate fees for ALL sessions with missing usage ledger entries? This will process up to 500 sessions.')) {
                  fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/bulk-recalculate-usage-ledger', body: {} });
                }
              }}
              disabled={fixIssueMutation.isPending}
              className="tactile-btn px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {fixIssueMutation.isPending && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="calculate" className="text-[14px]" />
              Recalculate All Fees
            </button>
          </div>
        </div>
      );

    case 'Billing Provider Hybrid State': {
      const hybridResult = results.find(r => r.checkName === 'Billing Provider Hybrid State');
      const hybridIssues = hybridResult?.issues.filter(i => !i.ignored) || [];
      const missingSubIds = hybridIssues.filter(i => i.context?.issueType === 'stripe_missing_subscription_id');

      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>About:</strong> Members with billing configuration issues — e.g. billing_provider set to &apos;stripe&apos; but missing Stripe subscription/customer IDs. Active subscriptions (including 100% discount) are auto-detected and backfilled during checks.
          </p>
          {missingSubIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
              <button
                onClick={() => {
                  if (confirm(`Backfill missing Stripe subscription IDs for ${missingSubIds.length} member(s)? This will search each member's Stripe customer for active subscriptions and restore the link. No charges will be created.`)) {
                    fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/backfill-stripe-subscription-ids', body: {} });
                  }
                }}
                disabled={fixIssueMutation.isPending || isBulkActionRunning}
                className="tactile-btn px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                <Icon name="link" className="text-[14px]" />
                Backfill Subscription IDs ({missingSubIds.length})
              </button>
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
};

export default BulkFixTools;
