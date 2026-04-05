import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SlideUpDrawer } from '../../SlideUpDrawer';
import WalkingGolferSpinner from '../../WalkingGolferSpinner';
import Icon from '../../icons/Icon';
import { useTransactionDetail, useRefundPayment, financialsKeys } from '../../../hooks/queries/useFinancialsQueries';
import type { TransactionDetail } from '../../../hooks/queries/useFinancialsQueries';

interface TransactionDetailSheetProps {
  paymentIntentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenBooking?: (bookingId: number) => void;
  onOpenMemberProfile?: (email: string) => void;
  onRefundComplete?: () => void;
}

const reasonOptions = ['Customer request', 'Duplicate charge', 'Service not provided', 'Billing error', 'Other'];

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  succeeded: { label: 'Succeeded', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: 'check_circle' },
  refunded: { label: 'Refunded', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', icon: 'undo' },
  partially_refunded: { label: 'Partially Refunded', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: 'undo' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: 'error' },
  pending: { label: 'Pending', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: 'schedule' },
  canceled: { label: 'Canceled', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700/30 dark:text-gray-300', icon: 'cancel' },
  requires_capture: { label: 'Authorized', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: 'hourglass_top' },
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-300', icon: 'edit_note' },
  open: { label: 'Open', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: 'mail' },
  void: { label: 'Void', color: 'bg-gray-100 text-gray-500 dark:bg-gray-700/30 dark:text-gray-400', icon: 'block' },
  uncollectible: { label: 'Uncollectible', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: 'money_off' },
};

const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
};

const formatUnixDate = (timestamp: number) => {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  });
};

function RefundConfirmDialog({
  detail,
  onClose,
  onSuccess,
}: {
  detail: TransactionDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isPartial, setIsPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const refundMutation = useRefundPayment();

  const maxRefundDollars = detail.refundableAmount / 100;
  const refundAmountCents = isPartial && amount
    ? Math.round(parseFloat(amount) * 100)
    : detail.refundableAmount;

  const handleRefund = async () => {
    setError(null);
    if (isPartial) {
      const parsed = parseFloat(amount);
      if (!amount || !Number.isFinite(parsed) || parsed <= 0) {
        setError('Enter a valid refund amount');
        return;
      }
      if (Math.round(parsed * 100) > detail.refundableAmount) {
        setError('Refund amount exceeds available balance');
        return;
      }
    }
    try {
      await refundMutation.mutateAsync({
        paymentIntentId: detail.id,
        amountCents: isPartial ? refundAmountCents : undefined,
        reason: reason || 'No reason provided',
      });
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : String(err)) || 'Failed to process refund');
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/50 z-[10100] flex items-center justify-center p-4" onClick={onClose} role="button" tabIndex={0} aria-label="Close" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <div className="bg-white dark:bg-surface-dark rounded-xl w-full max-w-sm shadow-xl p-6" onClick={e => e.stopPropagation()}>
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <Icon name="check_circle" className="text-4xl text-green-600" />
            </div>
            <p className="text-lg font-semibold text-primary dark:text-white">Refund Processed!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[10100] flex items-center justify-center p-4" onClick={onClose} role="button" tabIndex={0} aria-label="Close" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="bg-white dark:bg-surface-dark rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-primary/10 dark:border-white/10">
          <h3 className="font-bold text-primary dark:text-white">Refund Payment</h3>
          <button onClick={onClose} className="tactile-btn p-2 rounded-full hover:bg-primary/10 dark:hover:bg-white/10" aria-label="Close">
            <Icon name="close" className="text-primary/60 dark:text-white/60" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-4 p-3 rounded-xl bg-white/50 dark:bg-white/5 border border-primary/10 dark:border-white/10">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={!isPartial} onChange={() => { setIsPartial(false); setAmount(''); }} className="w-4 h-4 accent-purple-500" />
              <span className="text-sm text-primary dark:text-white">Full Refund</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={isPartial} onChange={() => setIsPartial(true)} className="w-4 h-4 accent-purple-500" />
              <span className="text-sm text-primary dark:text-white">Partial</span>
            </label>
          </div>

          {isPartial && (
            <div>
              <label className="block text-sm font-medium text-primary dark:text-white mb-2">Refund Amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60 dark:text-white/60 font-medium">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  max={maxRefundDollars.toFixed(2)}
                  className="w-full pl-8 pr-4 py-3 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-lg font-semibold"
                />
              </div>
              <p className="text-xs text-primary/50 dark:text-white/50 mt-1">Maximum: ${maxRefundDollars.toFixed(2)}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-primary dark:text-white mb-2">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
            >
              <option value="">Select a reason...</option>
              {reasonOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 space-y-1.5">
            <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Impact Preview</p>
            <p className="text-sm text-primary dark:text-white">
              Refund <span className="font-semibold">{formatCurrency(isPartial && amount ? refundAmountCents : detail.refundableAmount)}</span> to {detail.paymentMethod}
            </p>
            {detail.bookingInfo && (
              <p className="text-sm text-primary/70 dark:text-white/70">
                Booking #{detail.bookingInfo.bookingId} fee status will change to {isPartial ? 'Partially Refunded' : 'Refunded'}
              </p>
            )}
            <p className="text-sm text-primary/70 dark:text-white/70">
              Member will receive a notification
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-full bg-white dark:bg-white/10 text-primary dark:text-white font-medium border border-primary/20 dark:border-white/20 hover:bg-primary/5 dark:hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRefund}
              disabled={refundMutation.isPending || (isPartial && (!amount || parseFloat(amount) <= 0))}
              className="flex-1 py-3 rounded-full bg-purple-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {refundMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  Processing...
                </>
              ) : (
                <>
                  <Icon name="undo" className="text-lg" />
                  Confirm Refund
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransactionDetailSheet({
  paymentIntentId,
  isOpen,
  onClose,
  onOpenBooking,
  onOpenMemberProfile,
  onRefundComplete,
}: TransactionDetailSheetProps) {
  const queryClient = useQueryClient();
  const { data: detail, isLoading, error } = useTransactionDetail(isOpen ? paymentIntentId : null);
  const [showRefund, setShowRefund] = useState(false);

  const canRefund = detail && (detail.status === 'succeeded' || detail.status === 'partially_refunded') && detail.refundableAmount > 0;

  const handleRefundSuccess = useCallback(() => {
    setShowRefund(false);
    if (paymentIntentId) {
      queryClient.invalidateQueries({ queryKey: financialsKeys.transactionDetail(paymentIntentId) });
    }
    queryClient.invalidateQueries({ queryKey: financialsKeys.refundablePayments() });
    queryClient.invalidateQueries({ queryKey: financialsKeys.refundedPayments() });
    queryClient.invalidateQueries({ queryKey: financialsKeys.dailySummary() });
    queryClient.invalidateQueries({ queryKey: financialsKeys.all });
    onRefundComplete?.();
  }, [queryClient, paymentIntentId, onRefundComplete]);

  const handleClose = useCallback(() => {
    setShowRefund(false);
    onClose();
  }, [onClose]);

  const stickyFooter = canRefund ? (
    <div className="p-4">
      <button
        type="button"
        onClick={() => setShowRefund(true)}
        className="tactile-btn w-full py-3 rounded-full bg-purple-500 text-white font-semibold flex items-center justify-center gap-2 hover:bg-purple-600 transition-colors"
      >
        <Icon name="undo" className="text-lg" />
        Refund
      </button>
    </div>
  ) : undefined;

  const statusInfo = detail ? (statusConfig[detail.status] || { label: detail.status, color: 'bg-gray-100 text-gray-700', icon: 'help' }) : null;

  return (
    <>
      <SlideUpDrawer
        isOpen={isOpen}
        onClose={handleClose}
        title="Transaction Details"
        maxHeight="full"
        stickyFooter={stickyFooter}
      >
        <div className="p-4 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <WalkingGolferSpinner size="sm" variant="auto" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center text-center py-8">
              <Icon name="error" className="text-4xl text-red-500 mb-2" />
              <p className="text-red-600 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load details'}</p>
            </div>
          ) : detail ? (
            <>
              <div className="text-center space-y-2">
                <p className="text-4xl font-bold text-primary dark:text-white">
                  {formatCurrency(detail.amount)}
                </p>
                {detail.totalRefunded > 0 && (
                  <p className="text-sm text-purple-600 dark:text-purple-400">
                    {formatCurrency(detail.totalRefunded)} refunded
                  </p>
                )}
                {statusInfo && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full ${statusInfo.color}`}>
                    <Icon name={statusInfo.icon} className="text-base" />
                    {statusInfo.label}
                  </span>
                )}
                <p className="text-sm text-primary/60 dark:text-white/60">
                  {formatDateTime(detail.createdAt)}
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider">Payment Info</h4>

                {detail.memberName && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-primary/60 dark:text-white/60">Member</span>
                    {onOpenMemberProfile && detail.memberEmail ? (
                      <button
                        type="button"
                        onClick={() => onOpenMemberProfile(detail.memberEmail!)}
                        className="text-sm font-medium text-right text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {detail.memberName}
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-primary dark:text-white text-right">{detail.memberName}</span>
                    )}
                  </div>
                )}

                {detail.memberEmail && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-primary/60 dark:text-white/60">Email</span>
                    {onOpenMemberProfile ? (
                      <button
                        type="button"
                        onClick={() => onOpenMemberProfile(detail.memberEmail!)}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline text-right truncate max-w-[200px]"
                      >
                        {detail.memberEmail}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(detail.memberEmail!); }}
                        className="text-sm text-primary dark:text-white text-right truncate max-w-[200px] hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        title="Click to copy email"
                      >
                        {detail.memberEmail}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary/60 dark:text-white/60">Payment Method</span>
                  <span className="text-sm font-medium text-primary dark:text-white text-right">{detail.paymentMethod}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-primary/60 dark:text-white/60">Source</span>
                  <span className="text-sm font-medium text-primary dark:text-white">{detail.chargeSource}</span>
                </div>

                {detail.description && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-primary/60 dark:text-white/60 flex-shrink-0">Description</span>
                    <span className="text-sm text-primary dark:text-white text-right">{detail.description}</span>
                  </div>
                )}
              </div>

              {detail.bookingInfo && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider">Linked Booking</h4>
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-primary dark:text-white">
                          {detail.bookingInfo.resourceName}
                        </p>
                        <p className="text-xs text-primary/60 dark:text-white/60">
                          {detail.bookingInfo.date} &bull; {detail.bookingInfo.startTime} – {detail.bookingInfo.endTime}
                        </p>
                      </div>
                      {onOpenBooking && (
                        <button
                          type="button"
                          onClick={() => onOpenBooking(detail.bookingInfo!.bookingId)}
                          className="tactile-btn px-3 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors"
                        >
                          View Booking
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {detail.refundHistory.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider">Refund History</h4>
                  <div className="space-y-2">
                    {detail.refundHistory.map(refund => (
                      <div key={refund.id} className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/15 border border-purple-200 dark:border-purple-800/30">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                            -{formatCurrency(refund.amount)}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            refund.status === 'succeeded' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          }`}>
                            {refund.status === 'succeeded' ? 'Completed' : refund.status}
                          </span>
                        </div>
                        <p className="text-xs text-primary/60 dark:text-white/60 mt-1">
                          {formatUnixDate(refund.createdAt)}
                          {refund.processedBy && ` · by ${refund.processedBy}`}
                        </p>
                        {refund.reason && (
                          <p className="text-xs text-primary/50 dark:text-white/50 mt-0.5">
                            Reason: {refund.reason.replace(/_/g, ' ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-primary/10 dark:border-white/10">
                {detail.receiptUrl && (
                  <a
                    href={detail.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 w-full p-3 rounded-xl bg-white/50 dark:bg-white/5 border border-primary/10 dark:border-white/10 hover:bg-primary/5 dark:hover:bg-white/10 transition-colors"
                  >
                    <Icon name="receipt" className="text-primary/60 dark:text-white/60" />
                    <span className="text-sm font-medium text-primary dark:text-white flex-1">View Receipt</span>
                    <Icon name="open_in_new" className="text-sm text-primary/40 dark:text-white/40" />
                  </a>
                )}

                <a
                  href={detail.stripeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 w-full p-3 rounded-xl bg-white/50 dark:bg-white/5 border border-primary/10 dark:border-white/10 hover:bg-primary/5 dark:hover:bg-white/10 transition-colors"
                >
                  <Icon name="open_in_new" className="text-primary/60 dark:text-white/60" />
                  <span className="text-sm font-medium text-primary dark:text-white flex-1">Open in Stripe</span>
                  <Icon name="arrow_forward" className="text-sm text-primary/40 dark:text-white/40" />
                </a>
              </div>
            </>
          ) : null}
        </div>
      </SlideUpDrawer>

      {showRefund && detail && (
        <RefundConfirmDialog
          detail={detail}
          onClose={() => setShowRefund(false)}
          onSuccess={handleRefundSuccess}
        />
      )}
    </>
  );
}
