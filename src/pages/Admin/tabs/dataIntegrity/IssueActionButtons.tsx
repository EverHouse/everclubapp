import React from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import Icon from '../../../../components/icons/Icon';
import type { IntegrityIssue, IntegrityCheckResult } from './dataIntegrityTypes';
import BookingIssueActions from './BookingIssueActions';
import BookingConflictActions from './BookingConflictActions';
import MemberBillingIssueActions from './MemberBillingIssueActions';
import MemberSyncIssueActions from './MemberSyncIssueActions';

interface IssueActionButtonsProps {
  issue: IntegrityIssue;
  result: IntegrityCheckResult;
  syncingIssues: Set<string>;
  handleSyncPush: (issue: IntegrityIssue) => void;
  handleSyncPull: (issue: IntegrityIssue) => void;
  cancellingBookings: Set<number>;
  handleCancelBooking: (bookingId: number) => void;
  loadingMemberEmail: string | null;
  handleViewProfile: (email: string) => void;
  setBookingSheet: (sheet: {
    isOpen: boolean;
    bookingId: number | null;
    sessionId?: number | string | null;
    bayName?: string;
    bookingDate?: string;
    timeSlot?: string;
    memberName?: string;
    memberEmail?: string;
    trackmanBookingId?: string;
    importedName?: string;
    notes?: string;
    originalEmail?: string;
    isUnmatched?: boolean;
  }) => void;
  fixIssueMutation: UseMutationResult<{ success: boolean; message: string }, unknown, { endpoint: string; body: Record<string, unknown> }, unknown>;
  fixingIssues: Set<string>;
  openIgnoreModal: (issue: IntegrityIssue, checkName: string) => void;
  undoAction: (opts: { message: string; onExecute: () => Promise<void> }) => void;
}

const IssueActionButtons: React.FC<IssueActionButtonsProps> = (props) => {
  const {
    issue,
    result,
    syncingIssues,
    handleSyncPush,
    handleSyncPull,
    loadingMemberEmail,
    handleViewProfile,
    openIgnoreModal,
  } = props;

  const issueKey = `${issue.table}_${issue.recordId}`;
  const isSyncing = syncingIssues.has(issueKey);

  return (
    <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-black/5 dark:border-white/5">
      {issue.context?.syncType && !issue.ignored && (
        <>
          <button
            onClick={() => handleSyncPush(issue)}
            disabled={isSyncing}
            className="p-1.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
            title="Push app data to external system"
          >
            {isSyncing ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="arrow_forward" className="text-[16px]" />
            )}
          </button>
          <button
            onClick={() => handleSyncPull(issue)}
            disabled={isSyncing}
            className="p-1.5 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30 rounded transition-colors disabled:opacity-50"
            title="Pull external data to app"
          >
            {isSyncing ? (
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
            ) : (
              <Icon name="arrow_back" className="text-[16px]" />
            )}
          </button>
        </>
      )}
      {issue.context?.memberEmail && (
        <button
          onClick={() => handleViewProfile(issue.context!.memberEmail!)}
          disabled={loadingMemberEmail === issue.context.memberEmail}
          className="p-1.5 text-primary hover:bg-primary/10 dark:text-white dark:hover:bg-white/10 rounded transition-colors disabled:opacity-50"
          title="View member profile"
        >
          {loadingMemberEmail === issue.context.memberEmail ? (
            <Icon name="progress_activity" className="animate-spin text-[16px]" />
          ) : (
            <Icon name="person" className="text-[16px]" />
          )}
        </button>
      )}
      <BookingIssueActions {...props} />
      <BookingConflictActions {...props} />
      <MemberBillingIssueActions {...props} />
      <MemberSyncIssueActions {...props} />
      {!issue.ignored && (
        <button
          onClick={() => openIgnoreModal(issue, result.checkName)}
          className="p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded transition-colors"
          title="Ignore this issue"
        >
          <Icon name="visibility_off" className="text-[16px]" />
        </button>
      )}
    </div>
  );
};

export default IssueActionButtons;
