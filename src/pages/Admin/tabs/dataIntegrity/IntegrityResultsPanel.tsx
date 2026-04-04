import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { springPresets, listItemVariant, noMotionVariant } from '../../../../utils/motion';
import { getCheckMetadata } from '../../../../data/integrityCheckMetadata';
import EmptyState from '../../../../components/EmptyState';
import { useUndoAction } from '../../../../hooks/useUndoAction';
import { useBulkOrphanActions } from './useBulkOrphanActions';
import Icon from '../../../../components/icons/Icon';
import CheckFixTools from './CheckFixTools';
import IssueActionButtons from './IssueActionButtons';
import {
  getStatusColor,
  getCheckSeverityColor,
  getSeverityColor,
  getSeverityIcon,
  groupByCategory,
  getCategoryLabel,
  formatContextString,
} from './integrityHelpers';
import type { IntegrityResultsPanelProps } from './integrityResultsPanelTypes';

const AnimatedCategoryDiv: React.FC<{ category: string; className?: string; children: React.ReactNode }> = ({ className, children }) => {
  return <div className={className}>{children}</div>;
};

const IntegrityResultsPanel: React.FC<IntegrityResultsPanelProps> = ({
  results,
  expandedChecks,
  toggleCheck,
  syncingIssues,
  handleSyncPush,
  handleSyncPull,
  cancellingBookings,
  handleCancelBooking,
  loadingMemberEmail,
  handleViewProfile,
  setBookingSheet,
  fixIssueMutation,
  fixingIssues,
  isRefreshing,
  openIgnoreModal,
  openBulkIgnoreModal,
  getIssueTracking,
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
  isRunningGhostBookingFix,
  ghostBookingResult,
  handleFixGhostBookings,
  isCleaningMindbodyIds,
  mindbodyCleanupResult,
  handleCleanupMindbodyIds,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isRunningStripeHubspotLink,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  stripeHubspotLinkResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleLinkStripeHubspot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isRunningPaymentStatusSync,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  paymentStatusResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleSyncPaymentStatus,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isRunningVisitCountSync,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitCountResult,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleSyncVisitCounts,
  handleArchiveStaleVisitors,
  isRunningVisitorArchive,
  visitorArchiveResult,
  visitorArchiveProgress,
  isRunningOrphanedParticipantFix,
  orphanedParticipantResult,
  handleFixOrphanedParticipants,
  isRunningReviewItemsApproval,
  reviewItemsResult,
  handleApproveAllReviewItems,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const { execute: undoAction } = useUndoAction();
  const {
    selectedOrphans,
    setSelectedOrphans,
    toggleOrphanSelection,
    toggleAllOrphans,
    batchProgress,
    isBulkActionRunning,
    handleBatchedBulkAction,
  } = useBulkOrphanActions();

  return (
    <>
      <div className="space-y-3">
        <AnimatePresence mode="wait">
        {isRefreshing && (
          <motion.div
            key="refreshing-indicator"
            initial={prefersReducedMotion ? {} : { opacity: 0, y: -8 }}
            animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, y: -8 }}
            transition={prefersReducedMotion ? { duration: 0 } : springPresets.quick}
            className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 animate-pulse"
          >
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
            Refreshing data integrity results...
          </motion.div>
        )}
        {results.length > 0 && results.map((result, resultIndex) => {
            const metadata = getCheckMetadata(result.checkName);
            const displayTitle = metadata?.title || result.checkName;
            const description = metadata?.description;
            const checkSeverity = metadata?.severity || 'medium';
            const isExpanded = expandedChecks.has(result.checkName);
            
            return (
              <motion.div
                key={result.checkName}
                variants={prefersReducedMotion ? noMotionVariant : listItemVariant}
                initial="hidden"
                animate="show"
                transition={prefersReducedMotion ? { duration: 0 } : { ...springPresets.listItem, delay: resultIndex * 0.04 }}
                className="bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => toggleCheck(result.checkName)}
                  className="w-full p-4 flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded shrink-0 ${getStatusColor(result.status)}`}>
                      {result.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-primary dark:text-white text-sm leading-tight">{displayTitle}</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded shrink-0 ${getCheckSeverityColor(checkSeverity)}`}>
                          {checkSeverity}
                        </span>
                      </div>
                      {description && (
                        <p className="text-xs text-primary/60 dark:text-white/60 truncate">{description}</p>
                      )}
                      {result.durationMs !== undefined && (
                        <p className="text-[10px] text-primary/40 dark:text-white/40">
                          {result.durationMs < 1000 ? `${result.durationMs}ms` : `${(result.durationMs / 1000).toFixed(1)}s`}
                        </p>
                      )}
                    </div>
                    {(result.autoFixedCount ?? 0) > 0 && (
                      <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-bold rounded-full shrink-0 flex items-center gap-1">
                        <Icon name="auto_fix_high" className="text-[12px]" />
                        {result.autoFixedCount}
                      </span>
                    )}
                    {result.issueCount > 0 && (
                      <span className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-0.5 text-xs font-bold rounded-full shrink-0">
                        {result.issueCount}
                      </span>
                    )}
                  </div>
                  <Icon name="expand_more" className={`text-gray-500 dark:text-gray-400 transition-transform ml-2 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {(result.autoFixedCount ?? 0) > 0 && result.autoFixSummary && (
                      <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                        <Icon name="auto_fix_high" className="text-[16px]" />
                        <span><strong>Auto-resolved ({result.autoFixedCount}):</strong> {result.autoFixSummary}</span>
                      </div>
                    )}

                    <CheckFixTools
                      checkName={result.checkName}
                      results={results}
                      fixIssueMutation={fixIssueMutation}
                      isSyncingToHubspot={isSyncingToHubspot}
                      hubspotSyncResult={hubspotSyncResult}
                      handleSyncMembersToHubspot={handleSyncMembersToHubspot}
                      isRunningSubscriptionSync={isRunningSubscriptionSync}
                      subscriptionStatusResult={subscriptionStatusResult}
                      handleSyncSubscriptionStatus={handleSyncSubscriptionStatus}
                      isRunningOrphanedStripeCleanup={isRunningOrphanedStripeCleanup}
                      orphanedStripeResult={orphanedStripeResult}
                      handleClearOrphanedStripeIds={handleClearOrphanedStripeIds}
                      isRunningStripeCustomerCleanup={isRunningStripeCustomerCleanup}
                      stripeCleanupResult={stripeCleanupResult}
                      handleCleanupStripeCustomers={handleCleanupStripeCustomers}
                      stripeCleanupProgress={stripeCleanupProgress}
                      isRunningGhostBookingFix={isRunningGhostBookingFix}
                      ghostBookingResult={ghostBookingResult}
                      handleFixGhostBookings={handleFixGhostBookings}
                      isCleaningMindbodyIds={isCleaningMindbodyIds}
                      mindbodyCleanupResult={mindbodyCleanupResult}
                      handleCleanupMindbodyIds={handleCleanupMindbodyIds}
                      handleArchiveStaleVisitors={handleArchiveStaleVisitors}
                      isRunningVisitorArchive={isRunningVisitorArchive}
                      visitorArchiveResult={visitorArchiveResult}
                      visitorArchiveProgress={visitorArchiveProgress}
                      isRunningOrphanedParticipantFix={isRunningOrphanedParticipantFix}
                      orphanedParticipantResult={orphanedParticipantResult}
                      handleFixOrphanedParticipants={handleFixOrphanedParticipants}
                      isRunningReviewItemsApproval={isRunningReviewItemsApproval}
                      reviewItemsResult={reviewItemsResult}
                      handleApproveAllReviewItems={handleApproveAllReviewItems}
                      selectedOrphans={selectedOrphans}
                      setSelectedOrphans={setSelectedOrphans}
                      toggleAllOrphans={toggleAllOrphans}
                      isBulkActionRunning={isBulkActionRunning}
                      batchProgress={batchProgress}
                      handleBatchedBulkAction={handleBatchedBulkAction}
                    />

                    {result.issues.length === 0 && !(result.autoFixedCount) && (
                      <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                        <Icon name="check_circle" className="text-[16px]" />
                        No issues found for this check.
                      </div>
                    )}

                    {result.issues.length === 0 && (result.autoFixedCount ?? 0) > 0 && (
                      <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                        <Icon name="check_circle" className="text-[16px]" />
                        All issues were auto-resolved during the nightly check.
                      </div>
                    )}
                    
                    {Array.isArray(result.issues) && result.issues.filter(i => !i.ignored).length > 3 && (
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => openBulkIgnoreModal(result.checkName, result.issues)}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
                        >
                          <Icon name="visibility_off" className="text-[14px]" />
                          Exclude All ({result.issues.filter(i => !i.ignored).length})
                        </button>
                      </div>
                    )}
                    
                    {Array.isArray(result.issues) && result.issues.length > 0 && Object.entries(groupByCategory(result.issues)).map(([category, categoryIssues]) => (
                      <AnimatedCategoryDiv key={category} category={category} className="space-y-2">
                        <p className="text-xs font-medium text-primary/60 dark:text-white/60 uppercase tracking-wide">
                          {getCategoryLabel(category)} ({categoryIssues.length})
                        </p>
                        {categoryIssues.map((issue, idx) => {
                          const issueKey = `${issue.table}_${issue.recordId}`;
                          const isSyncing = syncingIssues.has(issueKey);
                          const tracking = getIssueTracking(issue);
                          const contextStr = formatContextString(issue.context);
                          
                          const isBillingOrphan = result.checkName === 'Billing Orphans' && issue.context?.userId;
                          return (
                            <div
                              key={idx}
                              className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)} ${issue.ignored ? 'opacity-50' : ''}`}
                            >
                              <div className="space-y-2">
                                <div>
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    {isBillingOrphan && (
                                      <input
                                        type="checkbox"
                                        checked={selectedOrphans.has(String(issue.context?.userId))}
                                        onChange={() => toggleOrphanSelection(String(issue.context?.userId))}
                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                      />
                                    )}
                                    <Icon name={getSeverityIcon(issue.severity)} className="text-[16px]" />
                                    <span className="font-medium text-sm">{issue.description}</span>
                                    {issue.ignored && issue.ignoreInfo && (
                                      <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                                        Ignored until {new Date(issue.ignoreInfo.expiresAt).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })}
                                      </span>
                                    )}
                                  </div>
                                  {contextStr && (
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{contextStr}</p>
                                  )}
                                  {issue.suggestion && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 italic">{issue.suggestion}</p>
                                  )}
                                  {tracking && tracking.daysUnresolved > 0 && (
                                    <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-1">
                                      Unresolved for {tracking.daysUnresolved} day{tracking.daysUnresolved === 1 ? '' : 's'}
                                    </p>
                                  )}
                                  
                                  {issue.context?.syncComparison && issue.context.syncComparison.length > 0 && (
                                    <div className="mt-2 bg-white/50 dark:bg-white/5 rounded p-2">
                                      <p className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1">Field Differences</p>
                                      <div className="space-y-1">
                                        {issue.context.syncComparison.map((comp, compIdx) => (
                                          <div key={compIdx} className="text-[11px] py-1 border-b border-gray-100 dark:border-white/5 last:border-0">
                                            <span className="font-medium text-gray-700 dark:text-gray-300">{comp.field}</span>
                                            <div className="flex flex-col sm:flex-row sm:gap-3 gap-0.5 mt-0.5">
                                              <span className="text-blue-600 dark:text-blue-400 truncate" title={String(comp.appValue)}>App: {String(comp.appValue)}</span>
                                              <span className="text-orange-600 dark:text-orange-400 truncate" title={String(comp.externalValue)}>External: {String(comp.externalValue)}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                
                                <IssueActionButtons
                                  issue={issue}
                                  result={result}
                                  syncingIssues={syncingIssues}
                                  handleSyncPush={handleSyncPush}
                                  handleSyncPull={handleSyncPull}
                                  cancellingBookings={cancellingBookings}
                                  handleCancelBooking={handleCancelBooking}
                                  loadingMemberEmail={loadingMemberEmail}
                                  handleViewProfile={handleViewProfile}
                                  setBookingSheet={setBookingSheet}
                                  fixIssueMutation={fixIssueMutation}
                                  fixingIssues={fixingIssues}
                                  openIgnoreModal={openIgnoreModal}
                                  undoAction={undoAction}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </AnimatedCategoryDiv>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {results.length > 0 && results.every(r => r.status === 'pass') && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
          <EmptyState
            icon="verified"
            title="All Checks Passed!"
            description="No data integrity issues found."
            variant="compact"
          />
        </div>
      )}
    </>
  );
};

export default IntegrityResultsPanel;
