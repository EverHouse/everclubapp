import React from 'react';
import type { DayPass, RedemptionLog } from './types';
import { formatPassType } from './types';
import Icon from '../../../icons/Icon';

interface PassSearchResultsProps {
  passes: DayPass[];
  hasSearched: boolean;
  searchEmail: string;
  redeemingId: string | null;
  expandedPassId: string | null;
  loadingHistoryId: string | null;
  errorState: boolean;
  formatDate: (dateStr: string) => string;
  formatDateTime: (dateStr: string) => string;
  handleRedeem: (passId: string) => void;
  handleViewHistory: (passId: string) => void;
  handleSellNewPass: () => void;
  getPassHistory: (passId: string) => RedemptionLog[];
  onClearSearch: () => void;
}

const PassSearchResults: React.FC<PassSearchResultsProps> = ({
  passes,
  hasSearched,
  searchEmail,
  redeemingId,
  expandedPassId,
  loadingHistoryId,
  errorState,
  formatDate,
  formatDateTime,
  handleRedeem,
  handleViewHistory,
  handleSellNewPass,
  getPassHistory,
  onClearSearch,
}) => {
  if (errorState) return null;

  if (!hasSearched) {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <Icon name="qr_code_scanner" className="text-4xl text-primary/30 dark:text-white/30 mb-2" />
        <p className="text-sm text-primary/60 dark:text-white/60">Search by email or scan QR to find passes</p>
      </div>
    );
  }

  if (passes.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 space-y-3">
        <div className="flex items-start gap-3">
          <Icon name="search_off" className="text-2xl text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900 dark:text-amber-100">No active passes found</p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              No passes with remaining uses found for {searchEmail}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={handleSellNewPass}
            className="flex-1 min-w-[140px] px-4 py-2.5 rounded-lg bg-teal-500 text-white font-medium text-sm hover:bg-teal-600 transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="add_shopping_cart" className="text-lg" />
            Sell new pass
          </button>
          <button
            onClick={onClearSearch}
            className="px-4 py-2.5 rounded-lg bg-amber-100 dark:bg-amber-800/40 text-amber-900 dark:text-amber-100 font-medium text-sm hover:bg-amber-200 dark:hover:bg-amber-800/60 transition-colors flex items-center justify-center gap-2"
          >
            <Icon name="refresh" className="text-lg" />
            Search again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[350px] overflow-y-auto">
      {passes.map(pass => (
        <div
          key={pass.id}
          className="p-4 rounded-xl bg-white/50 dark:bg-white/5 border border-primary/10 dark:border-white/10"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-primary dark:text-white">
                {formatPassType(pass.productType)}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 text-xs font-medium bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 rounded-full">
                  {pass.remainingUses} {pass.remainingUses === 1 ? 'use' : 'uses'} remaining
                </span>
              </div>
              <p className="text-xs text-primary/60 dark:text-white/60 mt-2">
                Purchased: {formatDate(pass.purchasedAt)}
              </p>
              {(pass.purchaserFirstName || pass.purchaserLastName) && (
                <p className="text-xs text-primary/60 dark:text-white/60">
                  {[pass.purchaserFirstName, pass.purchaserLastName].filter(Boolean).join(' ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleViewHistory(pass.id)}
                disabled={loadingHistoryId === pass.id}
                className="px-3 py-2 rounded-lg bg-primary/10 dark:bg-white/10 text-primary dark:text-white font-medium text-sm hover:bg-primary/20 dark:hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {loadingHistoryId === pass.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary dark:border-white border-t-transparent" />
                ) : (
                  <Icon name={expandedPassId === pass.id ? 'expand_less' : 'history'} className="text-base" />
                )}
                History
              </button>
              <button
                onClick={() => handleRedeem(pass.id)}
                disabled={redeemingId === pass.id}
                className="px-4 py-2 rounded-lg bg-teal-500 text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {redeemingId === pass.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                ) : (
                  <Icon name="check" className="text-base" />
                )}
                Redeem
              </button>
            </div>
          </div>
          
          {expandedPassId === pass.id && (
            <div className="mt-3 pt-3 border-t border-primary/10 dark:border-white/10">
              {getPassHistory(pass.id).length === 0 ? (
                <p className="text-sm text-primary/50 dark:text-white/50 text-center py-2">
                  No redemptions yet
                </p>
              ) : (
                <div className="space-y-2">
                  {getPassHistory(pass.id).map((log, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-primary/5 dark:bg-white/5"
                    >
                      <div className="flex items-center gap-2">
                        <Icon name="schedule" className="text-sm text-primary/60 dark:text-white/60" />
                        <span className="text-xs text-primary dark:text-white">
                          {formatDateTime(log.redeemedAt)}
                        </span>
                      </div>
                      <span className="text-xs text-primary/70 dark:text-white/70">
                        {log.redeemedBy}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default PassSearchResults;
