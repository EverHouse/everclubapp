import React from 'react';
import Icon from '../../../../components/icons/Icon';
import { getResultStyle, getTextStyle } from './integrityHelpers';
import type { CheckFixToolsProps } from './CheckFixTools';

interface OrphanedParticipantDetail { email: string; bookingId?: number; action?: string; displayName?: string; userId?: string | number; }

const BookingFixTools: React.FC<CheckFixToolsProps> = ({
  checkName,
  fixIssueMutation,
  isRunningGhostBookingFix,
  ghostBookingResult,
  handleFixGhostBookings,
  isCleaningMindbodyIds,
  mindbodyCleanupResult,
  handleCleanupMindbodyIds,
  isRunningOrphanedParticipantFix,
  orphanedParticipantResult,
  handleFixOrphanedParticipants,
  isRunningReviewItemsApproval,
  reviewItemsResult,
  handleApproveAllReviewItems,
}) => {
  const normalizedCheckName = checkName.replace(/^\[DEV\]\s*/, '');

  switch (normalizedCheckName) {
    case 'Bookings Without Sessions':
    case 'Active Bookings Without Sessions':
      return (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
            <strong>Quick Fix:</strong> Create missing billing sessions for Trackman bookings
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleFixGhostBookings(true)}
              disabled={isRunningGhostBookingFix}
              className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningGhostBookingFix && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="visibility" className="text-[14px]" />
              Preview
            </button>
            <button
              onClick={() => handleFixGhostBookings(false)}
              disabled={isRunningGhostBookingFix}
              className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningGhostBookingFix && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="build" className="text-[14px]" />
              Create Sessions
            </button>
          </div>
          {ghostBookingResult && (
            <div className={`mt-2 p-2 rounded ${getResultStyle(ghostBookingResult)}`}>
              {ghostBookingResult.dryRun && (
                <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
              )}
              <p className={`text-xs ${getTextStyle(ghostBookingResult)}`}>{ghostBookingResult.message}</p>
              {ghostBookingResult.errors && ghostBookingResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">Errors:</p>
                  {ghostBookingResult.errors.map((err, i) => (
                    <p key={i} className="text-[10px] text-red-600 dark:text-red-400">
                      Booking #{err.bookingId}: {err.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );

    case 'Stale Mindbody IDs':
    case 'MindBody Stale Sync':
      return (
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
            <strong>Quick Fix:</strong> Remove old Mindbody IDs from members no longer in Mindbody
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleCleanupMindbodyIds(true)}
              disabled={isCleaningMindbodyIds}
              className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isCleaningMindbodyIds && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="visibility" className="text-[14px]" />
              Preview
            </button>
            <button
              onClick={() => handleCleanupMindbodyIds(false)}
              disabled={isCleaningMindbodyIds}
              className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isCleaningMindbodyIds && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="cleaning_services" className="text-[14px]" />
              Clean Up
            </button>
          </div>
          {mindbodyCleanupResult && (
            <div className={`mt-2 p-2 rounded ${getResultStyle(mindbodyCleanupResult)}`}>
              {mindbodyCleanupResult.dryRun && (
                <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
              )}
              <p className={`text-xs ${getTextStyle(mindbodyCleanupResult)}`}>{mindbodyCleanupResult.message}</p>
            </div>
          )}
        </div>
      );

    case 'Participant User Relationships':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>Quick Fix:</strong> Re-link participants to existing members by email, or convert unmatched ones to guests
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleFixOrphanedParticipants(true)}
              disabled={isRunningOrphanedParticipantFix}
              className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningOrphanedParticipantFix && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="visibility" className="text-[14px]" />
              Preview
            </button>
            <button
              onClick={() => handleFixOrphanedParticipants(false)}
              disabled={isRunningOrphanedParticipantFix}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningOrphanedParticipantFix && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="build" className="text-[14px]" />
              Fix All
            </button>
          </div>
          {orphanedParticipantResult && (
            <div className={`mt-2 p-2 rounded ${!orphanedParticipantResult.success ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700' : orphanedParticipantResult.dryRun ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700'}`}>
              {orphanedParticipantResult.dryRun && (
                <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
              )}
              <p className={`text-xs ${!orphanedParticipantResult.success ? 'text-red-700 dark:text-red-400' : orphanedParticipantResult.dryRun ? 'text-blue-700 dark:text-blue-400' : 'text-green-700 dark:text-green-400'}`}>{orphanedParticipantResult.message}</p>
              {orphanedParticipantResult.relinkedDetails && orphanedParticipantResult.relinkedDetails.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] font-bold text-green-600 dark:text-green-400">Re-linked to members ({orphanedParticipantResult.relinked}):</p>
                  {orphanedParticipantResult.relinkedDetails.map((d: OrphanedParticipantDetail, i: number) => (
                    <p key={i} className="text-[10px] text-gray-600 dark:text-gray-400">{d.displayName} → {d.email}</p>
                  ))}
                </div>
              )}
              {orphanedParticipantResult.convertedDetails && orphanedParticipantResult.convertedDetails.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] font-bold text-orange-600 dark:text-orange-400">Converted to guests ({orphanedParticipantResult.converted}):</p>
                  {orphanedParticipantResult.convertedDetails.map((d: OrphanedParticipantDetail, i: number) => (
                    <p key={i} className="text-[10px] text-gray-600 dark:text-gray-400">{d.displayName} (was: {d.userId})</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );

    case 'Items Needing Review':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>Quick Actions:</strong> These are wellness classes or events that were imported and need your approval. Approve them to make them visible to members, or delete ones you don&apos;t want.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleApproveAllReviewItems(true)}
              disabled={isRunningReviewItemsApproval}
              className="tactile-btn px-3 py-1.5 bg-gray-500 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningReviewItemsApproval && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="visibility" className="text-[14px]" />
              Preview
            </button>
            <button
              onClick={() => handleApproveAllReviewItems(false)}
              disabled={isRunningReviewItemsApproval}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {isRunningReviewItemsApproval && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="check_circle" className="text-[14px]" />
              Approve All
            </button>
          </div>
          {reviewItemsResult && (
            <div className={`mt-2 p-2 rounded ${!reviewItemsResult.success ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700' : reviewItemsResult.dryRun ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700' : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700'}`}>
              {reviewItemsResult.dryRun && (
                <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Preview Only - No Changes Made</p>
              )}
              <p className={`text-xs ${!reviewItemsResult.success ? 'text-red-700 dark:text-red-400' : reviewItemsResult.dryRun ? 'text-blue-700 dark:text-blue-400' : 'text-green-700 dark:text-green-400'}`}>{reviewItemsResult.message}</p>
            </div>
          )}
        </div>
      );

    case 'Stale Pending Bookings':
      return (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
            <strong>Quick Fix:</strong> Bulk cancel or mark as attended all stale bookings that are past their start time by more than 24 hours
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (confirm('Cancel ALL stale pending/approved bookings that are past their start time? This cannot be undone.')) {
                  fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/bulk-cancel-stale-bookings', body: {} });
                }
              }}
              disabled={fixIssueMutation.isPending}
              className="tactile-btn px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {fixIssueMutation.isPending && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="cancel" className="text-[14px]" />
              Cancel All Stale Bookings
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Mark ALL stale pending/approved bookings as attended? This will resolve all stale booking alerts.')) {
                  fixIssueMutation.mutate({ endpoint: '/api/data-integrity/fix/bulk-attend-stale-bookings', body: {} });
                }
              }}
              disabled={fixIssueMutation.isPending}
              className="tactile-btn px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            >
              {fixIssueMutation.isPending && <Icon name="progress_activity" className="animate-spin text-[14px]" />}
              <Icon name="check_circle" className="text-[14px]" />
              Mark All as Attended
            </button>
          </div>
        </div>
      );

    default:
      return null;
  }
};

export default BookingFixTools;
