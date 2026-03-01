import React, { useState, useEffect, useCallback } from 'react';
import type { MemberProfile } from '../../types/data';
import { formatDatePacific } from './memberProfileTypes';
import { apiRequest } from '../../lib/apiRequest';

interface OutstandingItem {
  id: number;
  sessionId: number;
  type: 'overage' | 'guest';
  description: string;
  date: string;
  amountCents: number;
}

interface OutstandingBalance {
  totalCents: number;
  totalDollars: number;
  itemCount: number;
  breakdown: OutstandingItem[];
}

interface OverviewTabProps {
  member: MemberProfile;
  isDark: boolean;
  isAdmin: boolean;
  visitorMode: boolean;
  bookingsCount: number;
  eventsCount: number;
  wellnessCount: number;
  visitsCount: number;
  accountBalance: { balanceCents: number; balanceDollars: number } | null;
  showApplyCreditModal: boolean;
  setShowApplyCreditModal: (v: boolean) => void;
  creditAmount: string;
  setCreditAmount: (v: string) => void;
  creditDescription: string;
  setCreditDescription: (v: string) => void;
  isApplyingCredit: boolean;
  handleApplyCredit: () => void;
  idImageUrl: string | null;
  isLoadingIdImage: boolean;
  isSavingIdImage: boolean;
  isDeletingIdImage: boolean;
  setShowIdScanner: (v: boolean) => void;
  showIdImageFull: boolean;
  setShowIdImageFull: (v: boolean) => void;
  handleDeleteIdImage: () => void;
  linkedEmails: string[];
  removingEmail: string | null;
  handleRemoveLinkedEmail: (email: string) => void;
}

const OverviewTab: React.FC<OverviewTabProps> = ({
  member,
  isDark,
  isAdmin,
  visitorMode,
  bookingsCount,
  eventsCount,
  wellnessCount,
  visitsCount,
  accountBalance,
  showApplyCreditModal,
  setShowApplyCreditModal,
  creditAmount,
  setCreditAmount,
  creditDescription,
  setCreditDescription,
  isApplyingCredit,
  handleApplyCredit,
  idImageUrl,
  isLoadingIdImage,
  isSavingIdImage,
  isDeletingIdImage,
  setShowIdScanner,
  showIdImageFull,
  setShowIdImageFull,
  handleDeleteIdImage,
  linkedEmails,
  removingEmail,
  handleRemoveLinkedEmail,
}) => {
  const [outstanding, setOutstanding] = useState<OutstandingBalance | null>(null);
  const [outstandingExpanded, setOutstandingExpanded] = useState(false);

  const fetchOutstanding = useCallback(async () => {
    if (!isAdmin || visitorMode || !member?.email) return;
    const url = `/api/member/balance?email=${encodeURIComponent(member.email)}`;
    const { ok, data } = await apiRequest<OutstandingBalance>(url);
    if (ok && data) setOutstanding(data);
  }, [isAdmin, visitorMode, member?.email]);

  useEffect(() => { fetchOutstanding(); }, [fetchOutstanding]);

  useEffect(() => {
    const refresh = () => { fetchOutstanding(); };
    window.addEventListener('billing-update', refresh);
    return () => window.removeEventListener('billing-update', refresh);
  }, [fetchOutstanding]);

  const hasAddress = member?.streetAddress || member?.city || member?.state || member?.zipCode;
  const addressParts = [member?.streetAddress, member?.city, member?.state, member?.zipCode].filter(Boolean);
  const formattedAddress = addressParts.length > 0 
    ? (member?.streetAddress ? member.streetAddress + ', ' : '') + 
      [member?.city, member?.state].filter(Boolean).join(', ') + 
      (member?.zipCode ? ' ' + member.zipCode : '')
    : null;

  return (
    <div className="space-y-4">
      <div 
        className="animate-slide-up-stagger grid grid-cols-2 gap-3"
        style={{ '--stagger-index': 0 } as React.CSSProperties}
      >
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-lg text-brand-green">event_note</span>
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{bookingsCount}</span>
          </div>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Total Bookings</p>
        </div>
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-lg text-purple-500">celebration</span>
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{eventsCount}</span>
          </div>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Event RSVPs</p>
        </div>
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-lg text-pink-500">spa</span>
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{wellnessCount}</span>
          </div>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Wellness Classes</p>
        </div>
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-lg text-emerald-500">check_circle</span>
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{visitsCount}</span>
          </div>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Attended Visits</p>
        </div>
      </div>

      {isAdmin && !visitorMode && (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 1 } as React.CSSProperties}
        >
          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                Account Balance
              </h4>
            <span className={`text-xl font-bold font-serif ${(accountBalance?.balanceDollars || 0) > 0 ? 'text-green-500' : (isDark ? 'text-gray-400' : 'text-gray-500')}`}>
              ${(accountBalance?.balanceDollars || 0).toFixed(2)}
            </span>
          </div>
          <p className={`text-xs mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Available credit applied to guest fees & overages
          </p>
          
          {showApplyCreditModal ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    placeholder="Amount ($)"
                    className={`w-full px-3 py-2 rounded-lg border text-sm ${
                      isDark
                        ? 'bg-white/10 border-white/20 text-white placeholder:text-gray-500'
                        : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
                    }`}
                  />
                </div>
              </div>
              <input
                type="text"
                value={creditDescription}
                onChange={(e) => setCreditDescription(e.target.value)}
                placeholder="Reason (optional)"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${
                  isDark
                    ? 'bg-white/10 border-white/20 text-white placeholder:text-gray-500'
                    : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
                }`}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowApplyCreditModal(false);
                    setCreditAmount('');
                    setCreditDescription('');
                  }}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${
                    isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyCredit}
                  disabled={isApplyingCredit || !creditAmount || parseFloat(creditAmount) <= 0}
                  className="flex-1 px-3 py-2 bg-brand-green text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {isApplyingCredit ? 'Applying...' : 'Apply Credit'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowApplyCreditModal(true)}
              className="w-full py-2.5 bg-brand-green text-white font-medium rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity tactile-btn"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              Apply Credit
            </button>
          )}
        </div>
        </div>
      )}

      {isAdmin && !visitorMode && outstanding && outstanding.totalCents > 0 && (
        <div
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 1.5 } as React.CSSProperties}
        >
          <div className={`p-4 rounded-xl border ${isDark ? 'bg-amber-900/20 border-amber-500/30' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center justify-between mb-1">
              <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                Outstanding Fees
              </h4>
              <span className={`text-xl font-bold font-serif ${isDark ? 'text-white' : 'text-gray-900'}`}>
                ${outstanding.totalDollars.toFixed(2)}
              </span>
            </div>
            <p className={`text-xs mb-2 ${isDark ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
              {outstanding.itemCount} {outstanding.itemCount === 1 ? 'item' : 'items'} pending collection
            </p>
            {outstanding.breakdown.length > 0 && (
              <>
                <button
                  onClick={() => setOutstandingExpanded(!outstandingExpanded)}
                  className={`w-full flex items-center justify-between text-xs font-medium py-1.5 transition-colors tactile-btn ${isDark ? 'text-amber-400 hover:text-amber-300' : 'text-amber-700 hover:text-amber-800'}`}
                >
                  <span>View breakdown</span>
                  <span className={`material-symbols-outlined text-base transition-transform ${outstandingExpanded ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>
                {outstandingExpanded && (
                  <div className="space-y-1.5 mt-1">
                    {outstanding.breakdown.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg ${isDark ? 'bg-white/5' : 'bg-white/60'}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                            item.type === 'guest'
                              ? isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                              : isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {item.type === 'guest' ? 'G' : 'O'}
                          </span>
                          <span className={`text-xs truncate ${isDark ? 'text-white/80' : 'text-gray-700'}`}>
                            {item.description}
                          </span>
                        </div>
                        <span className={`text-xs font-medium flex-shrink-0 ml-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          ${(item.amountCents / 100).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {(
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 2 } as React.CSSProperties}
        >
          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-3">
              <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                <span className="material-symbols-outlined text-[18px]">badge</span>
                ID on File
              </h4>
              <button
                onClick={() => setShowIdScanner(true)}
                className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg transition-colors tactile-btn ${
                  isDark ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'
                }`}
              >
                <span className="material-symbols-outlined text-sm">photo_camera</span>
                {idImageUrl ? 'Re-scan' : 'Scan ID'}
              </button>
            </div>
            {isLoadingIdImage || isSavingIdImage ? (
              <div className="flex items-center justify-center py-6">
                <span className="material-symbols-outlined text-2xl text-gray-400 animate-spin">progress_activity</span>
              </div>
            ) : idImageUrl ? (
              <div className="space-y-2">
                <button
                  onClick={() => setShowIdImageFull(true)}
                  className="w-full rounded-lg overflow-hidden border border-white/10 hover:opacity-90 transition-opacity tactile-btn"
                >
                  <img
                    src={idImageUrl}
                    alt="ID Document"
                    className="w-full h-32 object-cover"
                  />
                </button>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Tap to view full size
                  </span>
                  <button
                    onClick={handleDeleteIdImage}
                    disabled={isDeletingIdImage}
                    className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1 disabled:opacity-50 tactile-btn"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className={`text-center py-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <span className="material-symbols-outlined text-3xl mb-1">badge</span>
                <p className="text-xs">No ID on file</p>
                <button
                  onClick={() => setShowIdScanner(true)}
                  className={`mt-2 text-xs px-3 py-1.5 rounded-lg border border-dashed transition-colors tactile-btn ${
                    isDark
                      ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10'
                      : 'border-emerald-500/50 text-emerald-600 hover:bg-emerald-50'
                  }`}
                >
                  Scan or Upload ID
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div 
        className="animate-slide-up-stagger"
        style={{ '--stagger-index': 2.5 } as React.CSSProperties}
      >
        <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center justify-between">
            <h4 className={`text-sm font-bold flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className="material-symbols-outlined text-[18px]">description</span>
              Waiver
            </h4>
            {member?.waiverSignedAt ? (
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-green-500">check_circle</span>
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Signed {formatDatePacific(member.waiverSignedAt)}
                  {member.waiverVersion ? ` (v${member.waiverVersion})` : ''}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-amber-500">warning</span>
                <span className={`text-xs font-medium text-amber-500`}>Not signed</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {(member?.dateOfBirth || member?.companyName || hasAddress || member?.emailOptIn !== null || member?.smsOptIn !== null) && (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 3 } as React.CSSProperties}
        >
          <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <h4 className={`text-sm font-bold mb-3 flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className="material-symbols-outlined text-[18px]">info</span>
              Personal Information
            </h4>
          <div className="space-y-2">
            {member?.dateOfBirth && (
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-[16px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>cake</span>
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {formatDatePacific(member.dateOfBirth)}
                </span>
              </div>
            )}
            {member?.companyName && (
              <div className="flex items-center gap-2">
                <span className={`material-symbols-outlined text-[16px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>business</span>
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {member.companyName}
                </span>
              </div>
            )}
            {formattedAddress && (
              <div className="flex items-start gap-2">
                <span className={`material-symbols-outlined text-[16px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>location_on</span>
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {formattedAddress}
                </span>
              </div>
            )}
            {(member?.emailOptIn !== null || member?.smsOptIn !== null) && (
              <div className="flex items-center gap-4 pt-1">
                {member?.emailOptIn !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className={`material-symbols-outlined text-[14px] ${member.emailOptIn ? 'text-green-500' : 'text-gray-400'}`}>
                      {member.emailOptIn ? 'check_circle' : 'cancel'}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Email</span>
                  </div>
                )}
                {member?.smsOptIn !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className={`material-symbols-outlined text-[14px] ${member.smsOptIn ? 'text-green-500' : 'text-gray-400'}`}>
                      {member.smsOptIn ? 'check_circle' : 'cancel'}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>SMS</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        </div>
      )}
      
      {isAdmin && linkedEmails.length > 0 && (
        <div 
          className="animate-slide-up-stagger"
          style={{ '--stagger-index': 4 } as React.CSSProperties}
        >
          <div className={`mt-6 p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <h4 className={`text-sm font-bold mb-3 flex items-center gap-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className="material-symbols-outlined text-[18px]">link</span>
              Trackman Linked Emails
            </h4>
          <div className="space-y-2">
            {linkedEmails.map(email => (
              <div key={email} className={`flex items-center justify-between px-3 py-2 rounded-lg ${isDark ? 'bg-white/5' : 'bg-white'}`}>
                <span className={`text-sm font-mono truncate ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{email}</span>
                <button
                  onClick={() => handleRemoveLinkedEmail(email)}
                  disabled={removingEmail === email}
                  className="text-red-500 hover:text-red-600 p-1 disabled:opacity-50 tactile-btn"
                  aria-label="Remove linked email"
                >
                  {removingEmail === email ? (
                    <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
        </div>
      )}
    </div>
  );
};

export default OverviewTab;
