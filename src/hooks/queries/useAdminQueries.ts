import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithCredentials, postWithCredentials, putWithCredentials, deleteWithCredentials } from './useFetch';

export const adminTabKeys = {
  all: ['admin'] as const,
  applications: () => [...adminTabKeys.all, 'applications'] as const,
  bugReports: (status?: string) => [...adminTabKeys.all, 'bug-reports', status] as const,
  gallery: () => [...adminTabKeys.all, 'gallery'] as const,
  faqs: () => [...adminTabKeys.all, 'faqs'] as const,
  inquiries: (status?: string) => [...adminTabKeys.all, 'inquiries', status] as const,
  tiers: (activeOnly?: boolean) => [...adminTabKeys.all, 'tiers', { activeOnly }] as const,
  coupons: () => [...adminTabKeys.all, 'coupons'] as const,
  staffNotifications: (email?: string) => [...adminTabKeys.all, 'staff-notifications', email] as const,
};

export function useApplications() {
  return useQuery({
    queryKey: adminTabKeys.applications(),
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/admin/applications'),
  });
}

export function useUpdateApplicationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      putWithCredentials<Record<string, unknown>>(`/api/admin/applications/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.applications() });
    },
  });
}

export function useSaveApplicationNotes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      putWithCredentials<Record<string, unknown>>(`/api/admin/applications/${id}/status`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.applications() });
    },
  });
}

export function useSendApplicationInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ applicationId, tierId }: { applicationId: number; tierId: number; email: string; name: string }) =>
      postWithCredentials<Record<string, unknown>>(`/api/admin/applications/${applicationId}/send-invite`, { tierId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.applications() });
    },
  });
}

export function useSyncHubSpotApplications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postWithCredentials<{ newInserted: number }>('/api/admin/hubspot/sync-form-submissions', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.applications() });
    },
  });
}

export function useBugReports(status?: string) {
  return useQuery({
    queryKey: adminTabKeys.bugReports(status),
    queryFn: () => {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.append('status', status);
      return fetchWithCredentials<Array<Record<string, unknown>>>(`/api/admin/bug-reports?${params.toString()}`);
    },
  });
}

export function useUpdateBugReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; staffNotes?: string }) =>
      putWithCredentials<Record<string, unknown>>(`/api/admin/bug-reports/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.bugReports() });
    },
  });
}

export function useDeleteBugReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      deleteWithCredentials<{ success: boolean }>(`/api/admin/bug-reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.bugReports() });
    },
  });
}

export function useGalleryImages() {
  return useQuery({
    queryKey: adminTabKeys.gallery(),
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/gallery?include_inactive=true'),
  });
}

export function useSaveGalleryImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id?: number; title?: string | null; imageUrl: string; category: string; sortOrder: number; isActive: boolean }) => {
      if (id) {
        return putWithCredentials<Record<string, unknown>>(`/api/admin/gallery/${id}`, data);
      }
      return postWithCredentials<Record<string, unknown>>('/api/admin/gallery', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.gallery() });
    },
  });
}

export function useDeleteGalleryImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      deleteWithCredentials<{ success: boolean }>(`/api/admin/gallery/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.gallery() });
    },
  });
}

export function useFaqs() {
  return useQuery({
    queryKey: adminTabKeys.faqs(),
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>('/api/admin/faqs'),
    staleTime: 1000 * 60 * 5,
  });
}

export function useSaveFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id?: number; question: string; answer: string; category?: string; sortOrder?: number; isActive?: boolean }) => {
      if (id) {
        return putWithCredentials<Record<string, unknown>>(`/api/admin/faqs/${id}`, data);
      }
      return postWithCredentials<Record<string, unknown>>('/api/admin/faqs', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.faqs() });
    },
  });
}

export function useDeleteFaq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      deleteWithCredentials<{ success: boolean }>(`/api/admin/faqs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.faqs() });
    },
  });
}

export function useInquiries(status?: string, formType?: string) {
  return useQuery({
    queryKey: [...adminTabKeys.inquiries(status), formType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status && status !== 'all') params.append('status', status);
      if (formType && formType !== 'all') params.append('formType', formType);
      return fetchWithCredentials<Array<Record<string, unknown>>>(`/api/admin/inquiries?${params.toString()}`);
    },
  });
}

export function useUpdateInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; status?: string; notes?: string }) =>
      putWithCredentials<Record<string, unknown>>(`/api/admin/inquiries/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.inquiries() });
    },
  });
}

export function useArchiveInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      deleteWithCredentials<{ success: boolean }>(`/api/admin/inquiries/${id}?archive=true`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.inquiries() });
    },
  });
}

export function useSyncHubSpotSubmissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postWithCredentials<{ newInserted: number }>('/api/admin/hubspot/sync-form-submissions', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.inquiries() });
    },
  });
}

export function useMembershipTiers(activeOnly?: boolean) {
  return useQuery({
    queryKey: adminTabKeys.tiers(activeOnly),
    queryFn: () => {
      const url = activeOnly ? '/api/membership-tiers?active=true' : '/api/membership-tiers';
      return fetchWithCredentials<Array<Record<string, unknown>>>(url);
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useStripeCoupons() {
  return useQuery({
    queryKey: adminTabKeys.coupons(),
    queryFn: () => fetchWithCredentials<{ coupons: Array<Record<string, unknown>> }>('/api/stripe/coupons'),
    staleTime: 1000 * 60 * 10,
  });
}

export function usePricing() {
  return useQuery({
    queryKey: ['pricing'],
    queryFn: () => fetchWithCredentials<Record<string, unknown>>('/api/pricing'),
    staleTime: 1000 * 60 * 10,
  });
}

export function useUploadImage() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/admin/upload-image', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json() as Promise<{ imageUrl: string; originalSize: number; optimizedSize: number }>;
    },
  });
}

export function useReorderGallery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { items: Array<{ id: number; sortOrder: number }> }) =>
      postWithCredentials<{ success: boolean }>('/api/admin/gallery/reorder', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.gallery() });
    },
  });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      postWithCredentials<Record<string, unknown>>('/api/stripe/coupons', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.coupons() });
    },
  });
}

export function useUpdateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string }) =>
      putWithCredentials<Record<string, unknown>>(`/api/stripe/coupons/${encodeURIComponent(id)}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.coupons() });
    },
  });
}

export function useDeleteCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteWithCredentials<Record<string, unknown>>(`/api/stripe/coupons/${encodeURIComponent(id)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTabKeys.coupons() });
    },
  });
}

export function useStaffNotifications(email: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: adminTabKeys.staffNotifications(email),
    queryFn: () => fetchWithCredentials<Array<Record<string, unknown>>>(`/api/notifications?user_email=${encodeURIComponent(email!)}`),
    enabled: (options?.enabled ?? true) && !!email,
    staleTime: 1000 * 60 * 2,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      putWithCredentials<Record<string, unknown>>(`/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...adminTabKeys.all, 'staff-notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      putWithCredentials<Record<string, unknown>>('/api/notifications/mark-all-read', { user_email: email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...adminTabKeys.all, 'staff-notifications'] });
    },
  });
}

export function useDismissAllNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      fetchWithCredentials<Record<string, unknown>>('/api/notifications/dismiss-all', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: email }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...adminTabKeys.all, 'staff-notifications'] });
    },
  });
}

