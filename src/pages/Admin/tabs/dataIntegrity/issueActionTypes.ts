import { UseMutationResult } from '@tanstack/react-query';
import type { IntegrityIssue, IntegrityCheckResult } from './dataIntegrityTypes';

export interface IssueActionSharedProps {
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
