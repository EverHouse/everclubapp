import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithCredentials, postWithCredentials } from './useFetch';
import { financialsKeys } from './adminKeys';

interface DailySummary {
  date: string;
  totalCollected: number;
  breakdown: {
    guestFee: number;
    overage: number;
    merchandise: number;
    membership: number;
    cash: number;
    check: number;
    other: number;
  };
  transactionCount: number;
}

interface OverduePayment {
  bookingId: number;
  sessionId: number;
  ownerEmail: string;
  ownerName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  resourceName: string;
  totalOutstanding: number;
}

interface FailedPayment {
  id: number;
  paymentIntentId: string;
  memberEmail: string;
  memberName: string;
  amount: number;
  description: string | null;
  status: string;
  failureReason: string | null;
  retryCount: number;
  lastRetryAt: string | null;
  requiresCardUpdate: boolean;
  dunningNotifiedAt: string | null;
  createdAt: string;
}

interface PendingAuthorization {
  id: number;
  paymentIntentId: string;
  memberEmail: string;
  memberName: string;
  amount: number;
  description: string | null;
  createdAt: string;
  expiresAt: string;
}

interface RefundablePayment {
  id: number;
  paymentIntentId: string;
  memberEmail: string;
  memberName: string;
  amount: number;
  description: string;
  createdAt: string;
  status: string;
  [key: string]: unknown;
}

interface FutureBookingWithFees {
  bookingId: number;
  memberEmail: string;
  memberName: string;
  tier: string | null;
  date: string;
  startTime: string;
  endTime: string;
  resourceName: string;
  status: string;
  playerCount: number;
  guestCount: number;
  estimatedFeeCents: number;
  hasPaymentIntent: boolean;
}

interface SubscriptionListItem {
  id: string;
  memberEmail: string;
  memberName: string;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

interface InvoiceListItem {
  id: string;
  memberEmail: string;
  memberName: string;
  number: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

export interface TransactionDetail {
  id: string;
  amount: number;
  status: string;
  description: string | null;
  purpose: string | null;
  createdAt: string;
  memberEmail: string | null;
  memberName: string;
  paymentMethod: string;
  paymentMethodBrand: string;
  paymentMethodLast4: string;
  chargeSource: string;
  receiptUrl: string | null;
  stripeUrl: string;
  bookingInfo: {
    bookingId: number;
    date: string;
    resourceName: string;
    startTime: string;
    endTime: string;
  } | null;
  refundHistory: Array<{
    id: string;
    amount: number;
    reason: string | null;
    status: string;
    createdAt: number;
    processedBy: string | null;
  }>;
  totalRefunded: number;
  refundableAmount: number;
  sourceType?: 'cache';
}

export { financialsKeys };

export function useTransactionDetail(paymentIntentId: string | null) {
  return useQuery({
    queryKey: financialsKeys.transactionDetail(paymentIntentId || ''),
    queryFn: () => fetchWithCredentials<TransactionDetail>(`/api/payments/${paymentIntentId}/details`),
    enabled: !!paymentIntentId,
  });
}

export function useDailySummary() {
  return useQuery({
    queryKey: financialsKeys.dailySummary(),
    queryFn: () => fetchWithCredentials<DailySummary>('/api/payments/daily-summary'),
  });
}

export function useOverduePayments() {
  return useQuery({
    queryKey: financialsKeys.overduePayments(),
    queryFn: () => fetchWithCredentials<OverduePayment[]>('/api/bookings/overdue-payments'),
  });
}

export function useFailedPayments() {
  return useQuery({
    queryKey: financialsKeys.failedPayments(),
    queryFn: async () => {
      const data = await fetchWithCredentials<FailedPayment[]>('/api/payments/failed');
      return Array.isArray(data) ? data : [];
    },
  });
}

export function usePendingAuthorizations() {
  return useQuery({
    queryKey: financialsKeys.pendingAuthorizations(),
    queryFn: async () => {
      const data = await fetchWithCredentials<PendingAuthorization[]>('/api/payments/pending-authorizations');
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useFutureBookingsWithFees() {
  return useQuery({
    queryKey: financialsKeys.futureBookingsWithFees(),
    queryFn: async () => {
      const data = await fetchWithCredentials<FutureBookingWithFees[]>('/api/payments/future-bookings-with-fees');
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useRefundedPayments() {
  return useQuery({
    queryKey: financialsKeys.refundedPayments(),
    queryFn: async () => {
      const data = await fetchWithCredentials<RefundablePayment[]>('/api/payments/refunded');
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useSubscriptions(statusFilter: string = 'all') {
  return useInfiniteQuery({
    queryKey: financialsKeys.subscriptions(statusFilter),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('limit', '50');
      if (pageParam) params.append('starting_after', pageParam);
      const url = `/api/financials/subscriptions${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await fetchWithCredentials<{ subscriptions: SubscriptionListItem[]; hasMore: boolean; nextCursor?: string }>(url);
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}

export function useInvoices(statusFilter: string = 'all', startDate?: string, endDate?: string) {
  return useInfiniteQuery({
    queryKey: financialsKeys.invoices({ status: statusFilter, startDate, endDate }),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      const stripeStatus = statusFilter === 'refunded' ? 'paid' : statusFilter;
      if (stripeStatus !== 'all') params.append('status', stripeStatus);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('limit', '50');
      if (pageParam) params.append('starting_after', pageParam);
      const url = `/api/financials/invoices${params.toString() ? `?${params.toString()}` : ''}`;
      const data = await fetchWithCredentials<{ invoices: InvoiceListItem[]; hasMore: boolean; nextCursor?: string }>(url);
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}

export interface ActivityItem {
  id: string;
  amountCents: number;
  status: string;
  description: string;
  memberEmail: string;
  memberName: string;
  createdAt: string;
  type: string;
  bookingId: number | null;
}

interface ActivityFeedResponse {
  success: boolean;
  count: number;
  items: ActivityItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ActivityFeedParams {
  search?: string;
  status?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
}

export function useActivityFeed(params: ActivityFeedParams = {}) {
  return useInfiniteQuery({
    queryKey: financialsKeys.activityFeed(params),
    queryFn: async ({ pageParam }) => {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.append('search', params.search);
      if (params.status && params.status !== 'all') searchParams.append('status', params.status);
      if (params.type && params.type !== 'all') searchParams.append('type', params.type);
      if (params.startDate) searchParams.append('startDate', params.startDate);
      if (params.endDate) searchParams.append('endDate', params.endDate);
      searchParams.append('limit', '50');
      if (pageParam) searchParams.append('cursor', pageParam);
      const url = `/api/financials/activity${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const data = await fetchWithCredentials<ActivityFeedResponse>(url);
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}

interface ActivityCountsResponse {
  success: boolean;
  counts: Record<string, number>;
}

export function useActivityCounts() {
  return useQuery({
    queryKey: [...financialsKeys.all, 'activity-counts'],
    queryFn: async () => {
      const data = await fetchWithCredentials<ActivityCountsResponse>('/api/financials/activity/counts');
      return data.counts;
    },
    staleTime: 30_000,
  });
}

export function useSyncStripe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      postWithCredentials<{ success: boolean; synced: { paymentIntents: number; invoices: number; total: number }; errors?: string[] }>('/api/financials/sync-stripe', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.all });
    },
  });
}

export function useExportActivity() {
  return useMutation({
    mutationFn: async (params: ActivityFeedParams) => {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.append('search', params.search);
      if (params.status && params.status !== 'all') searchParams.append('status', params.status);
      if (params.type && params.type !== 'all') searchParams.append('type', params.type);
      if (params.startDate) searchParams.append('startDate', params.startDate);
      if (params.endDate) searchParams.append('endDate', params.endDate);
      const url = `/api/financials/activity/export${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to export activity');
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `activity-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    },
  });
}

export function useRetryPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentIntentId: string) => 
      postWithCredentials<{ success: boolean }>('/api/payments/retry', { paymentIntentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.failedPayments() });
    },
  });
}

export function useCancelPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentIntentId: string) => 
      postWithCredentials<{ success: boolean }>('/api/payments/cancel', { paymentIntentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.failedPayments() });
    },
  });
}

export function useCapturePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentIntentId, amountCents }: { paymentIntentId: string; amountCents?: number }) =>
      postWithCredentials<{ success: boolean }>('/api/payments/capture', { paymentIntentId, amountCents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.pendingAuthorizations() });
      queryClient.invalidateQueries({ queryKey: financialsKeys.dailySummary() });
    },
  });
}

export function useVoidPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentIntentId, reason }: { paymentIntentId: string; reason?: string }) =>
      postWithCredentials<{ success: boolean }>('/api/payments/void-authorization', { paymentIntentId, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.pendingAuthorizations() });
    },
  });
}

export function useRefundPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentIntentId, amountCents, reason }: { paymentIntentId: string; amountCents?: number | null; reason: string }) =>
      postWithCredentials<{ success: boolean }>('/api/payments/refund', { paymentIntentId, amountCents, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financialsKeys.refundablePayments() });
      queryClient.invalidateQueries({ queryKey: financialsKeys.refundedPayments() });
      queryClient.invalidateQueries({ queryKey: financialsKeys.dailySummary() });
    },
  });
}
