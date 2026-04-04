import type { QueryClient, InvalidateQueryFilters } from '@tanstack/react-query';

const BATCH_WINDOW_MS = 150;

export interface BatchedInvalidator {
  invalidate: (filter: InvalidateQueryFilters) => void;
  cancel: () => void;
}

export function createBatchedInvalidator(queryClient: QueryClient): BatchedInvalidator {
  let pendingKeys: InvalidateQueryFilters[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    flushTimer = null;
    if (pendingKeys.length === 0) return;

    // Dedupe by queryKey only — current callsites use queryKey-only filters
    const seen = new Set<string>();
    const uniqueFilters: InvalidateQueryFilters[] = [];

    for (const filter of pendingKeys) {
      const key = JSON.stringify(filter.queryKey);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFilters.push(filter);
      }
    }

    pendingKeys = [];

    for (const filter of uniqueFilters) {
      queryClient.invalidateQueries(filter);
    }
  }

  function invalidate(filter: InvalidateQueryFilters) {
    pendingKeys.push(filter);

    if (flushTimer === null) {
      flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
    }
  }

  function cancel() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingKeys = [];
  }

  return { invalidate, cancel };
}
