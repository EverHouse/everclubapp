import { useState, useEffect, useCallback } from 'react';
import BottomSheet from '../../ui/BottomSheet';
import { useAsyncAction } from '../../../hooks/useAsyncAction';
import type { BookingRequest } from '../types';
import { formatDateShort } from '../../../utils/dateUtils';

interface AssignMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingRequest | null;
  onAssign: (bookingId: number, memberEmail: string, memberName: string) => void;
}

interface MemberSearchResult {
  id: number;
  email: string;
  name: string;
  tier?: string;
}

export default function AssignMemberModal({ isOpen, onClose, booking, onAssign }: AssignMemberModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const { execute: assignMember, isLoading: assigning } = useAsyncAction<void>();
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
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(query)}&limit=10`);
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

  const handleAssign = async () => {
    if (!booking || !selectedMember) return;
    
    await assignMember(async () => {
      const res = await fetch(`/api/bookings/${booking.id}/assign-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_email: selectedMember.email,
          member_name: selectedMember.name,
          member_id: selectedMember.id
        })
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to assign member');
      }
      
      onAssign(booking.id, selectedMember.email, selectedMember.name);
      onClose();
    });
  };

  if (!booking) return null;

  const resourceName = booking.resource_id === 5 ? 'Conference Room' : `Bay ${booking.resource_id}`;
  const bookingDate = formatDateShort(booking.request_date || booking.slot_date || '');
  const startTime = booking.start_time.substring(0, 5);
  const endTime = booking.end_time.substring(0, 5);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Assign Member to Booking"
    >
      <div className="px-5 pb-8 pt-4 space-y-5">
        <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">link_off</span>
            </div>
            <div>
              <p className="font-medium text-primary dark:text-white">Unmatched Trackman Booking</p>
              <p className="text-sm text-primary/60 dark:text-white/60">Needs member assignment</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-primary/50 dark:text-white/50">Date:</span>
              <span className="ml-1 text-primary dark:text-white">{bookingDate}</span>
            </div>
            <div>
              <span className="text-primary/50 dark:text-white/50">Time:</span>
              <span className="ml-1 text-primary dark:text-white">{startTime} - {endTime}</span>
            </div>
            <div>
              <span className="text-primary/50 dark:text-white/50">Bay:</span>
              <span className="ml-1 text-primary dark:text-white">{resourceName}</span>
            </div>
            {booking.trackman_booking_id && (
              <div>
                <span className="text-primary/50 dark:text-white/50">Trackman ID:</span>
                <span className="ml-1 text-primary dark:text-white font-mono text-xs">{booking.trackman_booking_id}</span>
              </div>
            )}
          </div>
          {booking.user_name && booking.user_name !== 'Unknown (Trackman)' && (
            <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-500/30">
              <span className="text-primary/50 dark:text-white/50 text-sm">Trackman customer:</span>
              <span className="ml-1 text-primary dark:text-white text-sm">{booking.user_name}</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-primary dark:text-white">
            Search for Member
          </label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-10 pr-4 py-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/15 rounded-xl text-primary dark:text-white placeholder-gray-400"
            />
            {searching && (
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin text-lg">progress_activity</span>
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-white/15 rounded-xl divide-y divide-gray-100 dark:divide-white/10">
              {searchResults.map((member) => (
                <button
                  key={member.id}
                  onClick={() => setSelectedMember(member)}
                  className={`w-full p-3 text-left transition-colors ${
                    selectedMember?.id === member.id 
                      ? 'bg-primary/10 dark:bg-white/10' 
                      : 'hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-primary dark:text-white">{member.name}</p>
                      <p className="text-sm text-primary/60 dark:text-white/60">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.tier && (
                        <span className="text-xs px-2 py-0.5 bg-primary/10 dark:bg-white/10 rounded-full text-primary dark:text-white">
                          {member.tier}
                        </span>
                      )}
                      {selectedMember?.id === member.id && (
                        <span className="material-symbols-outlined text-green-500">check_circle</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
            <p className="text-sm text-primary/60 dark:text-white/60 text-center py-3">
              No members found matching "{searchQuery}"
            </p>
          )}
        </div>

        {selectedMember && (
          <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl">
            <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">check_circle</span>
              Selected: <strong>{selectedMember.name}</strong>
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-gray-100 dark:bg-white/10 text-primary dark:text-white rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={!selectedMember || assigning}
            className="flex-1 py-3 px-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {assigning ? (
              <>
                <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                Assigning...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">link</span>
                Assign Member
              </>
            )}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
