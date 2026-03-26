import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { fetchWithCredentials } from './queries/useFetch';
import { setDynamicTierColors } from '../utils/tierUtils';

interface TierRow {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  product_type: string | null;
  wallet_pass_bg_color?: string | null;
  wallet_pass_foreground_color?: string | null;
  wallet_pass_label_color?: string | null;
}

const EMPTY_ROWS: TierRow[] = [];

export function useTierNames() {
  const { data, isLoading } = useQuery({
    queryKey: ['tier-names-active'],
    queryFn: () => fetchWithCredentials<TierRow[]>('/api/membership-tiers?active=true'),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const rows = Array.isArray(data) ? data : EMPTY_ROWS;

  useEffect(() => {
    if (rows.length > 0) {
      setDynamicTierColors(rows);
    }
  }, [rows]);

  const tiers = useMemo(
    () => rows
      .filter(t => t.product_type === 'subscription' || t.product_type === null)
      .map(t => t.name),
    [rows],
  );

  return { tiers, isLoading };
}
