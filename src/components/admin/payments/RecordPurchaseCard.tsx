import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { SimpleCheckoutForm } from '../../stripe/StripePaymentForm';
import { getStripeAppearance } from '../../stripe/stripeAppearance';
import { MemberSearchInput, SelectedMember } from '../../shared/MemberSearchInput';
import { SlideUpDrawer } from '../../SlideUpDrawer';
import { TerminalPayment } from '../../staff-command-center/TerminalPayment';
import AnimatedCheckmark from '../../AnimatedCheckmark';
import { useTheme } from '../../../contexts/ThemeContext';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY || '');

export interface SectionProps {
  onClose?: () => void;
  variant?: 'modal' | 'card';
}

interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  icon: string;
}

type PaymentMethodType = 'online_card' | 'terminal' | 'cash_check';

const PRODUCTS = [
  { productId: 'prod_TvPiZ9a7L3BqZX', name: 'Day Pass - Coworking', priceCents: 3500, icon: 'workspace_premium' },
  { productId: 'prod_TvPiHiafkZcoKR', name: 'Day Pass - Golf Sim', priceCents: 5000, icon: 'sports_golf' },
  { productId: 'prod_TvPiDx3od1F7xY', name: 'Guest Pass', priceCents: 2500, icon: 'badge' },
];

const CATEGORY_OPTIONS = [
  { value: 'guest_fee', label: 'Guest Fee' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'membership', label: 'Membership' },
  { value: 'other', label: 'Other' },
];

const CASH_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash', icon: 'payments' },
  { value: 'check', label: 'Check', icon: 'money' },
  { value: 'other', label: 'Other', icon: 'more_horiz' },
];

const RecordPurchaseCard: React.FC<SectionProps> = ({ onClose, variant = 'modal' }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [description, setDescription] = useState('');
  const [selectedMember, setSelectedMember] = useState<SelectedMember | null>(null);
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [newCustomerFirstName, setNewCustomerFirstName] = useState('');
  const [newCustomerLastName, setNewCustomerLastName] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [cashSubType, setCashSubType] = useState<'cash' | 'check' | 'other'>('cash');
  const [category, setCategory] = useState('guest_fee');
  const [notes, setNotes] = useState('');

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [receiptSent, setReceiptSent] = useState(false);
  const [receiptSending, setReceiptSending] = useState(false);

  const totalCents = cartItems.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const totalFormatted = `$${(totalCents / 100).toFixed(2)}`;

  const addToCart = (product: typeof PRODUCTS[number]) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.productId === product.productId);
      if (existing) {
        return prev.map(item =>
          item.productId === product.productId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCartItems(prev =>
      prev
        .map(item => {
          if (item.productId === productId) {
            const newQty = item.quantity + delta;
            return newQty <= 0 ? null : { ...item, quantity: newQty };
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => setCartItems([]);

  const getCustomerInfo = () => {
    if (useNewCustomer) {
      return {
        email: newCustomerEmail,
        name: `${newCustomerFirstName} ${newCustomerLastName}`.trim(),
        firstName: newCustomerFirstName,
        lastName: newCustomerLastName,
        phone: newCustomerPhone || undefined,
        isNewCustomer: true as const,
        id: null as string | null,
      };
    }
    return selectedMember
      ? {
          email: selectedMember.email,
          name: selectedMember.name,
          isNewCustomer: false as const,
          id: selectedMember.id as string | null,
        }
      : null;
  };

  const isCustomerValid = () => {
    if (useNewCustomer) {
      return !!(newCustomerFirstName.trim() && newCustomerLastName.trim() && newCustomerEmail.trim());
    }
    return !!selectedMember;
  };

  const canReview = cartItems.length > 0 && isCustomerValid();

  const buildDescription = () => {
    if (description) return description;
    return cartItems.map(item => (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name)).join(', ');
  };

  const handleSelectPaymentMethod = async (method: PaymentMethodType) => {
    setSelectedPaymentMethod(method);
    setError(null);

    if (method === 'online_card' && !clientSecret) {
      await createPaymentIntent();
    }
  };

  const createPaymentIntent = async () => {
    const customer = getCustomerInfo();
    if (!customer || totalCents <= 0) return;

    setIsCreatingIntent(true);
    setError(null);

    try {
      const payload: Record<string, any> = {
        memberEmail: customer.email,
        memberName: customer.name,
        amountCents: totalCents,
        description: buildDescription(),
      };

      if (cartItems.length === 1) {
        payload.productId = cartItems[0].productId;
      }

      if (customer.isNewCustomer) {
        payload.isNewCustomer = true;
        payload.firstName = (customer as any).firstName;
        payload.lastName = (customer as any).lastName;
        if ((customer as any).phone) {
          payload.phone = (customer as any).phone;
        }
      }

      const res = await fetch('/api/stripe/staff/quick-charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create payment');
      }

      const data = await res.json();
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
    } catch (err: any) {
      setError(err.message || 'Failed to create payment');
    } finally {
      setIsCreatingIntent(false);
    }
  };

  const handleCardPaymentSuccess = async (piId?: string) => {
    const intentId = piId || paymentIntentId;
    if (!intentId) return;

    try {
      await fetch('/api/stripe/staff/quick-charge/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paymentIntentId: intentId }),
      });
    } catch {}

    setPaymentIntentId(intentId);
    setSuccess(true);
  };

  const handleTerminalSuccess = (piId: string) => {
    setPaymentIntentId(piId);
    setSuccess(true);
  };

  const handleRecordCashPayment = async () => {
    const customer = getCustomerInfo();
    if (!customer || totalCents <= 0) return;

    setIsProcessing(true);
    setError(null);

    try {
      const res = await fetch('/api/payments/record-offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          memberEmail: customer.email,
          memberId: customer.id,
          memberName: customer.name,
          amountCents: totalCents,
          paymentMethod: cashSubType,
          category,
          description: buildDescription(),
          notes: notes || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to record payment');
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendReceipt = async () => {
    const customer = getCustomerInfo();
    if (!customer) return;

    setReceiptSending(true);
    try {
      const effectivePaymentMethod =
        selectedPaymentMethod === 'cash_check'
          ? cashSubType
          : selectedPaymentMethod === 'terminal'
            ? 'terminal'
            : 'card';

      const res = await fetch('/api/purchases/send-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: customer.email,
          memberName: customer.name,
          items: cartItems.map(item => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.priceCents,
            total: item.priceCents * item.quantity,
          })),
          totalAmount: totalCents,
          paymentMethod: effectivePaymentMethod,
          paymentIntentId: paymentIntentId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send receipt');
      }

      setReceiptSent(true);
    } catch {
      setError('Failed to send receipt');
    } finally {
      setReceiptSending(false);
    }
  };

  const resetForm = () => {
    setCartItems([]);
    setDescription('');
    setSelectedMember(null);
    setUseNewCustomer(false);
    setNewCustomerFirstName('');
    setNewCustomerLastName('');
    setNewCustomerEmail('');
    setNewCustomerPhone('');
    setDrawerOpen(false);
    setSelectedPaymentMethod(null);
    setCashSubType('cash');
    setCategory('guest_fee');
    setNotes('');
    setClientSecret(null);
    setPaymentIntentId(null);
    setIsCreatingIntent(false);
    setIsProcessing(false);
    setError(null);
    setSuccess(false);
    setReceiptSent(false);
    setReceiptSending(false);
  };

  const renderDrawerContent = () => {
    if (success) {
      return (
        <div className="flex flex-col items-center justify-center py-8 gap-4 px-5">
          <AnimatedCheckmark size={64} color={isDark ? '#4ade80' : '#16a34a'} />
          <p className="text-xl font-bold text-primary dark:text-white">
            Payment of {totalFormatted} successful!
          </p>
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl text-red-700 dark:text-red-300 text-sm w-full max-w-xs">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-3 w-full max-w-xs mt-4">
            <button
              onClick={handleSendReceipt}
              disabled={receiptSent || receiptSending}
              className={`w-full py-3 px-6 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors ${
                receiptSent
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-white/60 dark:bg-white/5 border border-primary/20 dark:border-white/20 text-primary dark:text-white hover:bg-white/80 dark:hover:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-lg">
                {receiptSent ? 'check' : 'email'}
              </span>
              {receiptSending ? 'Sending...' : receiptSent ? 'Receipt Sent' : 'Email Receipt'}
            </button>
            <button
              onClick={resetForm}
              className="w-full py-3 px-6 rounded-xl font-semibold bg-primary dark:bg-lavender text-white transition-colors hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5 px-5 pb-5">
        <div>
          <h4 className="text-sm font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider mb-3">
            Order Summary
          </h4>
          <div className={`rounded-xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-primary/10'}`}>
            {cartItems.map((item, idx) => (
              <div
                key={item.productId}
                className={`flex items-center justify-between px-4 py-3 ${
                  idx < cartItems.length - 1 ? `border-b ${isDark ? 'border-white/10' : 'border-primary/10'}` : ''
                }`}
              >
                <div className="flex-1">
                  <span className="text-sm font-medium text-primary dark:text-white">{item.name}</span>
                  <span className="text-sm text-primary/60 dark:text-white/60 ml-2">
                    {item.quantity} × ${(item.priceCents / 100).toFixed(2)}
                  </span>
                </div>
                <span className="text-sm font-semibold text-primary dark:text-white">
                  ${((item.priceCents * item.quantity) / 100).toFixed(2)}
                </span>
              </div>
            ))}
            <div
              className={`flex items-center justify-between px-4 py-3 border-t ${
                isDark ? 'border-white/10 bg-white/5' : 'border-primary/10 bg-primary/5'
              }`}
            >
              <span className="text-base font-bold text-primary dark:text-white">Total</span>
              <span className="text-lg font-bold text-primary dark:text-white">{totalFormatted}</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider mb-2">
            Customer
          </h4>
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${isDark ? 'bg-white/5' : 'bg-primary/5'}`}>
            <span className="material-symbols-outlined text-primary/60 dark:text-white/60">person</span>
            <div>
              <p className="text-sm font-medium text-primary dark:text-white">{getCustomerInfo()?.name}</p>
              <p className="text-xs text-primary/60 dark:text-white/60">{getCustomerInfo()?.email}</p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-primary/60 dark:text-white/60 uppercase tracking-wider mb-3">
            Payment Method
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'online_card' as const, label: 'Online Card', icon: 'credit_card' },
              { key: 'terminal' as const, label: 'Card Reader', icon: 'contactless' },
              { key: 'cash_check' as const, label: 'Cash/Check', icon: 'payments' },
            ] as const).map(method => (
              <button
                key={method.key}
                onClick={() => handleSelectPaymentMethod(method.key)}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-sm font-medium transition-colors ${
                  selectedPaymentMethod === method.key
                    ? 'bg-primary dark:bg-lavender text-white shadow-sm'
                    : 'bg-white/60 dark:bg-white/5 text-primary dark:text-white border border-primary/10 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/10'
                }`}
              >
                <span className="material-symbols-outlined text-xl">{method.icon}</span>
                {method.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {selectedPaymentMethod === 'online_card' && (
          <div>
            {isCreatingIntent ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary dark:border-lavender border-t-transparent" />
              </div>
            ) : clientSecret ? (
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: getStripeAppearance(isDark),
                }}
              >
                <SimpleCheckoutForm
                  onSuccess={handleCardPaymentSuccess}
                  onError={(msg) => setError(msg)}
                  submitLabel={`Pay ${totalFormatted}`}
                />
              </Elements>
            ) : null}
          </div>
        )}

        {selectedPaymentMethod === 'terminal' && (
          <TerminalPayment
            amount={totalCents}
            userId={getCustomerInfo()?.id || null}
            description={buildDescription()}
            paymentMetadata={{
              source: 'pos',
              items: cartItems.map(i => `${i.name} x${i.quantity}`).join(', '),
            }}
            onSuccess={handleTerminalSuccess}
            onError={(msg) => setError(msg)}
            onCancel={() => setSelectedPaymentMethod(null)}
          />
        )}

        {selectedPaymentMethod === 'cash_check' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-primary dark:text-white mb-2">Type</label>
              <div className="flex gap-2">
                {CASH_METHOD_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setCashSubType(opt.value as typeof cashSubType)}
                    className={`flex-1 py-2.5 px-3 rounded-xl font-medium text-sm flex items-center justify-center gap-1.5 transition-colors ${
                      cashSubType === opt.value
                        ? 'bg-primary dark:bg-lavender text-white'
                        : 'bg-white/60 dark:bg-white/5 text-primary dark:text-white border border-primary/10 dark:border-white/10'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-primary dark:text-white mb-2">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-primary dark:text-white mb-2">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                className="w-full px-4 py-3 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <button
              onClick={handleRecordCashPayment}
              disabled={isProcessing}
              className="w-full py-4 rounded-xl font-semibold bg-primary dark:bg-lavender text-white transition-all flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Recording...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">payments</span>
                  Record Payment
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  };

  const content = (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {PRODUCTS.map(product => (
          <button
            key={product.productId}
            onClick={() => addToCart(product)}
            className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-white/5 border border-primary/10 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/10 transition-colors text-center active:scale-95"
          >
            <span className="material-symbols-outlined text-2xl text-primary dark:text-white">{product.icon}</span>
            <span className="text-xs font-medium text-primary dark:text-white leading-tight">{product.name}</span>
            <span className="text-sm font-bold text-primary dark:text-white">
              ${(product.priceCents / 100).toFixed(2)}
            </span>
          </button>
        ))}
      </div>

      {cartItems.length > 0 && (
        <div
          className={`rounded-xl border ${isDark ? 'border-white/10 bg-white/5' : 'border-primary/10 bg-white/60'} p-3 space-y-2`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-primary dark:text-white">Cart</span>
            <button
              onClick={clearCart}
              className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              Clear Cart
            </button>
          </div>
          {cartItems.map(item => (
            <div key={item.productId} className="flex items-center justify-between gap-2">
              <span className="text-sm text-primary dark:text-white flex-1 truncate">{item.name}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => updateQuantity(item.productId, -1)}
                  className="w-7 h-7 rounded-lg bg-primary/10 dark:bg-white/10 text-primary dark:text-white flex items-center justify-center hover:bg-primary/20 dark:hover:bg-white/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">remove</span>
                </button>
                <span className="w-6 text-center text-sm font-semibold text-primary dark:text-white">
                  {item.quantity}
                </span>
                <button
                  onClick={() => updateQuantity(item.productId, 1)}
                  className="w-7 h-7 rounded-lg bg-primary/10 dark:bg-white/10 text-primary dark:text-white flex items-center justify-center hover:bg-primary/20 dark:hover:bg-white/20 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                </button>
              </div>
              <span className="text-sm text-primary/60 dark:text-white/60 w-14 text-right">
                ${(item.priceCents / 100).toFixed(2)}
              </span>
              <span className="text-sm font-semibold text-primary dark:text-white w-16 text-right">
                ${((item.priceCents * item.quantity) / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {cartItems.length > 0 && (
        <div className="text-center">
          <p className="text-3xl font-bold text-primary dark:text-white">{totalFormatted}</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-primary dark:text-white mb-1.5">
          Description (optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a note..."
          className="w-full px-4 py-3 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {!useNewCustomer ? (
        <>
          <MemberSearchInput
            label="Customer"
            placeholder="Search by name or email..."
            selectedMember={selectedMember}
            onSelect={(member) => setSelectedMember(member)}
            onClear={() => setSelectedMember(null)}
            includeVisitors={true}
            includeFormer={true}
          />
          <button
            type="button"
            onClick={() => {
              setUseNewCustomer(true);
              setSelectedMember(null);
            }}
            className="text-sm text-primary/60 dark:text-white/60 hover:text-primary dark:hover:text-white flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-base">person_add</span>
            Charge someone not in the system
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-primary dark:text-white">New Customer</span>
            <button
              type="button"
              onClick={() => {
                setUseNewCustomer(false);
                setNewCustomerFirstName('');
                setNewCustomerLastName('');
                setNewCustomerEmail('');
                setNewCustomerPhone('');
              }}
              className="text-sm text-primary/60 dark:text-white/60 hover:text-primary dark:hover:text-white flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-base">search</span>
              Search existing member
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-primary/60 dark:text-white/60 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newCustomerFirstName}
                onChange={(e) => setNewCustomerFirstName(e.target.value)}
                placeholder="John"
                className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-primary/60 dark:text-white/60 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newCustomerLastName}
                onChange={(e) => setNewCustomerLastName(e.target.value)}
                placeholder="Doe"
                className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-primary/60 dark:text-white/60 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={newCustomerEmail}
              onChange={(e) => setNewCustomerEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-primary/60 dark:text-white/60 mb-1">
              Phone (optional)
            </label>
            <input
              type="tel"
              value={newCustomerPhone}
              onChange={(e) => setNewCustomerPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/40 dark:placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
            />
          </div>
        </div>
      )}

      <button
        onClick={() => setDrawerOpen(true)}
        disabled={!canReview}
        className="w-full py-4 rounded-xl font-semibold bg-primary dark:bg-lavender text-white transition-all flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined">shopping_cart_checkout</span>
        Review & Charge
      </button>

      <SlideUpDrawer
        isOpen={drawerOpen}
        onClose={() => {
          if (!success) {
            setDrawerOpen(false);
            setSelectedPaymentMethod(null);
            setClientSecret(null);
            setPaymentIntentId(null);
            setError(null);
          }
        }}
        title="Review & Charge"
        maxHeight="large"
        dismissible={!success && !isProcessing && !isCreatingIntent}
      >
        {renderDrawerContent()}
      </SlideUpDrawer>
    </div>
  );

  if (variant === 'card') {
    return (
      <div className="bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-primary dark:text-accent">point_of_sale</span>
          <h3 className="font-bold text-primary dark:text-white">Point of Sale</h3>
        </div>
        {content}
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary dark:text-accent">point_of_sale</span>
          <h3 className="font-bold text-primary dark:text-white">Point of Sale</h3>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-2 hover:bg-primary/10 dark:hover:bg-white/10 rounded-full">
            <span className="material-symbols-outlined text-primary/60 dark:text-white/60">close</span>
          </button>
        )}
      </div>
      {content}
    </div>
  );
};

export default RecordPurchaseCard;
