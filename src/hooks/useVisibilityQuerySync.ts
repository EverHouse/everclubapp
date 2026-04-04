import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bookingsKeys, simulatorKeys, commandCenterKeys } from './queries/adminKeys';
import { bookGolfKeys } from '../pages/Member/BookGolf/bookGolfTypes';

const STALE_THRESHOLD_MS = 30_000;

const CRITICAL_QUERY_ROOTS: readonly (readonly string[])[] = [
  bookingsKeys.all,
  simulatorKeys.all,
  commandCenterKeys.all,
  bookGolfKeys.all,
  ['member'],
  ['members'],
  ['notifications'],
  ['announcements'],
  ['closures'],
  ['wellness-classes'],
  ['trackman', 'unmatched'],
  ['data-integrity'],
  ['membership-tiers'],
];

export function useVisibilityQuerySync() {
  const queryClient = useQueryClient();
  const lastVisibleAt = useRef(Date.now());

  useEffect(() => {
    const handleWake = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const elapsed = Date.now() - lastVisibleAt.current;
      lastVisibleAt.current = Date.now();

      if (elapsed < STALE_THRESHOLD_MS) {
        return;
      }

      for (const key of CRITICAL_QUERY_ROOTS) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };

    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
  }, [queryClient]);
}
