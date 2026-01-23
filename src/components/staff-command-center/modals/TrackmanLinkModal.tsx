import { useState, useEffect, useCallback } from 'react';
import { ModalShell } from '../../ModalShell';
import { useAsyncAction } from '../../../hooks/useAsyncAction';
import TrackmanIcon from '../../icons/TrackmanIcon';

interface TrackmanLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackmanBookingId: string | null;
  bayName?: string;
  bookingDate?: string;
  timeSlot?: string;
  matchedBookingId?: number;
  currentMemberName?: string;
  currentMemberEmail?: string;
  isRelink?: boolean;
  onSuccess?: () => void;
}

interface MemberSearchResult {
  id: number;
  email: string;
  name: string;
  tier?: string;
}

export function TrackmanLinkModal({ 
  isOpen, 
  onClose, 
  trackmanBookingId,
  bayName,
  bookingDate,
  timeSlot,
  matchedBookingId,
  currentMemberName,
  currentMemberEmail,
  isRelink,
  onSuccess
}: TrackmanLinkModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const { execute: linkToMember, isLoading: linking } = useAsyncAction<void>();
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSearchResults([]);
      setSelectedMember(null);
    }
  }, [isOpen]);

  const searchMembers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    
    setSearching(true);
    try {
      const res = await fetch(`/api/members/search?query=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.map((m: any) => ({
          id: m.id,
          email: m.email,
          name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email,
          tier: m.tier
        })));
      }
    } catch (e) {
      console.error('Failed to search members:', e);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchMembers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMembers]);

  const handleLink = async () => {
    if (!selectedMember) return;
    
    await linkToMember(async () => {
      // If re-linking an existing booking, use the change-owner endpoint
      if (isRelink && matchedBookingId) {
        const res = await fetch(`/api/bookings/${matchedBookingId}/change-owner`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            new_email: selectedMember.email,
            new_name: selectedMember.name,
            member_id: selectedMember.id
          })
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || data.message || 'Failed to change booking owner');
        }
      } else if (trackmanBookingId) {
        const res = await fetch('/api/bookings/link-trackman-to-member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            trackman_booking_id: trackmanBookingId,
            member_email: selectedMember.email,
            member_name: selectedMember.name,
            member_id: selectedMember.id
          })
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || data.message || 'Failed to link booking to member');
        }
      }
      
      onSuccess?.();
      onClose();
    });
  };

  if (!trackmanBookingId && !matchedBookingId) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <TrackmanIcon size={20} />
          <span>{isRelink ? 'Change Booking Owner' : 'Link Trackman Booking to Member'}</span>
        </div>
      }
      size="md"
    >
      <div className="p-4 space-y-4">
        {isRelink && currentMemberName && (
          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
              Currently Linked To
            </p>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">person</span>
              <div>
                <p className="font-medium text-blue-800 dark:text-blue-200">{currentMemberName}</p>
                {currentMemberEmail && (
                  <p className="text-sm text-blue-600 dark:text-blue-400">{currentMemberEmail}</p>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
            Trackman Booking Details
          </p>
          <div className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
            {bayName && (
              <p className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">sports_golf</span>
                {bayName}
              </p>
            )}
            {bookingDate && (
              <p className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">calendar_today</span>
                {bookingDate}
              </p>
            )}
            {timeSlot && (
              <p className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">schedule</span>
                {timeSlot}
              </p>
            )}
            <p className="flex items-center gap-1 text-xs opacity-70">
              <span className="material-symbols-outlined text-xs">tag</span>
              ID: #{trackmanBookingId}
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-primary dark:text-white mb-2">
            Search for Member
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-white/20 bg-white dark:bg-white/5 text-primary dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400 animate-spin">
                progress_activity
              </span>
            )}
          </div>
        </div>

        {searchResults.length > 0 && (
          <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-white/20 rounded-lg divide-y divide-gray-100 dark:divide-white/10">
            {searchResults.map((member) => (
              <button
                key={member.id}
                onClick={() => setSelectedMember(member)}
                className={`w-full px-4 py-3 flex items-center justify-between text-left transition-colors ${
                  selectedMember?.id === member.id
                    ? 'bg-amber-100 dark:bg-amber-500/20'
                    : 'hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                <div>
                  <p className="font-medium text-primary dark:text-white">{member.name}</p>
                  <p className="text-sm text-gray-500 dark:text-white/60">{member.email}</p>
                </div>
                {member.tier && (
                  <span className="text-xs px-2 py-0.5 bg-primary/10 dark:bg-white/10 text-primary dark:text-white rounded-full">
                    {member.tier}
                  </span>
                )}
                {selectedMember?.id === member.id && (
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">check_circle</span>
                )}
              </button>
            ))}
          </div>
        )}

        {selectedMember && (
          <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg flex items-center gap-3">
            <span className="material-symbols-outlined text-green-600 dark:text-green-400">person</span>
            <div>
              <p className="font-medium text-green-800 dark:text-green-300">{selectedMember.name}</p>
              <p className="text-sm text-green-700 dark:text-green-400">{selectedMember.email}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg border border-gray-200 dark:border-white/20 text-primary dark:text-white font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={!selectedMember || linking}
            className={`flex-1 py-2.5 px-4 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 ${
              isRelink 
                ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                : 'bg-amber-500 hover:bg-amber-600 text-white'
            }`}
          >
            {linking ? (
              <>
                <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                {isRelink ? 'Changing...' : 'Linking...'}
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">{isRelink ? 'swap_horiz' : 'link'}</span>
                {isRelink ? 'Change Owner' : 'Link to Member'}
              </>
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
