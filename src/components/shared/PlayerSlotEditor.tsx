import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { MemberSearchInput, SelectedMember } from './MemberSearchInput';
import { fetchWithCredentials } from '../../hooks/queries/useFetch';
import Icon from '../icons/Icon';

export interface PlayerSlot {
  id: string;
  email: string;
  emailRedacted?: string;
  name: string;
  firstName: string;
  lastName: string;
  type: 'member' | 'guest';
  searchQuery: string;
  selectedId?: string;
  selectedName?: string;
}

interface FrequentPartner {
  id: string;
  name: string;
  email?: string;
  emailRedacted?: string;
  firstName?: string;
  lastName?: string;
  tier?: string;
  type: 'member' | 'guest';
  frequency: number;
}

export interface PlayerSlotEditorProps {
  playerCount: number;
  onPlayerCountChange: (count: number) => void;
  slots: PlayerSlot[];
  onSlotsChange: (slots: PlayerSlot[]) => void;
  guestPassesRemaining?: number;
  isDark?: boolean;
  privacyMode?: boolean;
  maxPlayers?: number;
  showPlayerCountSelector?: boolean;
  ownerMemberId?: string;
}

const PlayerSlotEditor: React.FC<PlayerSlotEditorProps> = ({
  playerCount,
  onPlayerCountChange,
  slots,
  onSlotsChange,
  guestPassesRemaining,
  isDark = true,
  privacyMode = true,
  maxPlayers = 4,
  showPlayerCountSelector = true,
  ownerMemberId,
}) => {
  const [wrapperRef] = useAutoAnimate();
  const [slotListRef] = useAutoAnimate();
  const playerCounts = Array.from({ length: maxPlayers }, (_, i) => i + 1);
  const labels: Record<number, string> = { 1: 'Solo', 2: 'Duo', 3: 'Trio', 4: 'Four' };

  const [frequentPartners, setFrequentPartners] = useState<FrequentPartner[]>([]);

  useEffect(() => {
    if (!ownerMemberId) return;
    let cancelled = false;
    const params = ownerMemberId ? `?userId=${encodeURIComponent(ownerMemberId)}` : '';
    fetchWithCredentials<FrequentPartner[]>(`/api/members/frequent-partners${params}`)
      .then(data => { if (!cancelled) setFrequentPartners(data); })
      .catch((err) => {
        console.warn('[PlayerSlotEditor] Failed to fetch frequent partners:', err);
      });
    return () => { cancelled = true; };
  }, [ownerMemberId]);

  const updateSlot = useCallback((index: number, updates: Partial<PlayerSlot>) => {
    const newSlots = [...slots];
    newSlots[index] = { ...newSlots[index], ...updates };
    onSlotsChange(newSlots);
  }, [slots, onSlotsChange]);

  const handleTypeChange = useCallback((index: number, type: 'member' | 'guest') => {
    const newSlots = [...slots];
    newSlots[index] = { ...newSlots[index], type, searchQuery: '', selectedId: undefined, selectedName: undefined, email: '', name: '', firstName: '', lastName: '' };
    onSlotsChange(newSlots);
  }, [slots, onSlotsChange]);

  const handleClearSelection = useCallback((index: number) => {
    const newSlots = [...slots];
    newSlots[index] = { ...newSlots[index], selectedId: undefined, selectedName: undefined, searchQuery: '', email: '', name: '', firstName: '', lastName: '' };
    onSlotsChange(newSlots);
  }, [slots, onSlotsChange]);

  const handleMemberSelect = useCallback((index: number, member: SelectedMember) => {
    const newSlots = [...slots];
    newSlots[index] = {
      ...newSlots[index],
      selectedId: member.id,
      selectedName: member.name,
      searchQuery: member.name,
      email: member.email,
      emailRedacted: member.emailRedacted,
      name: member.name,
    };
    onSlotsChange(newSlots);
  }, [slots, onSlotsChange]);

  const handlePartnerSelect = useCallback((partner: FrequentPartner) => {
    const emptyIndex = slots.findIndex(s => !s.selectedId && s.firstName.trim() === '' && s.lastName.trim() === '' && s.email.trim() === '');
    if (emptyIndex === -1) return;

    const newSlots = [...slots];
    if (partner.type === 'member') {
      newSlots[emptyIndex] = {
        ...newSlots[emptyIndex],
        type: 'member',
        selectedId: partner.id,
        selectedName: partner.name,
        searchQuery: partner.name,
        email: partner.email || '',
        emailRedacted: partner.emailRedacted,
        name: partner.name,
      };
    } else {
      newSlots[emptyIndex] = {
        ...newSlots[emptyIndex],
        type: 'guest',
        firstName: partner.firstName || partner.name.split(' ')[0] || '',
        lastName: partner.lastName || partner.name.split(' ').slice(1).join(' ') || '',
        email: partner.email || '',
        name: partner.name,
        selectedId: partner.id,
        selectedName: partner.name,
      };
    }
    onSlotsChange(newSlots);
  }, [slots, onSlotsChange]);

  const excludeIdsForSlot = useMemo(() => {
    const selectedIds = slots
      .filter(s => s.selectedId)
      .map(s => s.selectedId!);
    if (ownerMemberId) {
      selectedIds.push(ownerMemberId);
    }
    return selectedIds;
  }, [slots, ownerMemberId]);

  const availablePartners = useMemo(() => {
    const selectedEmails = new Set(slots.filter(s => s.email).map(s => s.email.toLowerCase()));
    const selectedIds = new Set(excludeIdsForSlot);
    return frequentPartners.filter(p => {
      if (selectedIds.has(p.id)) return false;
      if (p.email && selectedEmails.has(p.email.toLowerCase())) return false;
      return true;
    });
  }, [frequentPartners, slots, excludeIdsForSlot]);

  const hasEmptySlot = slots.some(s => !s.selectedId && s.firstName.trim() === '' && s.lastName.trim() === '' && s.email.trim() === '');

  return (
    <div ref={wrapperRef} className="space-y-6">
      {showPlayerCountSelector && (
        <section className={`rounded-xl p-4 border glass-card ${isDark ? 'border-white/25' : 'border-black/10'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDark ? 'text-white/80' : 'text-primary/80'}`} style={{ fontFamily: 'var(--font-label)' }}>How many players?</span>
            </div>
          </div>
          <div className={`flex gap-2 p-1 rounded-xl border ${isDark ? 'bg-transparent border-white/15' : 'bg-black/5 border-black/5'}`}>
            {playerCounts.map(count => (
              <button
                key={count}
                onClick={() => onPlayerCountChange(count)}
                aria-pressed={playerCount === count}
                className={`flex-1 py-3 rounded-[4px] transition-interactive duration-fast active:scale-95 focus:ring-2 focus:ring-accent focus:outline-none ${
                  playerCount === count
                    ? (isDark ? 'bg-white text-primary' : 'bg-primary text-white')
                    : (isDark ? 'text-white/80 hover:bg-white/5 hover:text-white' : 'text-primary/80 hover:bg-black/5 hover:text-primary')
                }`}
              >
                <div className="text-lg font-bold">{count}</div>
                <div className="text-[10px] opacity-70">{labels[count] || count}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {slots.length > 0 && (
      <section className={`rounded-xl border glass-card relative z-10 p-4 ${isDark ? 'border-white/25' : 'border-black/10'}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDark ? 'text-white/80' : 'text-primary/80'}`} style={{ fontFamily: 'var(--font-label)' }}>Additional Players</span>
              <span className={`text-xs ${isDark ? 'text-white/50' : 'text-primary/50'}`}>(Optional)</span>
            </div>

            <div className={`mb-3 p-3 rounded-lg text-sm ${isDark ? 'bg-blue-500/10 border border-blue-500/30 text-blue-300' : 'bg-blue-50 border border-blue-200 text-blue-700'}`}>
              <Icon name="info" className="text-sm mr-1" />
              Search and select each player below so staff can see who is in your group. Switch to Guest and provide their details to use your guest passes.
            </div>

            {availablePartners.length > 0 && hasEmptySlot && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="group" className={`text-sm ${isDark ? 'text-white/60' : 'text-primary/60'}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-[0.15em] ${isDark ? 'text-white/60' : 'text-primary/60'}`} style={{ fontFamily: 'var(--font-label)' }}>Recent Partners</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {availablePartners.map(partner => (
                    <button
                      key={partner.id}
                      type="button"
                      onClick={() => handlePartnerSelect(partner)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-transform duration-fast active:scale-95 border ${
                        partner.type === 'member'
                          ? isDark
                            ? 'bg-emerald-500/10 border-emerald-400/20 text-white/80 hover:bg-emerald-500/20 hover:border-emerald-400/30'
                            : 'bg-emerald-50 border-emerald-200 text-primary/80 hover:bg-emerald-100 hover:border-emerald-300'
                          : isDark
                            ? 'bg-amber-500/10 border-amber-400/20 text-white/80 hover:bg-amber-500/20 hover:border-amber-400/30'
                            : 'bg-amber-50 border-amber-200 text-primary/80 hover:bg-amber-100 hover:border-amber-300'
                      }`}
                    >
                      <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold leading-none ${
                        partner.type === 'member'
                          ? isDark ? 'bg-emerald-400/25 text-emerald-300' : 'bg-emerald-200 text-emerald-700'
                          : isDark ? 'bg-amber-400/25 text-amber-300' : 'bg-amber-200 text-amber-700'
                      }`}>
                        {partner.type === 'member' ? 'M' : 'G'}
                      </span>
                      {partner.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

          <div ref={slotListRef} className="space-y-4">
            {slots.map((slot, index) => {
              const isGuestComplete = slot.type === 'guest' && slot.firstName.trim() !== '' && slot.lastName.trim() !== '' && slot.email.includes('@');
              const _isGuestIncomplete = slot.type === 'guest' && !slot.selectedId && (!slot.firstName.trim() || !slot.lastName.trim() || !slot.email.includes('@'));
              const showIndicator = slot.type === 'guest' && !slot.selectedId && (slot.firstName.trim() !== '' || slot.lastName.trim() !== '' || slot.email.trim() !== '');

              return (
                <div key={slot.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className={`text-sm font-medium ${isDark ? 'text-white/70' : 'text-primary/70'}`}>
                      Player {index + 2}
                    </label>
                    <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-white/20' : 'border-black/10'}`}>
                      <button
                        type="button"
                        onClick={() => handleTypeChange(index, 'member')}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors duration-fast ${
                          slot.type === 'member'
                            ? (isDark ? 'bg-white text-primary' : 'bg-primary text-white')
                            : (isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-black/5 text-primary/60 hover:bg-black/10')
                        }`}
                      >
                        Member
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTypeChange(index, 'guest')}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors duration-fast ${
                          slot.type === 'guest'
                            ? (isDark ? 'bg-white text-primary' : 'bg-primary text-white')
                            : (isDark ? 'bg-white/5 text-white/60 hover:bg-white/10' : 'bg-black/5 text-primary/60 hover:bg-black/10')
                        }`}
                      >
                        Guest
                      </button>
                    </div>
                  </div>
                  
                  <div className="relative">
                    {slot.type === 'member' && !slot.selectedId && (
                      <div className={`mb-1.5 flex items-center gap-1.5 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                        <Icon name="search" className="text-sm" />
                        Search and select a member to continue
                      </div>
                    )}
                    {slot.selectedId ? (
                      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${
                        isDark 
                          ? 'bg-white/10 border-white/20' 
                          : 'bg-primary/5 border-primary/20'
                      }`}>
                        <Icon name={slot.type === 'member' ? 'person' : 'person_add'} className={`text-lg ${isDark ? 'text-white/70' : 'text-primary/70'}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-primary'}`}>
                            {slot.selectedName}
                          </div>
                          <div className={`text-xs truncate ${isDark ? 'text-white/50' : 'text-primary/50'}`}>
                            {slot.email || slot.emailRedacted || ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleClearSelection(index)}
                          className={`p-1 rounded-full transition-colors tactile-btn ${
                            isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                          }`}
                        >
                          <Icon name="close" className="text-lg opacity-60" />
                        </button>
                      </div>
                    ) : slot.type === 'member' ? (
                      <MemberSearchInput
                        onSelect={(member) => handleMemberSelect(index, member)}
                        onClear={() => handleClearSelection(index)}
                        placeholder="Search members by name..."
                        privacyMode={privacyMode}
                        showTier={false}
                        forceApiSearch
                        excludeIds={excludeIdsForSlot}
                      />
                    ) : (
                      <div className="space-y-2">
                        <div className="flex gap-2 min-w-0">
                          <input
                            type="text"
                            placeholder="First name..."
                            value={slot.firstName}
                            onChange={(e) => updateSlot(index, { firstName: e.target.value, name: `${e.target.value} ${slot.lastName}`.trim() })}
                            className={`flex-1 min-w-0 px-3 py-2.5 rounded-lg border text-sm transition-colors duration-fast focus:ring-2 focus:ring-accent focus:outline-none ${
                              isDark 
                                ? 'bg-white/5 border-white/20 text-white placeholder:text-white/40' 
                                : 'bg-black/5 border-black/10 text-primary placeholder:text-primary/40'
                            }`}
                          />
                          <input
                            type="text"
                            placeholder="Last name..."
                            value={slot.lastName}
                            onChange={(e) => updateSlot(index, { lastName: e.target.value, name: `${slot.firstName} ${e.target.value}`.trim() })}
                            className={`flex-1 min-w-0 px-3 py-2.5 rounded-lg border text-sm transition-colors duration-fast focus:ring-2 focus:ring-accent focus:outline-none ${
                              isDark 
                                ? 'bg-white/5 border-white/20 text-white placeholder:text-white/40' 
                                : 'bg-black/5 border-black/10 text-primary placeholder:text-primary/40'
                            }`}
                          />
                        </div>
                        <input
                          type="email"
                          placeholder="Guest email..."
                          value={slot.email}
                          onChange={(e) => updateSlot(index, { email: e.target.value })}
                          className={`w-full px-3 py-2.5 rounded-lg border text-sm transition-colors duration-fast focus:ring-2 focus:ring-accent focus:outline-none ${
                            isDark 
                              ? 'bg-white/5 border-white/20 text-white placeholder:text-white/40' 
                              : 'bg-black/5 border-black/10 text-primary placeholder:text-primary/40'
                          }`}
                        />
                        {showIndicator && (
                          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                            isGuestComplete
                              ? (isDark ? 'text-green-400' : 'text-green-600')
                              : (isDark ? 'text-amber-400' : 'text-amber-600')
                          }`}>
                            <Icon name={isGuestComplete ? 'check_circle' : 'warning'} className="text-sm" />
                            {isGuestComplete ? 'Pass eligible' : 'Provide first name, last name & email to use pass'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {guestPassesRemaining !== undefined && (
            <div className={`mt-3 pt-3 border-t flex items-center justify-between ${isDark ? 'border-white/10' : 'border-black/5'}`}>
              <span className={`text-xs ${isDark ? 'text-white/50' : 'text-primary/50'}`}>Guest passes remaining</span>
              <span className={`text-xs font-semibold ${isDark ? 'text-white/70' : 'text-primary/70'}`}>{guestPassesRemaining}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default PlayerSlotEditor;
