import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../../../components/Toast';
import { postWithCredentials } from '../../../../hooks/queries/useFetch';

const BATCH_SIZE = 100;

export function useBulkOrphanActions() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrphans, setSelectedOrphans] = React.useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = React.useState<{ current: number; total: number; label: string } | null>(null);
  const [isBulkActionRunning, setIsBulkActionRunning] = React.useState(false);

  const toggleOrphanSelection = (userId: string) => {
    setSelectedOrphans(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAllOrphans = (userIds: string[]) => {
    setSelectedOrphans(prev => {
      const allSelected = userIds.every(id => prev.has(id));
      if (allSelected) return new Set();
      return new Set(userIds);
    });
  };

  const handleBatchedBulkAction = React.useCallback(async (
    endpoint: string,
    userIds: string[],
    extraBody: Record<string, unknown> = {},
    actionLabel: string,
  ) => {
    if (userIds.length === 0) return;

    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      chunks.push(userIds.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = chunks.length;
    const errors: string[] = [];
    let successCount = 0;
    let lastResponseMessage = '';

    setIsBulkActionRunning(true);
    try {
      for (let i = 0; i < totalBatches; i++) {
        const batchNum = i + 1;
        if (totalBatches > 1) {
          setBatchProgress({ current: batchNum, total: totalBatches, label: actionLabel });
          showToast(`Processing batch ${batchNum} of ${totalBatches}...`, 'info');
        }
        try {
          const response = await postWithCredentials<{ success: boolean; message: string; summary?: { reconnected?: number; customerOnly?: number; customerRestored?: number; failed?: number; total?: number }; results?: Array<{ userId: string; success: boolean; message: string }> }>(endpoint, {
            userIds: chunks[i],
            ...extraBody,
          });
          lastResponseMessage = response.message || '';
          if (response.summary && typeof response.summary.reconnected === 'number') {
            successCount += response.summary.reconnected;
            const failedCount = (response.summary.failed || 0);
            if (failedCount > 0) {
              const failedResults = response.results?.filter(r => !r.success) || [];
              if (failedResults.length > 0) {
                for (const r of failedResults) {
                  errors.push(r.message);
                }
              } else {
                errors.push(`${failedCount} member(s) could not be reconnected`);
              }
            }
          } else if (response.results && Array.isArray(response.results)) {
            const succeeded = response.results.filter(r => r.success);
            const failed = response.results.filter(r => !r.success);
            successCount += succeeded.length;
            for (const r of failed) {
              errors.push(r.message);
            }
          } else {
            successCount += chunks[i].length;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Batch ${batchNum}: ${msg}`);
        }
      }

      if (errors.length === 0 && successCount > 0) {
        showToast(lastResponseMessage || `${actionLabel} completed — ${successCount} user(s) processed`, 'success');
      } else if (successCount > 0 && errors.length > 0) {
        showToast(lastResponseMessage || `${actionLabel}: ${successCount} succeeded, ${errors.length} failed — ${errors.slice(0, 2).join('; ')}`, 'warning');
      } else if (errors.length > 0) {
        showToast(`${actionLabel}: ${errors.length} issue(s) — ${errors.slice(0, 2).join('; ')}`, 'error');
      } else {
        showToast(lastResponseMessage || `${actionLabel} completed — no members required changes`, 'info');
      }

      queryClient.invalidateQueries({ queryKey: ['data-integrity', 'cached'] });
      queryClient.invalidateQueries({ queryKey: ['data-integrity', 'history'] });
    } finally {
      setBatchProgress(null);
      setIsBulkActionRunning(false);
    }
  }, [showToast, queryClient]);

  return {
    selectedOrphans,
    setSelectedOrphans,
    toggleOrphanSelection,
    toggleAllOrphans,
    batchProgress,
    isBulkActionRunning,
    handleBatchedBulkAction,
  };
}
