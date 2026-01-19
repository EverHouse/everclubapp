import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import Logo from '../components/Logo';

let stripePromise: Promise<Stripe | null> | null = null;

async function getStripePromise(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  
  try {
    const res = await fetch('/api/stripe/config', { credentials: 'include' });
    if (!res.ok) return null;
    const { publishableKey } = await res.json();
    if (!publishableKey) return null;
    stripePromise = loadStripe(publishableKey);
    return stripePromise;
  } catch {
    return null;
  }
}

function CheckoutForm({ tier, email }: { tier: string; email?: string }) {
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const stripe = await getStripePromise();
        if (!stripe) {
          throw new Error('Stripe is not configured');
        }
        setStripeInstance(stripe);

        const res = await fetch('/api/checkout/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tier, email }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create checkout session');
        }

        const data = await res.json();
        setClientSecret(data.clientSecret);
      } catch (err: any) {
        setError(err.message || 'Failed to initialize checkout');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [tier, email]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-3 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <span className="material-symbols-outlined text-6xl text-red-500 mb-4 block">error</span>
        <p className="text-red-600 dark:text-red-400 text-lg mb-4">{error}</p>
        <a
          href="/#/membership"
          className="inline-block py-3 px-6 rounded-xl font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Back to Membership
        </a>
      </div>
    );
  }

  if (!clientSecret || !stripeInstance) {
    return null;
  }

  return (
    <EmbeddedCheckoutProvider
      stripe={stripeInstance}
      options={{ clientSecret }}
    >
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [customerEmail, setCustomerEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      return;
    }

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/checkout/session/${sessionId}`);
        if (!res.ok) throw new Error('Failed to fetch session');
        
        const data = await res.json();
        setCustomerEmail(data.customerEmail);
        setStatus(data.status === 'complete' ? 'success' : 'error');
      } catch {
        setStatus('error');
      }
    };

    fetchSession();
  }, [sessionId]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-3 border-primary border-t-transparent" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="text-center py-16">
        <span className="material-symbols-outlined text-6xl text-red-500 mb-4 block">error</span>
        <h2 className="text-2xl font-bold text-primary dark:text-white mb-2">Something went wrong</h2>
        <p className="text-primary/70 dark:text-white/70 mb-6">We couldn't verify your payment. Please contact support.</p>
        <a
          href="/#/contact"
          className="inline-block py-3 px-6 rounded-xl font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Contact Support
        </a>
      </div>
    );
  }

  return (
    <div className="text-center py-16">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
        <span className="material-symbols-outlined text-5xl text-emerald-600 dark:text-emerald-400">check_circle</span>
      </div>
      <h2 className="text-3xl font-bold text-primary dark:text-white mb-2">Welcome to EverHouse!</h2>
      <p className="text-primary/70 dark:text-white/70 text-lg mb-2">Your membership is now active.</p>
      {customerEmail && (
        <p className="text-primary/60 dark:text-white/60 mb-8">A confirmation has been sent to {customerEmail}</p>
      )}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <a
          href="/#/login"
          className="inline-flex items-center justify-center gap-2 py-3 px-8 rounded-xl font-semibold bg-accent text-brand-green hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined">login</span>
          Sign In to Your Account
        </a>
      </div>
    </div>
  );
}

export default function Checkout() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isSuccess = location.pathname.includes('/success');
  
  const tier = searchParams.get('tier');
  const email = searchParams.get('email') || undefined;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f5f7f0] to-[#eef1e6] dark:from-[#0f120a] dark:to-[#1a1d12]">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-[#0f120a]/80 backdrop-blur-xl border-b border-primary/10 dark:border-white/5">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/#/" className="flex items-center gap-3">
            <Logo size={36} />
            <span className="font-serif text-xl text-primary dark:text-white">EverHouse</span>
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {isSuccess ? (
          <CheckoutSuccess />
        ) : tier ? (
          <div className="glass-card rounded-2xl p-6 md:p-8">
            <h1 className="text-2xl font-bold text-primary dark:text-white mb-6 text-center">Complete Your Membership</h1>
            <CheckoutForm tier={tier} email={email} />
          </div>
        ) : (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-6xl text-amber-500 mb-4 block">warning</span>
            <h2 className="text-2xl font-bold text-primary dark:text-white mb-2">No Membership Selected</h2>
            <p className="text-primary/70 dark:text-white/70 mb-6">Please select a membership tier to continue.</p>
            <a
              href="/#/membership"
              className="inline-block py-3 px-6 rounded-xl font-medium bg-accent text-brand-green hover:opacity-90 transition-opacity"
            >
              View Membership Options
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
