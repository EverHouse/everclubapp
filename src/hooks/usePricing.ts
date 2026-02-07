import { useQuery } from '@tanstack/react-query';

interface PricingConfig {
  guestFeeDollars: number;
  overageRatePerBlockDollars: number;
  overageBlockMinutes: number;
}

export function usePricing() {
  const { data } = useQuery<PricingConfig>({
    queryKey: ['pricing'],
    queryFn: async () => {
      const res = await fetch('/api/pricing', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch pricing');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  return {
    guestFeeDollars: data?.guestFeeDollars ?? 25,
    overageRatePerBlockDollars: data?.overageRatePerBlockDollars ?? 25,
    overageBlockMinutes: data?.overageBlockMinutes ?? 30,
  };
}
