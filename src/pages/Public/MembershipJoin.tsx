import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Footer } from '../../components/Footer';
import { usePageReady } from '../../stores/pageReadyStore';
import SEO from '../../components/SEO';
import WalkingGolferSpinner from '../../components/WalkingGolferSpinner';
import Icon from '../../components/icons/Icon';

interface JoinTier {
  id: number;
  name: string;
  slug: string;
  priceString: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  isPopular: boolean;
  highlightedFeatures: string[];
  priceCents: number | null;
  billingInterval: string | null;
}

const MembershipJoin: React.FC = () => {
  const { setPageReady } = usePageReady();
  const [searchParams] = useSearchParams();
  const promoFromUrl = searchParams.get('promo') || '';

  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [promoCode, setPromoCode] = useState(promoFromUrl);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: tiers, isLoading } = useQuery<JoinTier[]>({
    queryKey: ['public', 'join-tiers'],
    queryFn: async () => {
      const res = await fetch('/api/public/membership-tiers');
      if (!res.ok) throw new Error('Failed to load tiers');
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
  });

  const sortedTiers = useMemo(() => {
    if (!tiers) return [];
    return [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [tiers]);

  useEffect(() => {
    if (!isLoading) setPageReady(true);
  }, [isLoading, setPageReady]);

  const extractPrice = (priceString: string) => {
    const match = priceString.match(/\$[\d,]+/);
    return match ? match[0] : priceString;
  };

  const extractSuffix = (priceString: string) => {
    const match = priceString.match(/\/\w+/);
    return match ? match[0] : '/mo';
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = 'First name is required';
    if (!lastName.trim()) errors.lastName = 'Last name is required';
    if (!email.trim()) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address';
    if (!selectedTier) errors.tier = 'Please select a membership tier';
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/membership-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          tierSlug: selectedTier,
          promoCode: promoCode.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setError('Could not redirect to checkout. Please try again.');
        setSubmitting(false);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bone dark:bg-[#141414] flex items-center justify-center">
        <WalkingGolferSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone dark:bg-[#141414] overflow-x-hidden animate-page-enter">
      <SEO
        title="Join Ever Club"
        description="Join Ever Club — select your membership tier and complete checkout."
        url="/join"
      />

      <div className="px-4 pt-8 pb-12 max-w-3xl mx-auto lg:px-8">
        <div className="text-center mb-10 animate-content-enter">
          <h1
            className="text-3xl sm:text-4xl md:text-5xl text-primary dark:text-white mb-3 leading-none"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Join Ever Club
          </h1>
          <p className="text-base text-primary/70 dark:text-white/70 leading-relaxed max-w-md mx-auto" style={{ fontFamily: 'var(--font-body)' }}>
            Select your membership, enter your details, and complete checkout.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="animate-content-enter-delay-1">
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-4">Choose Your Tier</h2>
            {fieldErrors.tier && (
              <p className="text-sm text-red-500 dark:text-red-400 mb-3 flex items-center gap-1">
                <Icon name="error" className="text-sm" />
                {fieldErrors.tier}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sortedTiers.map((tier) => {
                const isSelected = selectedTier === tier.slug;
                return (
                  <button
                    type="button"
                    key={tier.id}
                    onClick={() => {
                      setSelectedTier(tier.slug);
                      if (fieldErrors.tier) setFieldErrors(prev => ({ ...prev, tier: '' }));
                    }}
                    className={`relative flex flex-col p-5 rounded-xl border-2 transition-colors duration-200 text-left ${
                      isSelected
                        ? tier.isPopular
                          ? 'border-primary bg-primary/90 text-white shadow-lg scale-[1.02]'
                          : 'border-primary bg-primary/5 dark:bg-primary/10 shadow-md scale-[1.02]'
                        : 'border-white/60 dark:border-white/10 bg-white/50 dark:bg-white/5 hover:border-primary/30 hover:shadow-sm'
                    }`}
                  >
                    {tier.isPopular && (
                      <span className={`absolute top-3 right-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded ${
                        isSelected ? 'bg-accent/90 text-primary' : 'bg-primary/10 dark:bg-white/10 text-primary dark:text-white'
                      }`}>
                        Popular
                      </span>
                    )}
                    <h3 className={`text-lg font-semibold mb-1 ${isSelected && tier.isPopular ? 'text-white' : 'text-primary dark:text-white'}`}>
                      {tier.name}
                    </h3>
                    <div className={`flex items-baseline gap-1 mb-2 ${isSelected && tier.isPopular ? 'text-white' : ''}`}>
                      <span className={`text-2xl font-semibold ${isSelected && tier.isPopular ? 'text-white' : 'text-primary dark:text-white'}`}>
                        {extractPrice(tier.priceString)}
                      </span>
                      <span className={`text-sm ${isSelected && tier.isPopular ? 'text-white/70' : 'text-primary/60 dark:text-white/60'}`}>
                        {extractSuffix(tier.priceString)}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${isSelected && tier.isPopular ? 'text-white/80' : 'text-primary/60 dark:text-white/60'}`}>
                      {tier.description}
                    </p>
                    {tier.highlightedFeatures.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {tier.highlightedFeatures.slice(0, 3).map((f, i) => (
                          <li key={i} className={`flex items-start gap-2 text-xs ${isSelected && tier.isPopular ? 'text-white/90' : 'text-primary/70 dark:text-white/70'}`}>
                            <Icon name="check" className={`text-[14px] mt-0.5 shrink-0 ${isSelected && tier.isPopular ? 'text-accent' : 'text-primary/50 dark:text-white/50'}`} />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {isSelected && (
                      <div className={`absolute top-3 left-3 w-5 h-5 rounded-full flex items-center justify-center ${tier.isPopular ? 'bg-white/20' : 'bg-primary'}`}>
                        <Icon name="check" className={`text-[14px] ${tier.isPopular ? 'text-white' : 'text-white'}`} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-xl rounded-xl border border-white/80 dark:border-white/10 shadow-sm p-6 space-y-5 animate-content-enter-delay-2">
            <h2 className="text-lg font-semibold text-primary dark:text-white">Your Information</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="join-firstname" className="block text-sm font-semibold text-primary dark:text-white mb-2">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="join-firstname"
                  type="text"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    if (fieldErrors.firstName) setFieldErrors(prev => ({ ...prev, firstName: '' }));
                  }}
                  placeholder="Jane"
                  className={`w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 ${
                    fieldErrors.firstName
                      ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-500/10'
                      : 'border-primary/20 dark:border-white/10 bg-white dark:bg-white/5 focus:ring-primary focus:border-primary'
                  } text-primary dark:text-white placeholder:text-gray-400 dark:placeholder-white/40`}
                />
                {fieldErrors.firstName && (
                  <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                    <Icon name="error" className="text-sm" />
                    {fieldErrors.firstName}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="join-lastname" className="block text-sm font-semibold text-primary dark:text-white mb-2">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="join-lastname"
                  type="text"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    if (fieldErrors.lastName) setFieldErrors(prev => ({ ...prev, lastName: '' }));
                  }}
                  placeholder="Doe"
                  className={`w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 ${
                    fieldErrors.lastName
                      ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-500/10'
                      : 'border-primary/20 dark:border-white/10 bg-white dark:bg-white/5 focus:ring-primary focus:border-primary'
                  } text-primary dark:text-white placeholder:text-gray-400 dark:placeholder-white/40`}
                />
                {fieldErrors.lastName && (
                  <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                    <Icon name="error" className="text-sm" />
                    {fieldErrors.lastName}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="join-email" className="block text-sm font-semibold text-primary dark:text-white mb-2">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="join-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: '' }));
                }}
                placeholder="jane.doe@example.com"
                className={`w-full px-4 py-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 ${
                  fieldErrors.email
                    ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-500/10'
                    : 'border-primary/20 dark:border-white/10 bg-white dark:bg-white/5 focus:ring-primary focus:border-primary'
                } text-primary dark:text-white placeholder:text-gray-400 dark:placeholder-white/40`}
              />
              {fieldErrors.email && (
                <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                  <Icon name="error" className="text-sm" />
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="join-promo" className="block text-sm font-semibold text-primary dark:text-white mb-2">
                Promo Code
              </label>
              <input
                id="join-promo"
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="e.g. WELCOME50"
                className="w-full px-4 py-3 rounded-xl border border-primary/20 dark:border-white/10 bg-white dark:bg-white/5 focus:ring-primary focus:border-primary focus:outline-none focus:ring-2 text-primary dark:text-white placeholder:text-gray-400 dark:placeholder-white/40 transition-colors"
              />
              <p className="text-xs text-primary/50 dark:text-white/50 mt-1">Optional — enter if you have a discount code.</p>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 flex items-start gap-2 animate-content-enter">
              <Icon name="error" className="text-red-600 dark:text-red-400 text-lg mt-0.5" />
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}

          <div className="animate-content-enter-delay-3">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 px-6 rounded-[4px] bg-primary text-white font-bold text-sm tracking-widest uppercase hover:bg-primary/90 transition-interactive duration-200 active:scale-[0.98] shadow-[0_4px_16px_rgba(41,53,21,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <WalkingGolferSpinner size="sm" variant="light" />
                  Redirecting to Checkout...
                </>
              ) : (
                'Continue to Payment'
              )}
            </button>
            <p className="text-xs text-primary/40 dark:text-white/40 text-center mt-3 font-light">
              You'll be redirected to Stripe to complete your payment securely.
            </p>
          </div>
        </form>
      </div>

      <Footer hideCta />
    </div>
  );
};

export default MembershipJoin;
