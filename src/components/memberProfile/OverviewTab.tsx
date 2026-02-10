import React from 'react';
import type { MemberProfile } from '../../types/data';
import { formatDatePacific } from './memberProfileTypes';

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
              className="w-full py-2.5 bg-brand-green text-white font-medium rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              Apply Credit
            </button>
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
                className={`text-xs flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${
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
                  className="w-full rounded-lg overflow-hidden border border-white/10 hover:opacity-90 transition-opacity"
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
                    className="text-xs text-red-500 hover:text-red-400 flex items-center gap-1 disabled:opacity-50"
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
                  className={`mt-2 text-xs px-3 py-1.5 rounded-lg border border-dashed transition-colors ${
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
                  className="text-red-500 hover:text-red-600 p-1 disabled:opacity-50"
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
