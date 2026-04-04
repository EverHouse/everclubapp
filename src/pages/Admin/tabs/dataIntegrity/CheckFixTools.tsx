import React from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import type { IntegrityCheckResult } from './dataIntegrityTypes';
import HubSpotStripeFixTools from './HubSpotStripeFixTools';
import BookingFixTools from './BookingFixTools';
import BulkFixTools from './BulkFixTools';

interface OrphanedParticipantDetail { email: string; bookingId?: number; action?: string; displayName?: string; userId?: string | number; }
interface HubspotSyncMember { email: string; firstName?: string; lastName?: string; tier?: string; status?: string; }
interface SubscriptionUpdate { email: string; oldStatus?: string; newStatus?: string; reason?: string; }

export interface CheckFixToolsProps {
  checkName: string;
  results: IntegrityCheckResult[];
  fixIssueMutation: UseMutationResult<{ success: boolean; message: string }, unknown, { endpoint: string; body: Record<string, unknown> }, unknown>;
  isSyncingToHubspot: boolean;
  hubspotSyncResult: { success: boolean; message: string; members?: HubspotSyncMember[]; dryRun?: boolean } | null;
  handleSyncMembersToHubspot: (dryRun: boolean) => void;
  isRunningSubscriptionSync: boolean;
  subscriptionStatusResult: { success: boolean; message: string; totalChecked?: number; mismatchCount?: number; updated?: SubscriptionUpdate[]; dryRun?: boolean } | null;
  handleSyncSubscriptionStatus: (dryRun: boolean) => void;
  isRunningOrphanedStripeCleanup: boolean;
  orphanedStripeResult: { success: boolean; message: string; totalChecked?: number; orphanedCount?: number; cleared?: { email: string; stripeCustomerId?: string; reason?: string }[]; dryRun?: boolean } | null;
  handleClearOrphanedStripeIds: (dryRun: boolean) => void;
  isRunningStripeCustomerCleanup: boolean;
  stripeCleanupResult: { success: boolean; message: string; dryRun?: boolean; totalCustomers?: number; emptyCount?: number; customers?: Array<{ id: string; email: string | null; name: string | null; created: string }>; deleted?: Array<{ id: string; email: string | null }>; deletedCount?: number } | null;
  handleCleanupStripeCustomers: (dryRun: boolean) => void;
  stripeCleanupProgress: {
    phase: string;
    totalCustomers: number;
    checked: number;
    emptyFound: number;
    skippedActiveCount: number;
    deleted: number;
    errors: number;
  } | null;
  isRunningGhostBookingFix: boolean;
  ghostBookingResult: { success: boolean; message: string; ghostBookings?: number; fixed?: number; dryRun?: boolean; errors?: Array<{ bookingId: number; error: string }> } | null;
  handleFixGhostBookings: (dryRun: boolean) => void;
  isCleaningMindbodyIds: boolean;
  mindbodyCleanupResult: { success: boolean; message: string; toClean?: number; dryRun?: boolean } | null;
  handleCleanupMindbodyIds: (dryRun: boolean) => void;
  handleArchiveStaleVisitors: (dryRun: boolean) => void;
  isRunningVisitorArchive: boolean;
  visitorArchiveResult: {
    success: boolean;
    message: string;
    dryRun?: boolean;
    totalScanned?: number;
    eligibleCount?: number;
    keptCount?: number;
    deletedCount?: number;
    sampleDeleted?: Array<{ name: string; email: string }>;
  } | null;
  visitorArchiveProgress: {
    phase: string;
    totalVisitors: number;
    checked: number;
    eligibleCount: number;
    keptCount: number;
    deleted: number;
    errors: number;
  } | null;
  isRunningOrphanedParticipantFix: boolean;
  orphanedParticipantResult: { success: boolean; message: string; relinked?: number; converted?: number; total?: number; dryRun?: boolean; relinkedDetails?: OrphanedParticipantDetail[]; convertedDetails?: OrphanedParticipantDetail[] } | null;
  handleFixOrphanedParticipants: (dryRun: boolean) => void;
  isRunningReviewItemsApproval: boolean;
  reviewItemsResult: { success: boolean; message: string; wellnessCount?: number; eventCount?: number; total?: number; dryRun?: boolean } | null;
  handleApproveAllReviewItems: (dryRun: boolean) => void;
  selectedOrphans: Set<string>;
  setSelectedOrphans: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleAllOrphans: (userIds: string[]) => void;
  isBulkActionRunning: boolean;
  batchProgress: { current: number; total: number; label: string } | null;
  handleBatchedBulkAction: (endpoint: string, userIds: string[], extraBody: Record<string, unknown>, actionLabel: string) => void;
}

const CheckFixTools: React.FC<CheckFixToolsProps> = (props) => {
  const hubspotStripe = HubSpotStripeFixTools(props);
  if (hubspotStripe) return hubspotStripe;

  const booking = BookingFixTools(props);
  if (booking) return booking;

  const bulk = BulkFixTools(props);
  if (bulk) return bulk;

  return null;
};

export default CheckFixTools;
