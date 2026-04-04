import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useTheme } from '../../contexts/ThemeContext';
import { apiRequest } from '../../lib/apiRequest';
import { useToast } from '../Toast';
import { haptic } from '../../utils/haptics';
import ModalShell from '../ModalShell';
import MemberPaymentModal from './MemberPaymentModal';
import SlideUpDrawer from '../SlideUpDrawer';
import Input from '../Input';
import { usePricing } from '../../hooks/usePricing';
import WalkingGolferSpinner from '../WalkingGolferSpinner';
import { MemberSearchInput, type SelectedMember } from '../shared/MemberSearchInput';
import Icon from '../icons/Icon';
import { isPlaceholderGuestName } from '../../utils/rosterUtils';

export interface RosterParticipant {
  id: number;
  sessionId: number;
  userId: string | null;
  guestId: number | null;
  participantType: 'owner' | 'member' | 'guest';
  displayName: string;
  slotDuration: number | null;
  paymentStatus: string | null;
  createdAt: string;
}

interface ConflictData {
  id?: number;
  date?: string;
  startTime?: string;
  endTime?: string;
  resourceName?: string;
}

interface BookingConflictDetails {
  memberName: string;
  conflictingBooking: {
    id: number;
    date: string;
    startTime: string;
    endTime: string;
    resourceName?: string;
  };
}

export interface RosterBooking {
  id: number;
  ownerEmail: string;
  ownerName: string;
  requestDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  resourceId: number | null;
  resourceName: string | null;
  status: string;
  sessionId: number | null;
  notes: string | null;
  staffNotes: string | null;
}

interface ParticipantsResponse {
  booking: RosterBooking;
  declaredPlayerCount: number;
  currentParticipantCount: number;
  remainingSlots: number;
  participants: RosterParticipant[];
  ownerTier: string | null;
  guestPassesRemaining: number;
  guestPassesUsed: number;
  remainingMinutes: number;
}

interface FeePreviewResponse {
  booking: {
    id: number;
    durationMinutes: number;
    startTime: string;
    endTime: string;
  };
  participants: {
    total: number;
    members: number;
    guests: number;
    owner: number;
  };
  timeAllocation: {
    totalMinutes: number;
    declaredPlayerCount: number;
    totalSlots?: number;
    minutesPerParticipant: number;
    allocations: Array<{
      displayName: string;
      type: string;
      minutes: number;
      feeCents?: number;
      guestPassUsed?: boolean;
    }>;
  };
  ownerFees: {
    tier: string | null;
    dailyAllowance: number;
    remainingMinutesToday: number;
    ownerMinutesUsed: number;
    guestMinutesCharged: number;
    totalMinutesResponsible: number;
    minutesWithinAllowance: number;
    overageMinutes: number;
    estimatedOverageFee: number;
    estimatedGuestFees?: number;
    estimatedTotalFees?: number;
  };
  guestPasses: {
    yearlyAllowance: number;
    remaining: number;
    usedThisBooking: number;
    afterBooking: number;
  };
  allPaid?: boolean;
}

export interface RosterManagerProps {
  bookingId: number;
  declaredPlayerCount: number;
  isOwner: boolean;
  isStaff: boolean;
  onUpdate?: () => void;
  resourceType?: 'simulator' | 'conference_room';
}

const isPlaceholderName = isPlaceholderGuestName;

const RosterManager: React.FC<RosterManagerProps> = ({
  bookingId,
  declaredPlayerCount,
  isOwner,
  isStaff,
  onUpdate,
  resourceType = 'simulator'
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const { showToast } = useToast();
  const { guestFeeDollars, overageRatePerBlockDollars } = usePricing();
  const [rosterListRef] = useAutoAnimate();

  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState<RosterParticipant[]>([]);
  const [booking, setBooking] = useState<RosterBooking | null>(null);
  const [guestPassesRemaining, setGuestPassesRemaining] = useState(0);
  const [feePreview, setFeePreview] = useState<FeePreviewResponse | null>(null);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [addingMember, setAddingMember] = useState(false);
  const [apiDeclaredPlayerCount, setApiDeclaredPlayerCount] = useState<number>(declaredPlayerCount);
  const [apiRemainingSlots, setApiRemainingSlots] = useState<number>(Math.max(0, declaredPlayerCount - 1));
  const [apiCurrentParticipantCount, setApiCurrentParticipantCount] = useState<number>(1);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictDetails, setConflictDetails] = useState<BookingConflictDetails | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const [showGuestInfoDrawer, setShowGuestInfoDrawer] = useState(false);
  const [replacingPlaceholderId, setReplacingPlaceholderId] = useState<number | null>(null);
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestEmailError, setGuestEmailError] = useState<string | undefined>(undefined);
  const [guestPassLoading, setGuestPassLoading] = useState(false);
  const [guestPassError, setGuestPassError] = useState<string | null>(null);

  const canManage = isOwner || isStaff;

  const remainingSlots = apiRemainingSlots;

  const fetchAllBookingData = useCallback(async () => {
    try {
      const [participantsRes, feeRes] = await Promise.all([
        apiRequest<ParticipantsResponse>(`/api/bookings/${bookingId}/participants`),
        apiRequest<FeePreviewResponse>(
          `/api/bookings/${bookingId}/participants/preview-fees`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        )
      ]);

      if (participantsRes.ok && participantsRes.data) {
        const d = participantsRes.data;
        setParticipants(d.participants);
        setBooking(d.booking);
        setGuestPassesRemaining(d.guestPassesRemaining);
        if (d.declaredPlayerCount) setApiDeclaredPlayerCount(d.declaredPlayerCount);
        if (typeof d.remainingSlots === 'number') setApiRemainingSlots(d.remainingSlots);
        if (typeof d.currentParticipantCount === 'number') setApiCurrentParticipantCount(d.currentParticipantCount);
      } else {
        console.error('[RosterManager] Failed to fetch participants:', participantsRes.error);
      }

      if (feeRes.ok && feeRes.data) {
        setFeePreview(feeRes.data);
      }
    } catch (err: unknown) {
      console.error('[RosterManager] Error fetching booking data:', err);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    fetchAllBookingData();
  }, [fetchAllBookingData]);

  const existingUserIds = useMemo(() =>
    participants.filter(p => p.userId).map(p => p.userId as string),
    [participants]
  );

  const handleAddMember = async (member: SelectedMember) => {
    setAddingMember(true);
    haptic.light();
    
    try {
      const { ok, data, error, errorType, errorData } = await apiRequest<{ success: boolean; participant: Record<string, unknown>; conflict?: ConflictData; errorType?: string }>(
        `/api/bookings/${bookingId}/participants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'member',
            userId: member.id
          })
        },
        { retryNonIdempotent: false }
      );
      
      if (ok && data) {
        haptic.success();
        showToast(`${member.name} added to booking`, 'success');
        setShowAddMemberModal(false);
        const newParticipant: RosterParticipant = {
          id: data.participant?.id ? Number(data.participant.id) : -Date.now(),
          sessionId: 0,
          userId: member.id,
          guestId: null,
          participantType: 'member',
          displayName: member.name,
          slotDuration: null,
          paymentStatus: null,
          createdAt: new Date().toISOString(),
        };
        setParticipants(prev => {
          const withoutPlaceholder = prev.filter(p => !(p.participantType === 'guest' && isPlaceholderName(p.displayName)));
          if (withoutPlaceholder.length < prev.length) {
            return [...withoutPlaceholder, newParticipant];
          }
          return [...prev, newParticipant];
        });
        setApiRemainingSlots(prev => Math.max(0, prev - 1));
        setApiCurrentParticipantCount(prev => prev + 1);
        fetchAllBookingData();
        onUpdate?.();
      } else {
        haptic.error();
        
        if (errorData?.code === 'ROSTER_LOCKED') {
          showToast('This booking has been paid — roster is locked. Use the check-in flow to add walk-in guests.', 'warning');
        } else if (errorType === 'booking_conflict' || (error && error.includes('scheduling conflict'))) {
          const conflict = errorData?.conflict as ConflictData | undefined;
          setConflictDetails({
            memberName: member.name,
            conflictingBooking: conflict ? {
              id: conflict.id || 0,
              date: conflict.date || booking?.requestDate || 'Unknown',
              startTime: conflict.startTime || booking?.startTime || 'Unknown',
              endTime: conflict.endTime || booking?.endTime || 'Unknown',
              resourceName: conflict.resourceName || booking?.resourceName || undefined
            } : {
              id: 0,
              date: booking?.requestDate || 'Unknown',
              startTime: booking?.startTime || 'Unknown',
              endTime: booking?.endTime || 'Unknown',
              resourceName: booking?.resourceName || undefined
            }
          });
          setShowConflictModal(true);
          showToast(`${member.name} has a conflicting booking at this time`, 'warning');
        } else {
          showToast(error || 'Failed to add member', 'error');
        }
      }
    } catch (_err: unknown) {
      haptic.error();
      showToast('Failed to add member', 'error');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveParticipant = useCallback(async (participantId: number, displayName: string) => {
    if (removingId !== null) return;
    setRemovingId(participantId);
    haptic.light();

    const snapshot = {
      participants: [...participants],
      remainingSlots: apiRemainingSlots,
      participantCount: apiCurrentParticipantCount,
    };
    setParticipants(prev => prev.filter(p => p.id !== participantId));
    setApiRemainingSlots(snapshot.remainingSlots + 1);
    setApiCurrentParticipantCount(Math.max(1, snapshot.participantCount - 1));

    const rollback = () => {
      setParticipants(snapshot.participants);
      setApiRemainingSlots(snapshot.remainingSlots);
      setApiCurrentParticipantCount(snapshot.participantCount);
    };

    try {
      const { ok, error, errorData } = await apiRequest(
        `/api/bookings/${bookingId}/participants/${participantId}`,
        { method: 'DELETE' }
      );

      if (ok) {
        haptic.success();
        showToast(`${displayName} removed from booking`, 'success');
        fetchAllBookingData();
        onUpdate?.();
      } else {
        haptic.error();
        rollback();
        if (errorData?.code === 'ROSTER_LOCKED') {
          showToast('This booking has been paid — roster is locked.', 'warning');
        } else {
          showToast(error || 'Failed to remove participant', 'error');
        }
      }
    } catch {
      haptic.error();
      rollback();
      showToast('Failed to remove participant', 'error');
    } finally {
      setRemovingId(null);
    }
  }, [removingId, participants, apiRemainingSlots, apiCurrentParticipantCount, bookingId, showToast, fetchAllBookingData, onUpdate]);

  const getTypeBadge = useCallback((type: 'owner' | 'member' | 'guest') => {
    const styles = {
      owner: isDark 
        ? 'bg-[#CCB8E4]/20 text-[#CCB8E4] border-[#CCB8E4]/30' 
        : 'bg-[#CCB8E4]/30 text-[#5a4a6d] border-[#CCB8E4]/50',
      member: isDark
        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
        : 'bg-emerald-100 text-emerald-700 border-emerald-200',
      guest: isDark
        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
        : 'bg-amber-100 text-amber-700 border-amber-200'
    };
    
    const labels = { owner: 'Owner', member: 'Member', guest: 'Guest' };
    
    return (
      <span className={`w-fit px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest rounded-[4px] border ${styles[type]}`}>
        {labels[type]}
      </span>
    );
  }, [isDark]);

  const ownerParticipant = useMemo(() => 
    participants.find(p => p.participantType === 'owner'),
    [participants]
  );

  const realParticipants = useMemo(() =>
    participants.filter(p => p.participantType !== 'owner' && !isPlaceholderName(p.displayName)),
    [participants]
  );

  const placeholderParticipants = useMemo(() =>
    participants.filter(p => p.participantType === 'guest' && isPlaceholderName(p.displayName)),
    [participants]
  );

  const openSlotCount = remainingSlots + placeholderParticipants.length;

  const pendingGuestFees = useMemo(() => {
    const pendingGuests = participants.filter(
      p => p.participantType === 'guest' && 
           (p.paymentStatus === 'pending' || p.paymentStatus === null)
    );
    return {
      count: pendingGuests.length,
      participants: pendingGuests
    };
  }, [participants]);

  const rosterLocked = !!(feePreview?.allPaid);

  const totalEstimatedFees = useMemo(() =>
    feePreview?.ownerFees?.estimatedTotalFees ?? ((feePreview?.ownerFees?.estimatedOverageFee ?? 0) + (feePreview?.ownerFees?.estimatedGuestFees ?? 0)),
    [feePreview?.ownerFees?.estimatedTotalFees, feePreview?.ownerFees?.estimatedOverageFee, feePreview?.ownerFees?.estimatedGuestFees]
  );
  const hasEstimatedFees = useMemo(() => totalEstimatedFees > 0, [totalEstimatedFees]);
  const isPaid = useMemo(() => !!(feePreview?.allPaid), [feePreview?.allPaid]);

  const hasPayableParticipantFees = useMemo(() => {
    if (!feePreview || isPaid) return false;
    const hasPendingGuests = pendingGuestFees.count > 0;
    const ownerP = participants.find(p => p.participantType === 'owner');
    const ownerHasUnpaidFee = ownerP &&
      (ownerP.paymentStatus === 'pending' || ownerP.paymentStatus === null) &&
      (feePreview?.ownerFees?.estimatedOverageFee ?? 0) > 0;
    return hasPendingGuests || !!ownerHasUnpaidFee;
  }, [feePreview, isPaid, pendingGuestFees, participants]);

  const showPayableUnpaidFees = isOwner && hasPayableParticipantFees;
  const showEmptySlotEstimate = isOwner && !isPaid && hasEstimatedFees && !hasPayableParticipantFees;
  const showFeesPaid = isOwner && isPaid && hasEstimatedFees;

  const hideConferenceRoomFeeCard = resourceType === 'conference_room' && !hasEstimatedFees && !hasPayableParticipantFees && !isPaid;

  const handlePaymentSuccess = useCallback(() => {
    setShowPaymentModal(false);
    showToast('Payment successful! Guest fees have been paid.', 'success');
    haptic.success();
    fetchAllBookingData();
    onUpdate?.();
  }, [showToast, fetchAllBookingData, onUpdate]);

  const validateGuestEmail = (value: string): string | undefined => {
    if (!value.trim()) return 'Email is required for guest tracking';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Please enter a valid email address';
    return undefined;
  };

  const handleGuestEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setGuestEmail(value);
    if (guestEmailError) {
      setGuestEmailError(validateGuestEmail(value));
    }
  };

  const guestInfoValid = guestFirstName.trim() && guestLastName.trim() && guestEmail.trim() && !validateGuestEmail(guestEmail);

  const openGuestInfoDrawer = (placeholderId?: number) => {
    setReplacingPlaceholderId(placeholderId ?? null);
    setGuestFirstName('');
    setGuestLastName('');
    setGuestEmail('');
    setGuestEmailError(undefined);
    setGuestPassError(null);
    setShowGuestInfoDrawer(true);
  };

  const handleUseGuestPass = async () => {
    const emailError = validateGuestEmail(guestEmail);
    if (emailError) {
      setGuestEmailError(emailError);
      return;
    }

    const fullName = `${guestFirstName.trim()} ${guestLastName.trim()}`;
    setGuestPassLoading(true);
    setGuestPassError(null);

    try {
      const { ok, error: apiError, errorData } = await apiRequest(
        `/api/bookings/${bookingId}/participants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'guest',
            guest: { name: fullName, email: guestEmail.trim() },
            useGuestPass: true
          })
        }
      );

      if (ok) {
        haptic.success();
        showToast(`${fullName} added with guest pass`, 'success');
        setShowGuestInfoDrawer(false);
        fetchAllBookingData();
        onUpdate?.();
      } else if (errorData?.code === 'ROSTER_LOCKED') {
        setGuestPassError('This booking has been paid — the roster is locked.');
      } else {
        setGuestPassError(apiError || "Couldn't add your guest. Please try again.");
      }
    } catch (err: unknown) {
      const msg = ((err instanceof Error ? err.message : String(err)) || '').toLowerCase();
      if (!msg.includes('abort') && !msg.includes('timeout')) {
        setGuestPassError("Something went wrong adding your guest. Please try again.");
      }
    } finally {
      setGuestPassLoading(false);
    }
  };

  const openSlotAddMember = (placeholderId?: number) => {
    if (placeholderId) {
      setReplacingPlaceholderId(placeholderId);
    }
    setShowAddMemberModal(true);
  };

  if (loading) {
    return (
      <div className={`glass-card rounded-xl p-6 ${isDark ? 'border-white/10' : 'border-black/5'}`}>
        <div className="flex items-center justify-center py-8">
          <WalkingGolferSpinner size="sm" />
        </div>
      </div>
    );
  }

  const renderOpenSlot = (idx: number, placeholderId?: number) => (
    <div
      key={placeholderId ? `placeholder-${placeholderId}` : `open-${idx}`}
      className={`flex flex-col gap-2.5 py-3 border-t border-dashed ${
        isDark ? 'border-white/10' : 'border-black/10'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          isDark ? 'bg-white/10' : 'bg-black/5'
        }`}>
          <Icon name="person_outline" className={`text-xl ${isDark ? 'text-white/30' : 'text-[#293515]/30'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${isDark ? 'text-white/50' : 'text-[#293515]/50'}`}>
            Guest (info pending)
          </p>
          <p className={`text-xs ${isDark ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
            ${guestFeeDollars.toFixed(0)} guest fee applies
          </p>
        </div>
      </div>
      {canManage && !rosterLocked && (
        <div className="flex gap-2">
          <button
            onClick={() => openSlotAddMember(placeholderId)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#293515] text-white font-semibold text-xs transition-interactive duration-fast hover:bg-[#3a4a20] active:scale-[0.98] tactile-btn"
          >
            <Icon name="person_add" className="text-base" />
            Add Member
          </button>
          {guestPassesRemaining > 0 && (
            <button
              onClick={() => openGuestInfoDrawer(placeholderId)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-semibold text-xs transition-interactive duration-fast active:scale-[0.98] tactile-btn ${
                isDark
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <Icon name="confirmation_number" className="text-base" />
              Use Guest Pass
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {!hideConferenceRoomFeeCard && (
      <div className={`rounded-xl overflow-hidden border ${isDark ? 'border-white/10 bg-[#1e2319]' : 'border-black/5 bg-white'}`} style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
        <div className={`px-5 py-4 border-b ${isDark ? 'border-white/10' : 'border-black/5'}`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-2xl ${isDark ? 'text-white' : 'text-[#293515]'} leading-tight`} style={{ fontFamily: 'var(--font-headline)' }}>
              {resourceType === 'conference_room' ? 'Booking Fees' : (canManage ? 'Manage Players' : 'Players')}
            </h3>
            {resourceType !== 'conference_room' && (
              <span className={`text-sm font-medium ${isDark ? 'text-white/60' : 'text-[#293515]/60'}`}>
                {apiCurrentParticipantCount}/{apiDeclaredPlayerCount}
              </span>
            )}
          </div>
        </div>

        <div ref={rosterListRef} className="px-5 py-4 space-y-3">
          {resourceType !== 'conference_room' && ownerParticipant && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                  {ownerParticipant.displayName}
                </p>
              </div>
              {getTypeBadge('owner')}
            </div>
          )}

          {resourceType !== 'conference_room' && realParticipants.map((participant, idx) => (
            <div 
              key={`${participant.id}-${idx}`}
              className="flex items-center gap-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className={`font-semibold truncate ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                  {participant.displayName}
                </p>
              </div>
              {getTypeBadge(participant.participantType)}
              {canManage && !rosterLocked && (
                <button
                  onClick={() => handleRemoveParticipant(participant.id, participant.displayName)}
                  disabled={removingId === participant.id}
                  className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full transition-colors ${
                    isDark 
                      ? 'hover:bg-red-500/20 text-red-400' 
                      : 'hover:bg-red-100 text-red-600'
                  } ${removingId === participant.id ? 'opacity-50' : ''}`}
                  aria-label={`Remove ${participant.displayName}`}
                >
                  {removingId === participant.id ? (
                    <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Icon name="close" className="text-xl" />
                  )}
                </button>
              )}
            </div>
          ))}

          {resourceType !== 'conference_room' && openSlotCount > 0 && canManage && (
            <>
              {placeholderParticipants.map((p, idx) => renderOpenSlot(idx, p.id))}
              {Array.from({ length: remainingSlots }, (_, idx) => renderOpenSlot(placeholderParticipants.length + idx))}
            </>
          )}

          {resourceType !== 'conference_room' && openSlotCount > 0 && !canManage && (
            <div className={`p-3 rounded-xl border-2 border-dashed text-center ${
              isDark ? 'border-white/20' : 'border-black/10'
            }`}>
              <p className={`text-sm ${isDark ? 'text-white/50' : 'text-[#293515]/50'}`}>
                {openSlotCount} slot{openSlotCount > 1 ? 's' : ''} available
              </p>
            </div>
          )}
        </div>

        {feePreview && (
          <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10 bg-white/[0.02]' : 'border-black/5 bg-black/[0.01]'}`}>
            <h4 className={`text-[11px] font-semibold uppercase tracking-[0.2em] mb-3 ${isDark ? 'text-white/80' : 'text-[#293515]/80'}`} style={{ fontFamily: 'var(--font-label)' }}>
              Time Allocation
            </h4>
            
            <div className="space-y-2">
              {feePreview.timeAllocation.allocations.map((alloc, idx) => {
                const isGuestWithPass = alloc.type === 'guest' && alloc.guestPassUsed;
                const isGuestWithFee = alloc.type === 'guest' && !alloc.guestPassUsed && (alloc.feeCents ?? 0) > 0;
                const isPlaceholder = isPlaceholderName(alloc.displayName);

                return (
                  <div key={idx} className="flex items-center justify-between">
                    <span className={`text-sm flex items-center gap-1.5 ${isDark ? 'text-white/60' : 'text-[#293515]/60'}`}>
                      {isGuestWithPass && (
                        <Icon name="confirmation_number" className={`text-sm ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                      )}
                      {isPlaceholder ? 'Guest (info pending)' : alloc.displayName}
                      {isGuestWithPass && (
                        <span className={`text-xs ${isDark ? 'text-emerald-400/70' : 'text-emerald-600/70'}`}>
                          (pass)
                        </span>
                      )}
                      {isGuestWithFee && (
                        <span className={`text-xs ${isDark ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
                          (${guestFeeDollars.toFixed(0)} fee)
                        </span>
                      )}
                    </span>
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                      {alloc.minutes} min
                    </span>
                  </div>
                );
              })}
              
              {(() => {
                const declaredCount = feePreview.timeAllocation.declaredPlayerCount || apiDeclaredPlayerCount;
                const filledCount = feePreview.timeAllocation.allocations.length;
                const unfilledCount = Math.max(0, declaredCount - filledCount);
                const minutesPerSlot = feePreview.timeAllocation.minutesPerParticipant;
                
                return Array.from({ length: unfilledCount }, (_, idx) => (
                  <div key={`open-${idx}`} className="flex items-center justify-between">
                    <span className={`text-sm italic ${isDark ? 'text-white/40' : 'text-[#293515]/40'}`}>
                      Guest (info pending)
                    </span>
                    <span className={`text-sm font-medium ${isDark ? 'text-white/40' : 'text-[#293515]/40'}`}>
                      {minutesPerSlot} min
                    </span>
                  </div>
                ));
              })()}
              
              <div className={`pt-2 mt-2 border-t ${isDark ? 'border-white/10' : 'border-black/5'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${isDark ? 'text-white/60' : 'text-[#293515]/60'}`}>
                    Total Session
                  </span>
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                    {feePreview.timeAllocation.totalMinutes} min
                  </span>
                </div>
              </div>

              {feePreview.ownerFees.dailyAllowance > 0 && feePreview.ownerFees.dailyAllowance < 999 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${isDark ? 'text-white/60' : 'text-[#293515]/60'}`}>
                      {feePreview.ownerFees.minutesWithinAllowance < feePreview.ownerFees.dailyAllowance
                        ? `Included (${feePreview.ownerFees.minutesWithinAllowance} of ${feePreview.ownerFees.dailyAllowance} remaining)`
                        : 'Included (daily)'}
                    </span>
                    <span className={`text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                      {feePreview.ownerFees.minutesWithinAllowance} min
                    </span>
                  </div>
                  
                  {feePreview.ownerFees.overageMinutes > 0 && (
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        Overage
                        {overageRatePerBlockDollars > 0 && (
                          <span className="text-xs opacity-70 ml-1">
                            ({Math.ceil(feePreview.ownerFees.overageMinutes / 30)} × ${overageRatePerBlockDollars.toFixed(0)})
                          </span>
                        )}
                      </span>
                      <span className={`text-sm font-medium ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        {feePreview.ownerFees.overageMinutes} min
                      </span>
                    </div>
                  )}
                  
                  {feePreview.ownerFees.estimatedOverageFee > 0 && (
                    <div className={`flex items-center justify-between pt-2 border-t ${isDark ? 'border-white/10' : 'border-black/5'}`}>
                      <span className={`text-sm font-semibold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        Est. Overage Fee
                      </span>
                      <span className={`text-sm font-bold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        ${feePreview.ownerFees.estimatedOverageFee.toFixed(2)}
                      </span>
                    </div>
                  )}
                </>
              )}

              {showPayableUnpaidFees && (
                <div className={`mt-4 pt-4 border-t ${isDark ? 'border-white/10' : 'border-black/5'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                        Estimated Fees
                      </p>
                      <p className={`text-xs ${isDark ? 'text-white/50' : 'text-[#293515]/50'}`}>
                        {(feePreview?.ownerFees?.estimatedOverageFee ?? 0) > 0 && `$${feePreview?.ownerFees?.estimatedOverageFee?.toFixed(2)} overage`}
                        {(feePreview?.ownerFees?.estimatedOverageFee ?? 0) > 0 && (feePreview?.ownerFees?.estimatedGuestFees ?? 0) > 0 && ' + '}
                        {(feePreview?.ownerFees?.estimatedGuestFees ?? 0) > 0 && `$${feePreview?.ownerFees?.estimatedGuestFees?.toFixed(2)} guest fees`}
                      </p>
                    </div>
                    <span className={`text-lg font-bold ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                      ${totalEstimatedFees.toFixed(2)}
                    </span>
                  </div>
                  {(booking?.status === 'confirmed' || booking?.status === 'approved') ? (
                    <button
                      onClick={() => {
                        haptic.light();
                        setShowPaymentModal(true);
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-primary text-white font-semibold text-sm transition-interactive hover:bg-primary/90 active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <Icon name="credit_card" className="text-lg" />
                      Pay Now
                    </button>
                  ) : (
                    <p className={`text-xs text-center ${isDark ? 'text-white/50' : 'text-[#293515]/50'}`}>
                      Pay now or at check-in once booking is approved
                    </p>
                  )}
                </div>
              )}

              {showEmptySlotEstimate && (
                <div className={`mt-4 pt-4 border-t ${isDark ? 'border-white/10' : 'border-black/5'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-sm font-semibold ${isDark ? 'text-amber-600' : 'text-amber-600'}`}>
                        Estimated Fees
                      </p>
                      <p className={`text-xs ${isDark ? 'text-white/50' : 'text-[#293515]/50'}`}>
                        Assign players or pay at check-in
                      </p>
                    </div>
                    <span className={`text-lg font-bold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                      ${totalEstimatedFees.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {showFeesPaid && (
                <div className={`mt-4 pt-4 border-t ${isDark ? 'border-white/10' : 'border-black/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name="check_circle" className={`text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`} />
                      <span className={`text-sm font-semibold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                        Fees Paid
                      </span>
                    </div>
                    <span className={`text-lg font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                      ${totalEstimatedFees.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      <ModalShell
        isOpen={showAddMemberModal}
        onClose={() => { setShowAddMemberModal(false); setReplacingPlaceholderId(null); }}
        title="Add Member"
        size="md"
      >
        <div className="p-4 space-y-4">
          <MemberSearchInput
            forceApiSearch
            privacyMode
            showTier
            excludeIds={existingUserIds}
            onSelect={handleAddMember}
            placeholder="Search by name or email..."
            label="Search Members"
            autoFocus
            disabled={addingMember}
          />
        </div>
      </ModalShell>

      <ModalShell
        isOpen={showConflictModal}
        onClose={() => {
          setShowConflictModal(false);
          setConflictDetails(null);
        }}
        title="Booking Conflict"
        size="sm"
      >
        <div className="p-4 space-y-4">
          <div className={`flex items-center gap-3 p-4 rounded-xl ${
            isDark ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200'
          }`}>
            <Icon name="warning" className={`text-3xl ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`font-semibold ${isDark ? 'text-white' : 'text-[#293515]'}`}>
                {conflictDetails?.memberName || 'This member'} already has a booking
              </p>
              <p className={`text-sm ${isDark ? 'text-white/60' : 'text-[#293515]/60'}`}>
                They cannot be added to this session due to a time conflict.
              </p>
            </div>
          </div>

          {conflictDetails?.conflictingBooking && (
            <div className={`p-4 rounded-xl ${isDark ? 'bg-white/5' : 'bg-black/[0.02]'}`}>
              <h4 className={`text-sm font-bold mb-2 ${isDark ? 'text-white/80' : 'text-[#293515]/80'}`}>
                Conflicting Booking Details
              </h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon name="calendar_today" className={`text-lg ${isDark ? 'text-white/40' : 'text-[#293515]/40'}`} />
                  <span className={`text-sm ${isDark ? 'text-white/80' : 'text-[#293515]/80'}`}>
                    {conflictDetails.conflictingBooking.date}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Icon name="schedule" className={`text-lg ${isDark ? 'text-white/40' : 'text-[#293515]/40'}`} />
                  <span className={`text-sm ${isDark ? 'text-white/80' : 'text-[#293515]/80'}`}>
                    {conflictDetails.conflictingBooking.startTime} - {conflictDetails.conflictingBooking.endTime}
                  </span>
                </div>
                {conflictDetails.conflictingBooking.resourceName && (
                  <div className="flex items-center gap-2">
                    <Icon name="sports_golf" className={`text-lg ${isDark ? 'text-white/40' : 'text-[#293515]/40'}`} />
                    <span className={`text-sm ${isDark ? 'text-white/80' : 'text-[#293515]/80'}`}>
                      {conflictDetails.conflictingBooking.resourceName}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setShowConflictModal(false);
              setConflictDetails(null);
            }}
            className="w-full py-3 px-4 rounded-xl bg-[#293515] text-white font-bold text-sm transition-interactive duration-fast hover:bg-[#3a4a20] active:scale-[0.98]"
          >
            Understood
          </button>
        </div>
      </ModalShell>

      {booking?.sessionId && (
        <MemberPaymentModal
          isOpen={showPaymentModal}
          bookingId={bookingId}
          sessionId={booking.sessionId}
          ownerEmail={booking.ownerEmail}
          ownerName={booking.ownerName}
          onSuccess={handlePaymentSuccess}
          onClose={() => setShowPaymentModal(false)}
        />
      )}

      <SlideUpDrawer
        isOpen={showGuestInfoDrawer}
        onClose={() => { setShowGuestInfoDrawer(false); setReplacingPlaceholderId(null); }}
        title="Guest Details"
        maxHeight="medium"
      >
        <div className="p-4 space-y-4">
          {guestPassError && (
            <div className={`p-3 rounded-xl flex items-start gap-2.5 ${
              isDark ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-amber-50 border border-amber-200/60'
            }`}>
              <Icon name="info" className={`text-base mt-0.5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
              <p className={`text-sm ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{guestPassError}</p>
            </div>
          )}

          <div className={`p-3 rounded-xl ${isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-200/60'}`}>
            <div className="flex items-center gap-2">
              <Icon name="confirmation_number" className={`text-lg ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
              <p className={`text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                Using Guest Pass ({guestPassesRemaining} remaining)
              </p>
            </div>
          </div>

          <Input
            label="First Name"
            placeholder="Enter first name"
            value={guestFirstName}
            onChange={(e) => setGuestFirstName(e.target.value)}
            icon="person"
          />

          <Input
            label="Last Name"
            placeholder="Enter last name"
            value={guestLastName}
            onChange={(e) => setGuestLastName(e.target.value)}
            icon="person"
          />

          <Input
            label="Guest Email"
            placeholder="Enter guest's email"
            type="email"
            value={guestEmail}
            onChange={handleGuestEmailChange}
            onBlur={() => {
              if (guestEmail.trim()) {
                setGuestEmailError(validateGuestEmail(guestEmail));
              }
            }}
            icon="mail"
            error={guestEmailError}
            required
          />

          <button
            onClick={handleUseGuestPass}
            disabled={!guestInfoValid || guestPassLoading}
            className={`relative w-full py-3 px-4 rounded-xl font-semibold text-sm transition-colors duration-fast flex items-center justify-center gap-2 ${
              guestInfoValid && !guestPassLoading
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]'
                : isDark
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-black/5 text-black/30 cursor-not-allowed'
            }`}
          >
            <span className={`flex items-center gap-2 transition-opacity ${guestPassLoading ? 'opacity-0' : 'opacity-100'}`}>
              <Icon name="confirmation_number" className="text-lg" />
              Use Guest Pass
            </span>
            {guestPassLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>
        </div>
      </SlideUpDrawer>
    </>
  );
};

export default RosterManager;
