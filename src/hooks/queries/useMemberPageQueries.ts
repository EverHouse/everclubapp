import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchWithCredentials, postWithCredentials } from './useFetch';

export const memberPageKeys = {
  all: ['member-page'] as const,
};

export function usePublicFaqs() {
  return useQuery({
    queryKey: ['public', 'faqs'],
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/faqs'),
    staleTime: 1000 * 60 * 10,
  });
}

export function usePublicGallery() {
  return useQuery({
    queryKey: ['public', 'gallery'],
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/gallery'),
    staleTime: 1000 * 60 * 10,
  });
}

export function usePublicMembershipTiers() {
  return useQuery({
    queryKey: ['public', 'membership-tiers'],
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/membership-tiers?active=true'),
    staleTime: 1000 * 60 * 10,
  });
}

export function useSubmitContactForm() {
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      postWithCredentials<{ success: boolean }>('/api/hubspot/forms/contact', data),
  });
}

export function useMapKitToken() {
  return useQuery({
    queryKey: ['public', 'mapkit-token'],
    queryFn: async () => {
      const res = await fetch('/api/mapkit-token');
      if (!res.ok) throw new Error('Failed to fetch mapkit token');
      return res.json() as Promise<{ token: string }>;
    },
    staleTime: 1000 * 60 * 30,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public', 'settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings/public');
      if (!res.ok) throw new Error('Failed to fetch settings');
      return res.json() as Promise<Record<string, string>>;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useSubmitApplication() {
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      postWithCredentials<Record<string, unknown>>('/api/hubspot/forms/membership', data),
  });
}

export function useSubmitPrivateHireInquiry() {
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      postWithCredentials<Record<string, unknown>>('/api/hubspot/forms/private-hire', data),
  });
}

export function useDayPassCheckout() {
  return useMutation({
    mutationFn: (data: { email: string; passType: string; firstName?: string; lastName?: string }) =>
      postWithCredentials<{ checkoutUrl?: string }>('/api/public/day-pass/checkout', data),
  });
}
