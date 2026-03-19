import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithCredentials } from '../../../../hooks/queries/useFetch';
import type { MembershipTier } from './tiersTypes';
import Icon from '../../../../components/icons/Icon';

interface FeesSubTabProps {
    tiers: MembershipTier[];
    openEdit: (tier: MembershipTier) => void;
}

interface PricingData {
    guestFeeDollars: number;
    overageRatePerBlockDollars: number;
    overageBlockMinutes: number;
}

const FeesSubTab: React.FC<FeesSubTabProps> = ({ tiers, openEdit }) => {
    const oneTimePasses = tiers.filter(t => t.product_type === 'one_time');

    const { data: pricing, isLoading: pricingLoading } = useQuery({
        queryKey: ['pricing-config'],
        queryFn: () => fetchWithCredentials<PricingData>('/api/pricing'),
        staleTime: 5 * 60 * 1000,
    });

    return (
        <div className="space-y-6">
            <div>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                        Dynamic Fees
                    </h3>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Live from Stripe</span>
                </div>
                {pricingLoading ? (
                    <div className="grid grid-cols-2 gap-3">
                        {[0, 1].map(i => (
                            <div key={i} className="p-4 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse h-20" />
                        ))}
                    </div>
                ) : pricing ? (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 rounded-xl bg-white dark:bg-surface-dark border border-gray-200 dark:border-white/20 shadow-sm">
                            <div className="flex items-center gap-2 mb-1">
                                <Icon name="person_add" className="text-base text-primary/60 dark:text-white/60" />
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Guest Fee</p>
                            </div>
                            <p className="text-2xl font-bold text-primary dark:text-white">
                                ${pricing.guestFeeDollars.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">per guest per session</p>
                        </div>
                        <div className="p-4 rounded-xl bg-white dark:bg-surface-dark border border-gray-200 dark:border-white/20 shadow-sm">
                            <div className="flex items-center gap-2 mb-1">
                                <Icon name="timer" className="text-base text-primary/60 dark:text-white/60" />
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Overage Rate</p>
                            </div>
                            <p className="text-2xl font-bold text-primary dark:text-white">
                                ${pricing.overageRatePerBlockDollars.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">per {pricing.overageBlockMinutes} min block</p>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500">Could not load pricing data.</p>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                    These rates are sourced from Stripe products and update automatically.
                </p>
            </div>

            {oneTimePasses.length > 0 && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                            Day Passes & Guest Passes
                        </h3>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            {oneTimePasses.length} item{oneTimePasses.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <div className="space-y-3">
                        {oneTimePasses.map((pass) => (
                            <div 
                                key={pass.id} 
                                role="button"
                                tabIndex={0}
                                onClick={() => openEdit(pass)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(pass); } }}
                                className="bg-white dark:bg-surface-dark p-4 rounded-xl shadow-sm border border-gray-200 dark:border-white/20 cursor-pointer hover:border-primary/30 transition-all duration-fast"
                            >
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-bold text-lg text-primary dark:text-white">{pass.name}</h4>
                                            <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                                One-time
                                            </span>
                                            {!pass.is_active && (
                                                <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">Inactive</span>
                                            )}
                                        </div>
                                        <p className="text-xl font-bold text-primary dark:text-white">{pass.price_string}</p>
                                        {pass.description && (
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{pass.description}</p>
                                        )}
                                    </div>
                                    <button aria-label="Edit pass" className="text-gray-600 hover:text-primary dark:hover:text-white transition-colors">
                                        <Icon name="edit" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default FeesSubTab;
