import { useCallback } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useToast } from '../hooks/useToast';
import { bookingsKeys, simulatorKeys } from './queries/adminKeys';
import { apiRequest, ApiResult } from '../lib/apiRequest';

export interface CheckInOptions {
  status?: 'attended' | 'no_show' | 'cancelled';
  source?: string;
  skipPaymentCheck?: boolean;
  version?: number;
}

export interface CheckInResult {
  success: boolean;
  requiresPayment?: boolean;
  requiresRoster?: boolean;
  requiresSync?: boolean;
  error?: string;
  data?: unknown;
}

export interface ChargeCardOptions {
  memberEmail: string;
  bookingId: number;
  sessionId: number;
  participantIds?: number[];
}

export interface FeeLineItemResult {
  participantId: number;
  displayName: string;
  participantType: 'owner' | 'member' | 'guest';
  overageCents: number;
  guestCents: number;
  totalCents: number;
}

export interface ChargeCardResult {
  success: boolean;
  noSavedCard?: boolean;
  noStripeCustomer?: boolean;
  requiresAction?: boolean;
  cardError?: boolean;
  error?: string;
  message?: string;
  invoiceId?: string;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
  feeLineItems?: FeeLineItemResult[];
  totalAmount?: number;
  amountCharged?: number;
  balanceApplied?: number;
}

export interface StaffCancelOptions {
  source?: string;
  cancelledBy?: string;
  version?: number;
}

class MutationApiError extends Error {
  constructor(public result: ApiResult<Record<string, unknown>>) {
    super(result.error || 'API error');
  }
}

type EntityRollbackContext = {
  bookingId: number | string;
  originalStatus: string | undefined;
};

function invalidateBookingQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: bookingsKeys.all });
  queryClient.invalidateQueries({ queryKey: simulatorKeys.all });
}

function applyOptimisticStatus(old: unknown, bookingId: number | string, status: string) {
  if (!Array.isArray(old)) return old;
  return old.map((b: Record<string, unknown>) =>
    String(b.id) === String(bookingId) ? { ...b, status } : b
  );
}

function findBookingStatus(queryClient: ReturnType<typeof useQueryClient>, bookingId: number | string): string | undefined {
  let originalStatus: string | undefined;
  queryClient.getQueriesData({ queryKey: bookingsKeys.all }).forEach(([, data]) => {
    if (Array.isArray(data)) {
      const booking = data.find((b: Record<string, unknown>) => String(b.id) === String(bookingId));
      if (booking && !originalStatus) originalStatus = booking.status as string;
    }
  });
  if (!originalStatus) {
    queryClient.getQueriesData({ queryKey: simulatorKeys.all }).forEach(([, data]) => {
      if (Array.isArray(data)) {
        const booking = data.find((b: Record<string, unknown>) => String(b.id) === String(bookingId));
        if (booking && !originalStatus) originalStatus = booking.status as string;
      }
    });
  }
  return originalStatus;
}

function rollbackEntity(queryClient: ReturnType<typeof useQueryClient>, bookingId: number | string, originalStatus: string) {
  queryClient.setQueriesData(
    { queryKey: bookingsKeys.all },
    (old: unknown) => applyOptimisticStatus(old, bookingId, originalStatus)
  );
  queryClient.setQueriesData(
    { queryKey: simulatorKeys.all },
    (old: unknown) => applyOptimisticStatus(old, bookingId, originalStatus)
  );
}

export function useBookingActions() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const prepareOptimistic = async (
    bookingId: number | string,
    newStatus: string
  ): Promise<EntityRollbackContext> => {
    await queryClient.cancelQueries({ queryKey: bookingsKeys.all });
    await queryClient.cancelQueries({ queryKey: simulatorKeys.all });

    const originalStatus = findBookingStatus(queryClient, bookingId);

    queryClient.setQueriesData(
      { queryKey: bookingsKeys.all },
      (old: unknown) => applyOptimisticStatus(old, bookingId, newStatus)
    );
    queryClient.setQueriesData(
      { queryKey: simulatorKeys.all },
      (old: unknown) => applyOptimisticStatus(old, bookingId, newStatus)
    );

    return { bookingId, originalStatus };
  };

  const checkInMutation = useMutation<
    ApiResult<Record<string, unknown>>,
    MutationApiError,
    { bookingId: number | string; options: CheckInOptions },
    EntityRollbackContext
  >({
    mutationFn: async ({ bookingId, options }) => {
      const { status = 'attended', source, skipPaymentCheck, version } = options;
      const res = await apiRequest<Record<string, unknown>>(`/api/bookings/${bookingId}/checkin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, source, skipPaymentCheck, ...(version !== undefined ? { version } : {}) })
      }, { maxRetries: 1 });
      if (!res.ok) throw new MutationApiError(res);
      return res;
    },
    onMutate: async ({ bookingId, options }) => {
      return await prepareOptimistic(bookingId, options.status || 'attended');
    },
    onError: (_err, _vars, context) => {
      if (context?.originalStatus) {
        rollbackEntity(queryClient, context.bookingId, context.originalStatus);
      }
    },
    onSettled: () => {
      invalidateBookingQueries(queryClient);
    },
  });

  const staffCancelMutation = useMutation<
    ApiResult<Record<string, unknown>>,
    MutationApiError,
    { bookingId: number | string; options: StaffCancelOptions },
    EntityRollbackContext
  >({
    mutationFn: async ({ bookingId, options }) => {
      const { source, cancelledBy, version } = options;
      const res = await apiRequest<Record<string, unknown>>(`/api/booking-requests/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', source, cancelled_by: cancelledBy, ...(version !== undefined ? { version } : {}) })
      }, { maxRetries: 1 });
      if (!res.ok) throw new MutationApiError(res);
      return res;
    },
    onMutate: async ({ bookingId }) => {
      return await prepareOptimistic(bookingId, 'cancelled');
    },
    onError: (_err, _vars, context) => {
      if (context?.originalStatus) {
        rollbackEntity(queryClient, context.bookingId, context.originalStatus);
      }
    },
    onSettled: () => {
      invalidateBookingQueries(queryClient);
    },
  });

  const revertMutation = useMutation<
    ApiResult<Record<string, unknown>>,
    MutationApiError,
    { bookingId: number | string; version?: number },
    EntityRollbackContext
  >({
    mutationFn: async ({ bookingId, version }) => {
      const res = await apiRequest<Record<string, unknown>>(`/api/bookings/${bookingId}/revert-to-approved`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(version !== undefined ? { version } : {}) }),
      }, { maxRetries: 1 });
      if (!res.ok) throw new MutationApiError(res);
      return res;
    },
    onMutate: async ({ bookingId }) => {
      return await prepareOptimistic(bookingId, 'approved');
    },
    onError: (_err, _vars, context) => {
      if (context?.originalStatus) {
        rollbackEntity(queryClient, context.bookingId, context.originalStatus);
      }
    },
    onSettled: () => {
      invalidateBookingQueries(queryClient);
    },
  });

  const checkInBooking = useCallback(async (
    bookingId: number | string,
    options: CheckInOptions = {}
  ): Promise<CheckInResult> => {
    try {
      await checkInMutation.mutateAsync({ bookingId, options });
      return { success: true };
    } catch (err) {
      if (!(err instanceof MutationApiError)) {
        return { success: false, error: 'Failed to update status' };
      }

      const res = err.result;
      const errorData = res.errorData || {};

      if (res.status === 409) {
        return { success: false, error: (errorData.error as string) || 'This booking was updated by someone else. Please refresh and try again.' };
      }

      if (errorData.requiresRoster || errorData.requiresPayment || errorData.error === 'Payment required') {
        return {
          success: false,
          requiresPayment: !errorData.requiresRoster,
          requiresRoster: !!errorData.requiresRoster,
          error: (errorData.error as string) || 'Payment required',
          data: errorData
        };
      }

      if (errorData.requiresSync && !options.skipPaymentCheck) {
        const retryRes = await apiRequest<Record<string, unknown>>(`/api/bookings/${bookingId}/checkin`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: options.status || 'attended',
            source: options.source,
            skipPaymentCheck: true,
            ...(options.version !== undefined ? { version: options.version } : {})
          })
        }, { maxRetries: 1 });

        if (retryRes.ok) {
          invalidateBookingQueries(queryClient);
          return { success: true };
        }
        return { success: false, error: retryRes.error || 'Failed to check in after retry' };
      }

      return { success: false, requiresSync: !!errorData.requiresSync, error: res.error || 'Failed to update status' };
    }
  }, [checkInMutation, queryClient]);

  const checkInWithToast = useCallback(async (
    bookingId: number | string,
    options: CheckInOptions = {}
  ): Promise<CheckInResult> => {
    const result = await checkInBooking(bookingId, options);
    const status = options.status || 'attended';

    if (result.success) {
      const label = status === 'attended' ? 'checked in' :
                    status === 'no_show' ? 'marked as no show' :
                    status === 'cancelled' ? 'cancelled' : 'updated';
      const suffix = result.requiresSync === undefined && options.skipPaymentCheck
        ? ' (billing session pending)' : '';
      showToast(`Booking ${label}${suffix}`, 'success');
    } else if (!result.requiresPayment && !result.requiresRoster) {
      showToast(result.error || 'Check-in failed', 'error');
    }

    return result;
  }, [checkInBooking, showToast]);

  const chargeCardOnFile = useCallback(async (
    options: ChargeCardOptions
  ): Promise<ChargeCardResult> => {
    const { memberEmail, bookingId, sessionId, participantIds } = options;

    const res = await apiRequest<Record<string, unknown>>('/api/stripe/staff/charge-saved-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberEmail,
        bookingId,
        sessionId,
        ...(participantIds ? { participantIds } : {})
      })
    }, { maxRetries: 1 });

    if (res.ok && res.data?.success) {
      const data = res.data;
      invalidateBookingQueries(queryClient);
      return { 
        success: true, 
        message: (data.message as string) || 'Card charged successfully',
        invoiceId: data.invoiceId as string | undefined,
        hostedInvoiceUrl: data.hostedInvoiceUrl as string | null | undefined,
        invoicePdf: data.invoicePdf as string | null | undefined,
        feeLineItems: data.feeLineItems as FeeLineItemResult[] | undefined,
        totalAmount: data.totalAmount as number | undefined,
        amountCharged: data.amountCharged as number | undefined,
        balanceApplied: data.balanceApplied as number | undefined,
      };
    }

    const errorData = res.ok ? res.data : res.errorData;
    if (!errorData) {
      return { success: false, error: res.error || 'Failed to charge card' };
    }

    if (errorData.noSavedCard || errorData.noStripeCustomer) {
      return { success: false, noSavedCard: true };
    }
    if (errorData.requiresAction) {
      return { success: false, requiresAction: true };
    }
    if (errorData.cardError) {
      return { success: false, cardError: true, error: errorData.error as string };
    }
    return { success: false, error: (errorData.error as string) || res.error || 'Failed to charge card' };
  }, [queryClient]);

  const chargeCardWithToast = useCallback(async (
    options: ChargeCardOptions
  ): Promise<ChargeCardResult> => {
    const result = await chargeCardOnFile(options);

    if (result.success) {
      showToast(result.message || 'Card charged successfully', 'success');
    } else if (result.noSavedCard) {
      showToast('No saved card on file', 'warning');
    } else if (result.requiresAction) {
      showToast('Card requires additional verification - use the card payment option', 'warning');
    } else if (result.cardError) {
      showToast(`Card declined: ${result.error}`, 'error');
    } else {
      showToast(result.error || 'Failed to charge card', 'error');
    }

    return result;
  }, [chargeCardOnFile, showToast]);

  const staffCancelBooking = useCallback(async (
    bookingId: number | string,
    options: StaffCancelOptions = {}
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await staffCancelMutation.mutateAsync({ bookingId, options });
      return { success: true };
    } catch (err) {
      if (err instanceof MutationApiError) {
        const res = err.result;
        if (res.status === 409) {
          const errorData = res.errorData || {};
          return { success: false, error: (errorData.error as string) || 'This booking was updated by someone else. Please refresh and try again.' };
        }
        return { success: false, error: res.error || 'Failed to cancel booking' };
      }
      return { success: false, error: 'Failed to cancel booking' };
    }
  }, [staffCancelMutation]);

  const staffCancelWithToast = useCallback(async (
    bookingId: number | string,
    options: StaffCancelOptions = {}
  ): Promise<{ success: boolean; error?: string }> => {
    const result = await staffCancelBooking(bookingId, options);

    if (result.success) {
      showToast('Booking cancelled', 'success');
    } else {
      showToast(result.error || 'Failed to cancel booking', 'error');
    }

    return result;
  }, [staffCancelBooking, showToast]);

  const revertToApproved = useCallback(async (bookingId: number | string, options?: { version?: number }): Promise<{ success?: boolean; error?: string }> => {
    try {
      await revertMutation.mutateAsync({ bookingId, version: options?.version });
      return { success: true };
    } catch (err) {
      if (err instanceof MutationApiError) {
        const res = err.result;
        if (res.status === 409) {
          const errorData = res.errorData || {};
          return { error: (errorData.error as string) || 'This booking was updated by someone else. Please refresh and try again.' };
        }
        return { error: res.error || 'Failed to revert booking' };
      }
      return { error: 'Failed to revert booking' };
    }
  }, [revertMutation]);

  const revertToApprovedWithToast = useCallback(async (bookingId: number | string) => {
    const result = await revertToApproved(bookingId);
    if (result.success) {
      showToast('Booking reverted to approved', 'success');
    } else {
      showToast(result.error || 'Failed to revert booking', 'error');
    }
    return result;
  }, [revertToApproved, showToast]);

  return {
    checkInBooking,
    checkInWithToast,
    chargeCardOnFile,
    chargeCardWithToast,
    staffCancelBooking,
    staffCancelWithToast,
    revertToApproved,
    revertToApprovedWithToast,
    invalidateBookingQueries: () => invalidateBookingQueries(queryClient)
  };
}
