import React from 'react';
import Icon from '../../../../components/icons/Icon';
import { getResultStyle, getTextStyle } from './integrityHelpers';
import type { CheckFixToolsProps } from './CheckFixTools';

interface OrphanedStripeRecord { email: string; stripeCustomerId?: string; reason?: string; }

const HubSpotStripeFixTools: React.FC<CheckFixToolsProps> = ({
  checkName,
  isSyncingToHubspot,
  hubspotSyncResult,
  handleSyncMembersToHubspot,
  isRunningSubscriptionSync,
  subscriptionStatusResult,
  handleSyncSubscriptionStatus,
  isRunningOrphanedStripeCleanup,
  orphanedStripeResult,
  handleClearOrphanedStripeIds,
  isRunningStripeCustomerCleanup,
  stripeCleanupResult,
  handleCleanupStripeCustomers,
  stripeCleanupProgress,
  handleArchiveStaleVisitors,
  isRunningVisitorArchive,
  visitorArchiveResult,
  visitorArchiveProgress,
}) => {
  const normalizedCheckName = checkName.replace(/^\[DEV\]\s*/, '');

  switch (normalizedCheckName) {
    case 'HubSpot Sync Mismatch':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>Quick Fix:</strong> Sync member data to HubSpot to resolve mismatches
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleSyncMembersToHubspot(true)}
              disabled={isSyncingToHubspot}
              className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isSyncingToHubspot && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="visibility" className="text-[14px]" />
              Preview
            </button>
            <button
              onClick={() => handleSyncMembersToHubspot(false)}
              disabled={isSyncingToHubspot}
              className="tactile-btn px-3 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isSyncingToHubspot && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="sync" className="text-[14px]" />
              Push All to HubSpot
            </button>
          </div>
          {hubspotSyncResult && (
            <div className={`mt-2 p-2 rounded ${getResultStyle(hubspotSyncResult)}`}>
              {hubspotSyncResult.dryRun && (
                <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
              )}
              <p className={`text-xs ${getTextStyle(hubspotSyncResult)}`}>{hubspotSyncResult.message}</p>
            </div>
          )}
        </div>
      );

    case 'Subscription Status Drift':
    case 'Stripe Subscription Sync':
      return (
        <div className="space-y-3">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
              <strong>Sync Status:</strong> Sync membership status from Stripe to correct mismatches
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleSyncSubscriptionStatus(true)}
                disabled={isRunningSubscriptionSync}
                className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningSubscriptionSync && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="visibility" className="text-[14px]" />
                Preview
              </button>
              <button
                onClick={() => handleSyncSubscriptionStatus(false)}
                disabled={isRunningSubscriptionSync}
                className="tactile-btn px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningSubscriptionSync && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="sync" className="text-[14px]" />
                Sync from Stripe
              </button>
            </div>
            {subscriptionStatusResult && (
              <div className={`mt-2 p-2 rounded ${getResultStyle(subscriptionStatusResult)}`}>
                {subscriptionStatusResult.dryRun && (
                  <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
                )}
                <p className={`text-xs ${getTextStyle(subscriptionStatusResult)}`}>{subscriptionStatusResult.message}</p>
              </div>
            )}
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <p className="text-xs text-red-700 dark:text-red-300 mb-2">
              <strong>Clear Orphaned IDs:</strong> Remove Stripe customer IDs that no longer exist in Stripe
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleClearOrphanedStripeIds(true)}
                disabled={isRunningOrphanedStripeCleanup}
                className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningOrphanedStripeCleanup && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="visibility" className="text-[14px]" />
                Preview
              </button>
              <button
                onClick={() => handleClearOrphanedStripeIds(false)}
                disabled={isRunningOrphanedStripeCleanup}
                className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningOrphanedStripeCleanup && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="delete_sweep" className="text-[14px]" />
                Clear Orphaned IDs
              </button>
            </div>
            {orphanedStripeResult && (
              <div className={`mt-2 p-2 rounded ${getResultStyle(orphanedStripeResult)}`}>
                {orphanedStripeResult.dryRun && (
                  <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
                )}
                <p className={`text-xs ${getTextStyle(orphanedStripeResult)}`}>{orphanedStripeResult.message}</p>
                {orphanedStripeResult.cleared && orphanedStripeResult.cleared.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto text-xs bg-white dark:bg-white/10 rounded p-2">
                    {orphanedStripeResult.cleared.map((c: OrphanedStripeRecord, i: number) => (
                      <div key={i} className="py-1 border-b border-gray-100 dark:border-white/10 last:border-0">
                        {c.email}: {c.stripeCustomerId}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
            <p className="text-xs text-orange-700 dark:text-orange-300 mb-2">
              <strong>Cleanup Empty Customers:</strong> Delete Stripe customers that have zero charges, subscriptions, invoices, or payment intents
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleCleanupStripeCustomers(true)}
                disabled={isRunningStripeCustomerCleanup}
                className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningStripeCustomerCleanup && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="visibility" className="text-[14px]" />
                Scan & Preview
              </button>
              <button
                onClick={() => handleCleanupStripeCustomers(false)}
                disabled={isRunningStripeCustomerCleanup || !stripeCleanupResult?.dryRun}
                className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                {isRunningStripeCustomerCleanup && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                <Icon name="delete_sweep" className="text-[14px]" />
                Delete Empty Customers
              </button>
            </div>
            {isRunningStripeCustomerCleanup && stripeCleanupProgress && (
              <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="progress_activity" className="animate-spin text-[16px] text-blue-600" />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                    {stripeCleanupProgress.phase === 'fetching' && 'Fetching customers from Stripe...'}
                    {stripeCleanupProgress.phase === 'checking' && `Checking customers: ${stripeCleanupProgress.checked} / ${stripeCleanupProgress.totalCustomers}`}
                    {stripeCleanupProgress.phase === 'deleting' && `Deleting empty customers: ${stripeCleanupProgress.deleted} / ${stripeCleanupProgress.emptyFound}`}
                  </span>
                </div>
                {stripeCleanupProgress.totalCustomers > 0 && (
                  <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-gpu duration-normal"
                      style={{ 
                        width: `${stripeCleanupProgress.phase === 'checking' 
                          ? Math.round((stripeCleanupProgress.checked / Math.max(1, stripeCleanupProgress.totalCustomers)) * 100)
                          : stripeCleanupProgress.phase === 'deleting'
                            ? Math.round((stripeCleanupProgress.deleted / Math.max(1, stripeCleanupProgress.emptyFound)) * 100)
                            : 0}%` 
                      }}
                    />
                  </div>
                )}
                <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
                  {stripeCleanupProgress.emptyFound > 0 && `Empty: ${stripeCleanupProgress.emptyFound} | `}
                  {stripeCleanupProgress.skippedActiveCount > 0 && `Active (kept): ${stripeCleanupProgress.skippedActiveCount} | `}
                  {stripeCleanupProgress.errors > 0 && `Errors: ${stripeCleanupProgress.errors}`}
                </div>
              </div>
            )}
            {stripeCleanupResult && (
              <div className={`mt-2 p-2 rounded ${getResultStyle(stripeCleanupResult)}`}>
                {stripeCleanupResult.dryRun && (
                  <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
                )}
                <p className={`text-xs ${getTextStyle(stripeCleanupResult)}`}>{stripeCleanupResult.message}</p>
                {stripeCleanupResult.dryRun && stripeCleanupResult.customers && stripeCleanupResult.customers.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto text-xs bg-white dark:bg-white/10 rounded p-2">
                    <p className="font-medium mb-1">{stripeCleanupResult.emptyCount} empty customers found:</p>
                    {stripeCleanupResult.customers.map((c, i) => (
                      <div key={i} className="py-1 border-b border-gray-100 dark:border-white/10 last:border-0">
                        {c.email || 'No email'} — {c.name || 'No name'} ({c.id})
                      </div>
                    ))}
                  </div>
                )}
                {!stripeCleanupResult.dryRun && stripeCleanupResult.deleted && stripeCleanupResult.deleted.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto text-xs bg-white dark:bg-white/10 rounded p-2">
                    <p className="font-medium mb-1">{stripeCleanupResult.deletedCount} customers deleted:</p>
                    {stripeCleanupResult.deleted.map((c, i) => (
                      <div key={i} className="py-1 border-b border-gray-100 dark:border-white/10 last:border-0">
                        {c.email || 'No email'} ({c.id})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                <Icon name="delete_sweep" className="text-[14px]" />
                Delete Stale Visitors
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  onClick={() => handleArchiveStaleVisitors(true)}
                  disabled={isRunningVisitorArchive}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  {isRunningVisitorArchive && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
                  Scan & Preview
                </button>
                <button
                  onClick={() => handleArchiveStaleVisitors(false)}
                  disabled={isRunningVisitorArchive || !visitorArchiveResult?.dryRun}
                  className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                >
                  Delete Now
                </button>
              </div>
              {isRunningVisitorArchive && visitorArchiveProgress && (
                <div className="p-2 rounded bg-blue-50 dark:bg-blue-900/20 mb-2">
                  <div className="flex items-center gap-1 mb-1">
                    <Icon name="progress_activity" className="animate-spin text-[14px] text-blue-600" />
                    <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                      {visitorArchiveProgress.phase === 'scanning' && 'Scanning...'}
                      {visitorArchiveProgress.phase === 'checking_stripe' && `Stripe: ${visitorArchiveProgress.checked}/${visitorArchiveProgress.totalVisitors}`}
                      {visitorArchiveProgress.phase === 'deleting' && `Deleting: ${visitorArchiveProgress.deleted}/${visitorArchiveProgress.eligibleCount}`}
                    </span>
                  </div>
                  {visitorArchiveProgress.totalVisitors > 0 && (
                    <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-1.5">
                      <div 
                        className="bg-blue-600 h-1.5 rounded-full transition-gpu duration-normal"
                        style={{ 
                          width: `${visitorArchiveProgress.phase === 'checking_stripe' 
                            ? Math.round((visitorArchiveProgress.checked / Math.max(1, visitorArchiveProgress.totalVisitors)) * 100)
                            : visitorArchiveProgress.phase === 'deleting'
                              ? Math.round((visitorArchiveProgress.deleted / Math.max(1, visitorArchiveProgress.eligibleCount)) * 100)
                              : visitorArchiveProgress.phase === 'scanning' ? 0 : 100}%` 
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {visitorArchiveResult && (
                <div className={`p-2 rounded ${getResultStyle(visitorArchiveResult)}`}>
                  {visitorArchiveResult.dryRun && (
                    <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only</p>
                  )}
                  <p className={`text-xs ${getTextStyle(visitorArchiveResult)}`}>{visitorArchiveResult.message}</p>
                  {visitorArchiveResult.sampleDeleted && visitorArchiveResult.sampleDeleted.length > 0 && (
                    <div className="mt-1 max-h-24 overflow-y-auto text-[11px] bg-white dark:bg-white/10 rounded p-1">
                      {visitorArchiveResult.sampleDeleted.map((v, i) => (
                        <div key={i} className="py-0.5 text-gray-600 dark:text-gray-400">
                          {v.name} ({v.email})
                        </div>
                      ))}
                      {(visitorArchiveResult.eligibleCount || 0) > 20 && (
                        <p className="text-[10px] text-gray-400">...and {(visitorArchiveResult.eligibleCount || 0) - 20} more</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
};

export default HubSpotStripeFixTools;
