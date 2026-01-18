import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { ModalShell } from '../ModalShell';

interface MemberBillingTabProps {
  memberEmail: string;
}

interface Subscription {
  id: string;
  status: string;
  planName?: string;
  planAmount?: number;
  currency?: string;
  interval?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  pauseCollection?: { behavior: string } | null;
  discount?: {
    id: string;
    coupon: {
      id: string;
      name?: string;
      percentOff?: number;
      amountOff?: number;
    };
  } | null;
}

interface PaymentMethod {
  id: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

interface Invoice {
  id: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  hostedInvoiceUrl?: string;
  invoicePdf?: string;
}

interface FamilyGroup {
  id: number;
  primaryEmail: string;
  primaryName?: string;
  groupName?: string;
  members?: {
    id: number;
    memberEmail: string;
    memberName: string;
    addOnPriceCents: number;
  }[];
}

interface BillingInfo {
  email: string;
  firstName?: string;
  lastName?: string;
  billingProvider: 'stripe' | 'mindbody' | 'family_addon' | 'comped' | null;
  stripeCustomerId?: string;
  mindbodyClientId?: string;
  tier?: string;
  subscriptions?: Subscription[];
  activeSubscription?: Subscription | null;
  paymentMethods?: PaymentMethod[];
  recentInvoices?: Invoice[];
  customerBalance?: number;
  familyGroup?: FamilyGroup | null;
  stripeError?: string;
  familyError?: string;
}

const BILLING_PROVIDERS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'mindbody', label: 'Mindbody' },
  { value: 'family_addon', label: 'Family Add-on' },
  { value: 'comped', label: 'Comped' },
];

function ApplyCreditModal({
  isOpen,
  onClose,
  onApply,
  isLoading,
  isDark,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (amountCents: number, description: string) => void;
  isLoading: boolean;
  isDark: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = () => {
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) return;
    onApply(amountCents, description || 'Staff applied credit');
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Apply Credit" size="sm">
      <div className="p-4 space-y-4">
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Credit Amount ($)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`w-full px-3 py-2 rounded-lg border text-sm ${
              isDark
                ? 'bg-black/30 border-white/20 text-white placeholder:text-gray-500'
                : 'bg-white border-gray-200 text-primary placeholder:text-gray-400'
            }`}
          />
        </div>
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Reason for credit"
            className={`w-full px-3 py-2 rounded-lg border text-sm ${
              isDark
                ? 'bg-black/30 border-white/20 text-white placeholder:text-gray-500'
                : 'bg-white border-gray-200 text-primary placeholder:text-gray-400'
            }`}
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !amount || parseFloat(amount) <= 0}
            className="flex-1 px-4 py-2.5 bg-primary dark:bg-accent text-white dark:text-primary rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isLoading ? 'Applying...' : 'Apply Credit'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ApplyDiscountModal({
  isOpen,
  onClose,
  onApply,
  isLoading,
  isDark,
}: {
  isOpen: boolean;
  onClose: () => void;
  onApply: (percentOff: number, duration: string) => void;
  isLoading: boolean;
  isDark: boolean;
}) {
  const [percentOff, setPercentOff] = useState('');
  const [duration, setDuration] = useState('once');

  const handleSubmit = () => {
    const percent = parseFloat(percentOff);
    if (isNaN(percent) || percent <= 0 || percent > 100) return;
    onApply(percent, duration);
  };

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Apply Discount" size="sm">
      <div className="p-4 space-y-4">
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Discount Percentage
          </label>
          <input
            type="number"
            min="1"
            max="100"
            value={percentOff}
            onChange={(e) => setPercentOff(e.target.value)}
            placeholder="10"
            className={`w-full px-3 py-2 rounded-lg border text-sm ${
              isDark
                ? 'bg-black/30 border-white/20 text-white placeholder:text-gray-500'
                : 'bg-white border-gray-200 text-primary placeholder:text-gray-400'
            }`}
          />
        </div>
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Duration
          </label>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border text-sm ${
              isDark
                ? 'bg-black/30 border-white/20 text-white'
                : 'bg-white border-gray-200 text-primary'
            }`}
          >
            <option value="once">Once (next invoice only)</option>
            <option value="forever">Forever</option>
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !percentOff || parseFloat(percentOff) <= 0}
            className="flex-1 px-4 py-2.5 bg-primary dark:bg-accent text-white dark:text-primary rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isLoading ? 'Applying...' : 'Apply Discount'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ConfirmCancelModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  isDark,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
  isDark: boolean;
}) {
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Cancel Subscription" size="sm">
      <div className="p-4 space-y-4">
        <div className={`p-4 rounded-lg ${isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-red-500 text-xl">warning</span>
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Are you sure you want to cancel this subscription?
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-red-400/80' : 'text-red-500'}`}>
                The subscription will remain active until the end of the current billing period.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Keep Subscription
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {isLoading ? 'Canceling...' : 'Cancel Subscription'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

const MemberBillingTab: React.FC<MemberBillingTabProps> = ({ memberEmail }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';

  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [isUpdatingSource, setIsUpdatingSource] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isApplyingCredit, setIsApplyingCredit] = useState(false);
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  const [isGettingPaymentLink, setIsGettingPaymentLink] = useState(false);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    console.log('[MemberBilling] Success:', message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const fetchBillingInfo = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setBillingInfo(data);
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to load billing info');
      }
    } catch (err) {
      setError('Failed to load billing info');
    } finally {
      setIsLoading(false);
    }
  }, [memberEmail]);

  useEffect(() => {
    fetchBillingInfo();
  }, [fetchBillingInfo]);

  const handleUpdateBillingSource = async (newSource: string) => {
    setIsUpdatingSource(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ billingProvider: newSource || null }),
      });
      if (res.ok) {
        await fetchBillingInfo();
        showSuccess('Billing source updated');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to update billing source');
      }
    } catch (err) {
      setError('Failed to update billing source');
    } finally {
      setIsUpdatingSource(false);
    }
  };

  const handlePauseSubscription = async () => {
    setIsPausing(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/pause`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await fetchBillingInfo();
        showSuccess('Subscription paused');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to pause subscription');
      }
    } catch (err) {
      setError('Failed to pause subscription');
    } finally {
      setIsPausing(false);
    }
  };

  const handleResumeSubscription = async () => {
    setIsResuming(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/resume`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await fetchBillingInfo();
        showSuccess('Subscription resumed');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to resume subscription');
      }
    } catch (err) {
      setError('Failed to resume subscription');
    } finally {
      setIsResuming(false);
    }
  };

  const handleCancelSubscription = async () => {
    setIsCanceling(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await fetchBillingInfo();
        setShowCancelModal(false);
        showSuccess('Subscription will be canceled at period end');
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to cancel subscription');
      }
    } catch (err) {
      setError('Failed to cancel subscription');
    } finally {
      setIsCanceling(false);
    }
  };

  const handleApplyCredit = async (amountCents: number, description: string) => {
    setIsApplyingCredit(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amountCents, description }),
      });
      if (res.ok) {
        await fetchBillingInfo();
        setShowCreditModal(false);
        showSuccess(`Credit of $${(amountCents / 100).toFixed(2)} applied`);
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to apply credit');
      }
    } catch (err) {
      setError('Failed to apply credit');
    } finally {
      setIsApplyingCredit(false);
    }
  };

  const handleApplyDiscount = async (percentOff: number, duration: string) => {
    setIsApplyingDiscount(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ percentOff, duration }),
      });
      if (res.ok) {
        await fetchBillingInfo();
        setShowDiscountModal(false);
        showSuccess(`${percentOff}% discount applied`);
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to apply discount');
      }
    } catch (err) {
      setError('Failed to apply discount');
    } finally {
      setIsApplyingDiscount(false);
    }
  };

  const handleGetPaymentLink = async () => {
    setIsGettingPaymentLink(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-billing/${encodeURIComponent(memberEmail)}/payment-link`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, '_blank');
        }
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to get payment link');
      }
    } catch (err) {
      setError('Failed to get payment link');
    } finally {
      setIsGettingPaymentLink(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return `$${(Math.abs(cents) / 100).toFixed(2)}`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700',
      paused: isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
      canceled: isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700',
      past_due: isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-700',
      trialing: isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700',
      paid: isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700',
      open: isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
      draft: isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-600',
      uncollectible: isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700',
    };
    return styles[status] || (isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-600');
  };

  const isPaused = billingInfo?.activeSubscription?.pauseCollection !== null && billingInfo?.activeSubscription?.pauseCollection !== undefined;

  if (isLoading) {
    return (
      <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Loading billing info...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className={`p-3 rounded-lg flex items-center gap-2 ${isDark ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
          <span className="material-symbols-outlined text-red-500 text-base">error</span>
          <p className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
          <button onClick={() => setError(null)} className="ml-auto p-1 hover:opacity-70">
            <span className="material-symbols-outlined text-red-500 text-base">close</span>
          </button>
        </div>
      )}

      {successMessage && (
        <div className={`p-3 rounded-lg flex items-center gap-2 ${isDark ? 'bg-green-500/10 border border-green-500/30' : 'bg-green-50 border border-green-200'}`}>
          <span className="material-symbols-outlined text-green-500 text-base">check_circle</span>
          <p className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>{successMessage}</p>
        </div>
      )}

      <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2 mb-4">
          <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>payments</span>
          <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Billing Source</h3>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={billingInfo?.billingProvider || ''}
            onChange={(e) => handleUpdateBillingSource(e.target.value)}
            disabled={isUpdatingSource}
            className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
              isDark
                ? 'bg-black/30 border-white/20 text-white'
                : 'bg-white border-gray-200 text-primary'
            } disabled:opacity-50`}
          >
            <option value="">None</option>
            {BILLING_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {isUpdatingSource && (
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
          )}
        </div>
      </div>

      {billingInfo?.billingProvider === 'stripe' && (
        <>
          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-4">
              <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>subscriptions</span>
              <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Subscription</h3>
            </div>

            {billingInfo.activeSubscription ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(isPaused ? 'paused' : billingInfo.activeSubscription.status)}`}>
                    {isPaused ? 'Paused' : billingInfo.activeSubscription.status.replace('_', ' ')}
                  </span>
                  {billingInfo.activeSubscription.cancelAtPeriodEnd && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-700'}`}>
                      Cancels at period end
                    </span>
                  )}
                </div>

                <div className={`grid grid-cols-2 gap-3 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {billingInfo.activeSubscription.planName && (
                    <div>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Plan</p>
                      <p className={isDark ? 'text-white' : 'text-primary'}>{billingInfo.activeSubscription.planName}</p>
                    </div>
                  )}
                  {billingInfo.activeSubscription.planAmount && (
                    <div>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Price</p>
                      <p className={isDark ? 'text-white' : 'text-primary'}>
                        {formatCurrency(billingInfo.activeSubscription.planAmount)}/{billingInfo.activeSubscription.interval || 'month'}
                      </p>
                    </div>
                  )}
                  {billingInfo.activeSubscription.currentPeriodStart && (
                    <div>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Current Period</p>
                      <p className={isDark ? 'text-white' : 'text-primary'}>
                        {formatDate(billingInfo.activeSubscription.currentPeriodStart)} - {formatDate(billingInfo.activeSubscription.currentPeriodEnd || 0)}
                      </p>
                    </div>
                  )}
                  {billingInfo.activeSubscription.currentPeriodEnd && !billingInfo.activeSubscription.cancelAtPeriodEnd && (
                    <div>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Next Payment</p>
                      <p className={isDark ? 'text-white' : 'text-primary'}>
                        {formatDate(billingInfo.activeSubscription.currentPeriodEnd)}
                      </p>
                    </div>
                  )}
                </div>

                {billingInfo.activeSubscription.discount && (
                  <div className={`p-2 rounded-lg ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-purple-500 text-base">sell</span>
                      <span className={`text-sm ${isDark ? 'text-purple-400' : 'text-purple-700'}`}>
                        {billingInfo.activeSubscription.discount.coupon.name || billingInfo.activeSubscription.discount.coupon.id}
                        {billingInfo.activeSubscription.discount.coupon.percentOff && ` (${billingInfo.activeSubscription.discount.coupon.percentOff}% off)`}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {isPaused ? (
                    <button
                      onClick={handleResumeSubscription}
                      disabled={isResuming}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      {isResuming ? (
                        <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-base">play_arrow</span>
                      )}
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseSubscription}
                      disabled={isPausing || billingInfo.activeSubscription.status !== 'active'}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                        isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {isPausing ? (
                        <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                      ) : (
                        <span className="material-symbols-outlined text-base">pause</span>
                      )}
                      Pause
                    </button>
                  )}
                  {!billingInfo.activeSubscription.cancelAtPeriodEnd && (
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">cancel</span>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={`p-4 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'} border ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
                    <span className={`material-symbols-outlined ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>block</span>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-primary'}`}>No Active Subscription</p>
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>This member doesn't have an active Stripe subscription</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-4">
              <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>credit_card</span>
              <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Payment Method</h3>
            </div>

            {billingInfo.paymentMethods && billingInfo.paymentMethods.length > 0 ? (
              <div className="space-y-3">
                {billingInfo.paymentMethods.map((pm) => (
                  <div key={pm.id} className={`p-3 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'} border ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`material-symbols-outlined ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>credit_card</span>
                        <div>
                          <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-primary'}`}>
                            {pm.brand?.toUpperCase()} •••• {pm.last4}
                          </p>
                          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Expires {pm.expMonth}/{pm.expYear}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={handleGetPaymentLink}
                  disabled={isGettingPaymentLink}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  } disabled:opacity-50`}
                >
                  {isGettingPaymentLink ? (
                    <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-base">open_in_new</span>
                  )}
                  Update Payment Method
                </button>
              </div>
            ) : (
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No payment methods on file</p>
            )}
          </div>

          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>account_balance_wallet</span>
                <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Account Balance</h3>
              </div>
              <button
                onClick={() => setShowCreditModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary dark:bg-accent text-white dark:text-primary rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Apply Credit
              </button>
            </div>
            <div className={`p-3 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'} border ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Current Balance</span>
                <span className={`text-lg font-semibold ${
                  (billingInfo.customerBalance || 0) < 0
                    ? isDark ? 'text-green-400' : 'text-green-600'
                    : isDark ? 'text-white' : 'text-primary'
                }`}>
                  {(billingInfo.customerBalance || 0) < 0 && '+'}
                  {formatCurrency(billingInfo.customerBalance || 0)}
                  {(billingInfo.customerBalance || 0) < 0 && ' credit'}
                </span>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>sell</span>
                <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Discounts</h3>
              </div>
              <button
                onClick={() => setShowDiscountModal(true)}
                disabled={!billingInfo.activeSubscription}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary dark:bg-accent text-white dark:text-primary rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Apply Discount
              </button>
            </div>
            {billingInfo.activeSubscription?.discount ? (
              <div className={`p-3 rounded-lg ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-500 text-base">check_circle</span>
                  <span className={`text-sm ${isDark ? 'text-purple-400' : 'text-purple-700'}`}>
                    Active: {billingInfo.activeSubscription.discount.coupon.name || billingInfo.activeSubscription.discount.coupon.id}
                    {billingInfo.activeSubscription.discount.coupon.percentOff && ` (${billingInfo.activeSubscription.discount.coupon.percentOff}% off)`}
                  </span>
                </div>
              </div>
            ) : (
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No active discounts</p>
            )}
          </div>

          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-4">
              <span className={`material-symbols-outlined ${isDark ? 'text-accent' : 'text-primary'}`}>receipt_long</span>
              <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Invoice History</h3>
            </div>
            {billingInfo.recentInvoices && billingInfo.recentInvoices.length > 0 ? (
              <div className="space-y-2">
                {billingInfo.recentInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className={`p-3 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'} border ${isDark ? 'border-white/10' : 'border-gray-100'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(inv.status)}`}>
                          {inv.status}
                        </span>
                        <span className={`text-sm ${isDark ? 'text-white' : 'text-primary'}`}>
                          {formatCurrency(inv.amountDue)}
                        </span>
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {formatDate(inv.created)}
                        </span>
                      </div>
                      {inv.hostedInvoiceUrl && (
                        <a
                          href={inv.hostedInvoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1 text-xs font-medium ${isDark ? 'text-accent hover:text-accent/80' : 'text-primary hover:text-primary/80'}`}
                        >
                          View
                          <span className="material-symbols-outlined text-base">open_in_new</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>No invoices found</p>
            )}
          </div>
        </>
      )}

      {billingInfo?.billingProvider === 'mindbody' && (
        <div className={`p-4 rounded-xl ${isDark ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-blue-50 border border-blue-200'}`}>
          <div className="flex items-start gap-3">
            <span className={`material-symbols-outlined ${isDark ? 'text-blue-400' : 'text-blue-600'} text-xl`}>info</span>
            <div className="flex-1">
              <p className={`text-sm font-medium ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                This member is billed through Mindbody
              </p>
              {billingInfo.mindbodyClientId && (
                <p className={`text-xs mt-1 ${isDark ? 'text-blue-400/80' : 'text-blue-600'}`}>
                  Mindbody Client ID: {billingInfo.mindbodyClientId}
                </p>
              )}
              <p className={`text-xs mt-2 ${isDark ? 'text-blue-400/80' : 'text-blue-600'}`}>
                To make billing changes, please use the Mindbody system.
              </p>
              <a
                href="https://clients.mindbodyonline.com"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isDark ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                }`}
              >
                <span className="material-symbols-outlined text-base">open_in_new</span>
                Open Mindbody
              </a>
            </div>
          </div>
        </div>
      )}

      {billingInfo?.billingProvider === 'family_addon' && (
        <div className={`p-4 rounded-xl ${isDark ? 'bg-purple-500/10 border border-purple-500/30' : 'bg-purple-50 border border-purple-200'}`}>
          <div className="flex items-start gap-3">
            <span className={`material-symbols-outlined ${isDark ? 'text-purple-400' : 'text-purple-600'} text-xl`}>family_restroom</span>
            <div className="flex-1">
              <p className={`text-sm font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
                Billed as family add-on
              </p>
              {billingInfo.familyGroup && (
                <div className={`mt-3 p-3 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'}`}>
                  <div className="space-y-2">
                    <div>
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Primary Payer</p>
                      <p className={`text-sm ${isDark ? 'text-white' : 'text-primary'}`}>
                        {billingInfo.familyGroup.primaryName || billingInfo.familyGroup.primaryEmail}
                      </p>
                      <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {billingInfo.familyGroup.primaryEmail}
                      </p>
                    </div>
                    {billingInfo.familyGroup.members && (
                      <div>
                        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Add-on Price</p>
                        <p className={`text-sm ${isDark ? 'text-white' : 'text-primary'}`}>
                          {formatCurrency(
                            billingInfo.familyGroup.members.find(
                              (m) => m.memberEmail.toLowerCase() === memberEmail.toLowerCase()
                            )?.addOnPriceCents || 0
                          )}/month
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <p className={`text-xs mt-3 ${isDark ? 'text-purple-400/80' : 'text-purple-600'}`}>
                To make billing changes, check the primary payer's profile.
              </p>
            </div>
          </div>
        </div>
      )}

      {billingInfo?.billingProvider === 'comped' && (
        <div className={`p-4 rounded-xl ${isDark ? 'bg-green-500/10 border border-green-500/30' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex items-start gap-3">
            <span className={`material-symbols-outlined ${isDark ? 'text-green-400' : 'text-green-600'} text-xl`}>card_giftcard</span>
            <div className="flex-1">
              <p className={`text-sm font-medium ${isDark ? 'text-green-300' : 'text-green-700'}`}>
                Complimentary membership - no billing
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-green-400/80' : 'text-green-600'}`}>
                This member has a comped membership and is not charged.
              </p>
              <div className={`mt-3 p-3 rounded-lg ${isDark ? 'bg-black/20' : 'bg-white'} border ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                <div className="flex items-start gap-2">
                  <span className={`material-symbols-outlined text-base ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>info</span>
                  <div>
                    <p className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      To convert to a paid plan:
                    </p>
                    <ol className={`text-xs mt-1 list-decimal list-inside ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      <li>Member must sign up through the membership page</li>
                      <li>Complete payment via Stripe checkout</li>
                      <li>Then change billing source above to "Stripe"</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!billingInfo?.billingProvider && (
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
              <span className={`material-symbols-outlined ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>help_outline</span>
            </div>
            <div>
              <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-primary'}`}>No Billing Source Set</p>
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Select a billing source above to manage this member's billing.
              </p>
            </div>
          </div>
        </div>
      )}

      <ApplyCreditModal
        isOpen={showCreditModal}
        onClose={() => setShowCreditModal(false)}
        onApply={handleApplyCredit}
        isLoading={isApplyingCredit}
        isDark={isDark}
      />

      <ApplyDiscountModal
        isOpen={showDiscountModal}
        onClose={() => setShowDiscountModal(false)}
        onApply={handleApplyDiscount}
        isLoading={isApplyingDiscount}
        isDark={isDark}
      />

      <ConfirmCancelModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelSubscription}
        isLoading={isCanceling}
        isDark={isDark}
      />
    </div>
  );
};

export default MemberBillingTab;
