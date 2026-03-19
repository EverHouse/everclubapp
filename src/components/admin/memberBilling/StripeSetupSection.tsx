import React from 'react';
import Icon from '../../icons/Icon';

export function StripeSetupSection({
  onSyncToStripe,
  isSyncingToStripe,
  isDark,
}: {
  onSyncToStripe: () => void;
  isSyncingToStripe: boolean;
  isDark: boolean;
}) {
  return (
    <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon name="sync" className={`${isDark ? 'text-accent' : 'text-primary'}`} />
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-primary'}`}>Stripe Setup</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSyncToStripe}
          disabled={isSyncingToStripe}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors tactile-btn ${
            isDark ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
          } disabled:opacity-50`}
        >
          {isSyncingToStripe ? (
            <Icon name="progress_activity" className="animate-spin text-base" />
          ) : (
            <Icon name="person_add" className="text-base" />
          )}
          Sync to Stripe
        </button>
      </div>
      <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
        Create or link a Stripe customer for this member to enable wallet features.
      </p>
    </div>
  );
}
