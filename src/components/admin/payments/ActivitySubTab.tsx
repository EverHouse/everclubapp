import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import Icon from '../../icons/Icon';
import WalkingGolferSpinner from '../../WalkingGolferSpinner';
import { FinancialsSubTabSkeleton } from '../../skeletons';
import { UnifiedBookingSheet } from '../../staff-command-center/modals/UnifiedBookingSheet';
import { TransactionDetailSheet } from './TransactionDetailSheet';
import {
  useActivityFeed,
  useActivityCounts,
  useSyncStripe,
  useExportActivity,
  useFinalizeInvoice,
  useVoidInvoice,
  useSendInvoice,
  useMarkInvoiceUncollectible,
  useDeleteDraftInvoice,
  type ActivityItem,
} from '../../../hooks/queries/useFinancialsQueries';

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'succeeded', label: 'Succeeded' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'failed', label: 'Failed' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'draft', label: 'Draft' },
  { key: 'open', label: 'Open' },
  { key: 'void', label: 'Void' },
  { key: 'uncollectible', label: 'Uncollectible' },
] as const;

const TYPE_FILTERS = [
  { key: 'all', label: 'All Types', icon: 'list' },
  { key: 'payment', label: 'Payments', icon: 'credit_card' },
  { key: 'invoice', label: 'Invoices', icon: 'receipt' },
  { key: 'pos', label: 'POS/Terminal', icon: 'point_of_sale' },
  { key: 'subscription', label: 'Subscriptions', icon: 'sync' },
] as const;

const TYPE_ICONS: Record<string, { icon: string; label: string }> = {
  payment: { icon: 'credit_card', label: 'Payment' },
  invoice: { icon: 'receipt', label: 'Invoice' },
  pos: { icon: 'point_of_sale', label: 'POS' },
  subscription: { icon: 'sync', label: 'Subscription' },
  refund: { icon: 'undo', label: 'Refund' },
  dispute: { icon: 'gavel', label: 'Dispute' },
};

const getStatusBadgeClasses = (status: string): string => {
  switch (status) {
    case 'succeeded':
      return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400';
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400';
    case 'refunded':
    case 'partially_refunded':
      return 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400';
    case 'disputed':
      return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400';
    case 'draft':
      return 'bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400';
    case 'pending':
    case 'requires_capture':
    case 'requires_action':
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400';
    case 'open':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400';
    case 'void':
    case 'canceled':
      return 'bg-gray-100 dark:bg-gray-800/40 text-gray-500 dark:text-gray-500';
    case 'uncollectible':
      return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400';
    default:
      return 'bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400';
  }
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'succeeded': return 'check_circle';
    case 'failed': return 'error';
    case 'refunded':
    case 'partially_refunded': return 'undo';
    case 'disputed': return 'gavel';
    case 'draft': return 'edit_note';
    case 'pending':
    case 'requires_capture':
    case 'requires_action': return 'schedule';
    case 'open': return 'mail';
    case 'void':
    case 'canceled': return 'block';
    case 'uncollectible': return 'money_off';
    default: return 'circle';
  }
};

const formatStatusLabel = (status: string): string => {
  switch (status) {
    case 'partially_refunded': return 'Partial Refund';
    case 'requires_capture': return 'Pending Capture';
    case 'requires_action': return 'Action Required';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
};

const formatCurrency = (cents: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

interface InvoiceActionConfirmProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant: 'danger' | 'primary' | 'warning';
  isPending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const InvoiceActionConfirmDialog: React.FC<InvoiceActionConfirmProps> = ({
  isOpen, title, message, confirmLabel, confirmVariant, isPending, error, onConfirm, onCancel,
}) => {
  if (!isOpen) return null;

  const variantClasses = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    primary: 'bg-primary dark:bg-accent hover:bg-primary/90 dark:hover:bg-accent/90 text-white dark:text-primary',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-primary dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-primary/70 dark:text-white/70 mb-4">{message}</p>
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-800 text-primary dark:text-white rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 ${variantClasses[confirmVariant]}`}
          >
            {isPending ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

type InvoiceActionType = 'finalize' | 'void' | 'send' | 'mark-uncollectible' | 'delete';

interface InvoiceActionState {
  isOpen: boolean;
  action: InvoiceActionType | null;
  item: ActivityItem | null;
}

const getInvoiceActionConfig = (action: InvoiceActionType, item: ActivityItem): Omit<InvoiceActionConfirmProps, 'isOpen' | 'isPending' | 'onConfirm' | 'onCancel'> => {
  const amount = formatCurrency(item.amountCents);
  const member = item.memberName || item.memberEmail;

  switch (action) {
    case 'finalize':
      return {
        title: 'Finalize Invoice',
        message: `Finalize this ${amount} draft invoice for ${member}? This will lock the invoice and allow payment collection.`,
        confirmLabel: 'Finalize',
        confirmVariant: 'primary',
      };
    case 'void':
      return {
        title: 'Void Invoice',
        message: `Void this ${amount} open invoice for ${member}? The member will no longer be able to pay it.`,
        confirmLabel: 'Void Invoice',
        confirmVariant: 'danger',
      };
    case 'send':
      return {
        title: 'Send Invoice to Member',
        message: `Send the payment link for this ${amount} invoice to ${member}? They will receive an email with a link to pay.`,
        confirmLabel: 'Send to Member',
        confirmVariant: 'primary',
      };
    case 'mark-uncollectible':
      return {
        title: 'Mark as Uncollectible',
        message: `Mark this ${amount} invoice for ${member} as uncollectible? This indicates the payment is unlikely to be collected.`,
        confirmLabel: 'Mark Uncollectible',
        confirmVariant: 'warning',
      };
    case 'delete':
      return {
        title: 'Delete Draft Invoice',
        message: `Delete this ${amount} draft invoice for ${member}? This action cannot be undone.`,
        confirmLabel: 'Delete',
        confirmVariant: 'danger',
      };
  }
};

interface InvoiceActionsProps {
  item: ActivityItem;
  onAction: (action: InvoiceActionType, item: ActivityItem) => void;
  compact?: boolean;
}

const InvoiceActionButtons: React.FC<InvoiceActionsProps> = ({ item, onAction, compact = false }) => {
  if (item.type !== 'invoice') return null;

  const btnBase = compact
    ? 'px-2 py-0.5 text-[10px] font-medium rounded-lg transition-colors'
    : 'px-2.5 py-1 text-xs font-medium rounded-lg transition-colors';

  if (item.status === 'draft') {
    return (
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <button
          onClick={(e) => { e.stopPropagation(); onAction('finalize', item); }}
          className={`tactile-btn ${btnBase} bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50`}
        >
          Finalize
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAction('delete', item); }}
          className={`tactile-btn ${btnBase} bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50`}
        >
          Delete
        </button>
      </div>
    );
  }

  if (item.status === 'open') {
    return (
      <div className="flex items-center gap-1.5 flex-wrap justify-end">
        <button
          onClick={(e) => { e.stopPropagation(); onAction('send', item); }}
          className={`tactile-btn ${btnBase} bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50`}
        >
          Send to Member
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAction('void', item); }}
          className={`tactile-btn ${btnBase} bg-gray-100 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700`}
        >
          Void
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAction('mark-uncollectible', item); }}
          className={`tactile-btn ${btnBase} bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50`}
        >
          Uncollectible
        </button>
      </div>
    );
  }

  return null;
};

const formatDate = (isoString: string) => {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
};

const formatDateTime = (isoString: string) => {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
};

const ActivityListItem: React.FC<{ item: ActivityItem; onViewBooking?: (bookingId: number) => void; onViewTransaction?: (id: string) => void; onInvoiceAction?: (action: InvoiceActionType, item: ActivityItem) => void }> = ({ item, onViewBooking, onViewTransaction, onInvoiceAction }) => {
  const typeInfo = TYPE_ICONS[item.type] || { icon: 'receipt_long', label: item.type };
  const isClickable = !!onViewTransaction;

  const content = (
    <div className="flex items-start gap-3">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getStatusBadgeClasses(item.status)}`}>
        <Icon name={getStatusIcon(item.status)} className="text-lg" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm text-primary dark:text-white truncate">
            {item.memberName}
          </p>
          <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase tracking-wide ${getStatusBadgeClasses(item.status)}`}>
            {formatStatusLabel(item.status)}
          </span>
        </div>
        <p className="text-xs text-primary/60 dark:text-white/60 truncate mt-0.5">
          {item.description}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="flex items-center gap-1 text-[11px] text-primary/50 dark:text-white/50">
            <Icon name={typeInfo.icon} className="text-xs" />
            {typeInfo.label}
          </span>
          <span className="text-primary/30 dark:text-white/30">&middot;</span>
          <span className="text-[11px] text-primary/50 dark:text-white/50">
            {formatDateTime(item.createdAt)}
          </span>
        </div>
      </div>

      <div className="text-right flex-shrink-0 flex items-center gap-2">
        <div className="space-y-1.5">
          <p className={`font-bold text-sm ${
            item.status === 'refunded' || item.status === 'partially_refunded' ? 'text-purple-600 dark:text-purple-400' :
            item.status === 'failed' ? 'text-red-600 dark:text-red-400' :
            'text-primary dark:text-white'
          }`}>
            {item.status === 'refunded' || item.status === 'partially_refunded' ? '-' : ''}{formatCurrency(item.amountCents)}
          </p>
          {item.type === 'invoice' && item.bookingId && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewBooking?.(item.bookingId!); }}
              className="tactile-btn px-2 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              View Booking
            </button>
          )}
          {onInvoiceAction && (
            <InvoiceActionButtons item={item} onAction={onInvoiceAction} compact />
          )}
        </div>
        {isClickable && (
          <Icon name="chevron_right" className="text-primary/30 dark:text-white/30 text-lg" />
        )}
      </div>
    </div>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={() => onViewTransaction(item.id)}
        className="w-full text-left bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl p-4 tactile-row hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl p-4 tactile-row">
      {content}
    </div>
  );
};

const ActivityTableRow: React.FC<{ item: ActivityItem; onViewBooking?: (bookingId: number) => void; onViewTransaction?: (id: string) => void; onInvoiceAction?: (action: InvoiceActionType, item: ActivityItem) => void }> = ({ item, onViewBooking, onViewTransaction, onInvoiceAction }) => {
  const typeInfo = TYPE_ICONS[item.type] || { icon: 'receipt_long', label: item.type };
  const isClickable = !!onViewTransaction;

  return (
    <tr
      className={`hover:bg-primary/5 dark:hover:bg-white/5 transition-colors tactile-row ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={isClickable ? () => onViewTransaction(item.id) : undefined}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getStatusBadgeClasses(item.status)}`}>
            <Icon name={getStatusIcon(item.status)} className="text-sm" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-primary dark:text-white truncate">{item.memberName}</p>
            <p className="text-xs text-primary/60 dark:text-white/60 truncate">{item.memberEmail}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className={`font-medium ${
          item.status === 'refunded' || item.status === 'partially_refunded' ? 'text-purple-600 dark:text-purple-400' :
          item.status === 'failed' ? 'text-red-600 dark:text-red-400' :
          'text-primary dark:text-white'
        }`}>
          {item.status === 'refunded' || item.status === 'partially_refunded' ? '-' : ''}{formatCurrency(item.amountCents)}
        </p>
      </td>
      <td className="px-4 py-3">
        <span className={`px-2.5 py-1 rounded-[4px] text-xs font-medium ${getStatusBadgeClasses(item.status)}`}>
          {formatStatusLabel(item.status)}
        </span>
      </td>
      <td className="px-4 py-3">
        <p className="text-sm text-primary dark:text-white truncate max-w-[200px]">{item.description}</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Icon name={typeInfo.icon} className="text-sm text-primary/50 dark:text-white/50" />
          <span className="text-xs text-primary/60 dark:text-white/60">{typeInfo.label}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="text-primary dark:text-white text-sm">{formatDate(item.createdAt)}</p>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center gap-1.5 justify-end">
          {item.type === 'invoice' && item.bookingId && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewBooking?.(item.bookingId!); }}
              className="tactile-btn px-2.5 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
            >
              View Booking
            </button>
          )}
          {onInvoiceAction && (
            <InvoiceActionButtons item={item} onAction={onInvoiceAction} />
          )}
        </div>
      </td>
    </tr>
  );
};

const ActivitySubTab: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
  const [bookingSheet, setBookingSheet] = useState<{ isOpen: boolean; bookingId: number | null }>({ isOpen: false, bookingId: null });
  const [detailTxId, setDetailTxId] = useState<string | null>(null);
  const [invoiceAction, setInvoiceAction] = useState<InvoiceActionState>({ isOpen: false, action: null, item: null });
  const [invoiceActionError, setInvoiceActionError] = useState<string | null>(null);
  const [listParent] = useAutoAnimate();
  const [tbodyParent] = useAutoAnimate();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  const {
    data,
    isLoading,
    error: queryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useActivityFeed({
    search: debouncedSearch || undefined,
    status: statusFilter,
    type: typeFilter,
    startDate: appliedStartDate || undefined,
    endDate: appliedEndDate || undefined,
  });

  const { data: counts } = useActivityCounts();
  const syncStripe = useSyncStripe();
  const exportActivity = useExportActivity();
  const finalizeInvoice = useFinalizeInvoice();
  const voidInvoice = useVoidInvoice();
  const sendInvoice = useSendInvoice();
  const markUncollectible = useMarkInvoiceUncollectible();
  const deleteDraftInvoice = useDeleteDraftInvoice();

  const items = data?.pages.flatMap((page) => page.items) || [];
  const totalCount = counts?.all ?? 0;
  const error = queryError instanceof Error ? queryError.message : null;

  const handleInfiniteScroll = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;
      loadMoreRef.current = node;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
          }
        },
        { rootMargin: '200px' }
      );
      observerRef.current.observe(node);
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  const handleDateFilterApply = () => {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
  };

  const handleClearDateFilters = () => {
    setStartDate('');
    setEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
  };

  const handleSync = () => {
    syncStripe.mutate();
  };

  const handleExport = () => {
    exportActivity.mutate({
      search: debouncedSearch || undefined,
      status: statusFilter,
      type: typeFilter,
      startDate: appliedStartDate || undefined,
      endDate: appliedEndDate || undefined,
    });
  };

  const handleViewBooking = (bookingId: number) => {
    setBookingSheet({ isOpen: true, bookingId });
  };

  const handleViewTransaction = (id: string) => {
    setDetailTxId(id);
  };

  const handleInvoiceAction = (action: InvoiceActionType, item: ActivityItem) => {
    setInvoiceActionError(null);
    setInvoiceAction({ isOpen: true, action, item });
  };

  const handleInvoiceActionConfirm = () => {
    if (!invoiceAction.action || !invoiceAction.item) return;
    const invoiceId = invoiceAction.item.id;
    const closeDialog = () => { setInvoiceAction({ isOpen: false, action: null, item: null }); setInvoiceActionError(null); };
    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Action failed. Please try again.';
      setInvoiceActionError(msg);
    };

    switch (invoiceAction.action) {
      case 'finalize':
        finalizeInvoice.mutate(invoiceId, { onSuccess: closeDialog, onError });
        break;
      case 'void':
        voidInvoice.mutate(invoiceId, { onSuccess: closeDialog, onError });
        break;
      case 'send':
        sendInvoice.mutate(invoiceId, { onSuccess: closeDialog, onError });
        break;
      case 'mark-uncollectible':
        markUncollectible.mutate(invoiceId, { onSuccess: closeDialog, onError });
        break;
      case 'delete':
        deleteDraftInvoice.mutate(invoiceId, { onSuccess: closeDialog, onError });
        break;
    }
  };

  const isInvoiceActionPending = finalizeInvoice.isPending || voidInvoice.isPending || sendInvoice.isPending || markUncollectible.isPending || deleteDraftInvoice.isPending;

  if (isLoading) {
    return <FinancialsSubTabSkeleton />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-4 flex items-center gap-3">
          <Icon name="error" className="text-red-600 dark:text-red-400" />
          <p className="text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/40 dark:text-white/40" />
              <input
                type="text"
                placeholder="Search by member name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/60 dark:bg-white/5 border border-primary/10 dark:border-white/20 rounded-xl text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/20 dark:focus:ring-white/20"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleSync}
              disabled={syncStripe.isPending}
              className="tactile-btn flex items-center gap-1.5 px-3 py-2.5 bg-white/60 dark:bg-white/10 border border-primary/10 dark:border-white/20 rounded-xl text-sm font-medium text-primary dark:text-white hover:bg-white/80 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
            >
              <Icon name="sync" className={`text-base ${syncStripe.isPending ? 'animate-spin' : ''}`} />
              Sync from Stripe
            </button>
            <button
              onClick={handleExport}
              disabled={exportActivity.isPending}
              className="tactile-btn flex items-center gap-1.5 px-3 py-2.5 bg-white/60 dark:bg-white/10 border border-primary/10 dark:border-white/20 rounded-xl text-sm font-medium text-primary dark:text-white hover:bg-white/80 dark:hover:bg-white/15 transition-colors disabled:opacity-50"
            >
              <Icon name="download" className="text-base" />
              {exportActivity.isPending ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {STATUS_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-2.5 py-1.5 rounded-full font-medium text-xs whitespace-nowrap flex-shrink-0 transition-colors ${
                statusFilter === key
                  ? 'bg-primary dark:bg-accent text-white dark:text-primary'
                  : 'bg-white/60 dark:bg-white/10 text-primary/60 dark:text-white/60 hover:bg-white/80 dark:hover:bg-white/15'
              }`}
            >
              {label}
              {counts && counts[key] !== undefined && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-black/10 dark:bg-white/10">
                  {counts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {TYPE_FILTERS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full font-medium text-xs whitespace-nowrap flex-shrink-0 transition-colors ${
                typeFilter === key
                  ? 'bg-primary dark:bg-accent text-white dark:text-primary'
                  : 'bg-white/60 dark:bg-white/10 text-primary/60 dark:text-white/60 hover:bg-white/80 dark:hover:bg-white/15'
              }`}
            >
              <Icon name={icon} className="text-xs" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white/40 dark:bg-white/5 border border-primary/10 dark:border-white/10 rounded-xl p-3">
          <span className="text-sm font-medium text-primary/70 dark:text-white/70">Date Range:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-1.5 bg-white/60 dark:bg-white/10 border border-primary/10 dark:border-white/20 rounded-lg text-sm text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 dark:focus:ring-white/20"
          />
          <span className="text-primary/50 dark:text-white/50">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-1.5 bg-white/60 dark:bg-white/10 border border-primary/10 dark:border-white/20 rounded-lg text-sm text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 dark:focus:ring-white/20"
          />
          <button
            onClick={handleDateFilterApply}
            className="tactile-btn px-3 py-1.5 bg-primary dark:bg-accent text-white dark:text-primary rounded-lg text-sm font-medium hover:bg-primary/90 dark:hover:bg-accent/90 transition-colors cursor-pointer"
          >
            Apply
          </button>
          {(startDate || endDate) && (
            <button
              onClick={handleClearDateFilters}
              className="px-3 py-1.5 bg-primary/10 dark:bg-white/10 text-primary dark:text-white rounded-lg text-sm font-medium hover:bg-primary/20 dark:hover:bg-white/15 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl p-8 max-w-md w-full">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 dark:bg-lavender/20 flex items-center justify-center">
                <Icon name="receipt_long" className="text-4xl text-primary dark:text-lavender" />
              </div>
              <h3 className="text-2xl leading-tight font-bold text-primary dark:text-white" style={{ fontFamily: 'var(--font-headline)' }}>No activity found</h3>
              <p className="text-sm text-primary/60 dark:text-white/60">
                {debouncedSearch || statusFilter !== 'all' || typeFilter !== 'all' || appliedStartDate || appliedEndDate
                  ? 'Try adjusting your search or filter criteria.'
                  : 'No Stripe activity is currently available.'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div ref={listParent} className="md:hidden space-y-3">
            {items.map((item) => (
              <ActivityListItem key={item.id} item={item} onViewBooking={handleViewBooking} onViewTransaction={handleViewTransaction} onInvoiceAction={handleInvoiceAction} />
            ))}
          </div>

          <div className="hidden md:block bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-primary/10 dark:border-white/10">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Member</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Description</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Date</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody ref={tbodyParent} className="divide-y divide-primary/5 dark:divide-white/5">
                  {items.map((item) => (
                    <ActivityTableRow key={item.id} item={item} onViewBooking={handleViewBooking} onViewTransaction={handleViewTransaction} onInvoiceAction={handleInvoiceAction} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div ref={handleInfiniteScroll} className="h-1" />

      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-4">
          <WalkingGolferSpinner size="sm" variant="auto" />
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-primary/60 dark:text-white/60">
        <p>Showing {items.length}{statusFilter === 'all' && typeFilter === 'all' && !debouncedSearch && !appliedStartDate && !appliedEndDate && totalCount > 0 ? ` of ${totalCount}` : ''} items</p>
        {syncStripe.isSuccess && (
          <span className="text-green-600 dark:text-green-400 text-xs font-medium">
            Stripe sync complete
          </span>
        )}
      </div>

      <UnifiedBookingSheet
        isOpen={bookingSheet.isOpen}
        onClose={() => setBookingSheet({ isOpen: false, bookingId: null })}
        mode="manage"
        bookingId={bookingSheet.bookingId || undefined}
        onSuccess={() => {
          setBookingSheet({ isOpen: false, bookingId: null });
        }}
        onRosterUpdated={() => { queryClient.invalidateQueries({ queryKey: ['financials'] }); }}
      />

      <TransactionDetailSheet
        isOpen={!!detailTxId}
        onClose={() => setDetailTxId(null)}
        paymentIntentId={detailTxId}
        onOpenBooking={(bookingId) => {
          setDetailTxId(null);
          handleViewBooking(bookingId);
        }}
        onOpenMemberProfile={(email) => {
          setDetailTxId(null);
          navigate(`/admin/directory?search=${encodeURIComponent(email)}`);
        }}
        onRefundComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['financials'] });
        }}
      />

      {invoiceAction.isOpen && invoiceAction.action && invoiceAction.item && (
        <InvoiceActionConfirmDialog
          isOpen
          {...getInvoiceActionConfig(invoiceAction.action, invoiceAction.item)}
          isPending={isInvoiceActionPending}
          error={invoiceActionError}
          onConfirm={handleInvoiceActionConfirm}
          onCancel={() => { setInvoiceAction({ isOpen: false, action: null, item: null }); setInvoiceActionError(null); }}
        />
      )}
    </div>
  );
};

export default ActivitySubTab;
