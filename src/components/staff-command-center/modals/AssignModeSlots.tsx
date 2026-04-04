import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MemberSearchInput, SelectedMember } from '../../shared/MemberSearchInput';
import type { SlotState, SlotsArray, VisitorSearchResult } from './bookingSheetTypes';
import Icon from '../../icons/Icon';
import { isStaffTier } from '../../../utils/tierUtils';
import { springPresets } from '../../../utils/motion';

const slotVariants = {
  initial: { opacity: 0, scale: 0.95, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: springPresets.listItem },
  exit: { opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.15 } },
};

const buttonTap = { scale: 0.97 };
const buttonSpring = springPresets.buttonPress;

interface DayPassInfo {
  id: string;
  remainingUses: number;
  purchaserEmail: string;
  purchaserFirstName: string;
  purchaserLastName: string;
  purchasedAt?: string;
}

interface AssignModeSlotsProps {
  slots: SlotsArray;
  activeSlotIndex: number | null;
  setActiveSlotIndex: (index: number | null) => void;
  showAddVisitor: boolean;
  setShowAddVisitor: (show: boolean) => void;
  visitorData: { firstName: string; lastName: string; email: string; visitorType: string };
  setVisitorData: (data: { firstName: string; lastName: string; email: string; visitorType: string }) => void;
  isCreatingVisitor: boolean;
  visitorSearch: string;
  setVisitorSearch: (search: string) => void;
  visitorSearchResults: VisitorSearchResult[];
  isSearchingVisitors: boolean;
  potentialDuplicates: Array<{id: string; email: string; name: string}>;
  isCheckingDuplicates: boolean;
  guestFeeDollars: number;
  isLessonOrStaffBlock: boolean;
  isConferenceRoom: boolean;
  filledSlotsCount: number;
  guestCount: number;
  updateSlot: (index: number, slotState: SlotState) => void;
  clearSlot: (index: number) => void;
  handleMemberSelect: (member: SelectedMember, slotIndex: number) => void;
  handleAddGuestPlaceholder: (slotIndex: number) => void;
  handleSelectExistingVisitor: (visitor: VisitorSearchResult) => void;
  handleCreateVisitorAndAssign: () => Promise<void>;
  renderTierBadge: (tier: string | null | undefined, membershipStatus?: string | null) => React.ReactNode;
  dayPassSelections?: Record<number, string | null>;
  dayPassesBySlot?: Record<number, DayPassInfo[]>;
  isLoadingDayPasses?: boolean;
  toggleDayPassForSlot?: (slotIndex: number, dayPassId: string | null) => void;
  sessionDurationMinutes?: number;
}

export function AssignModeSlots({
  slots,
  activeSlotIndex,
  setActiveSlotIndex,
  showAddVisitor,
  setShowAddVisitor,
  visitorData,
  setVisitorData,
  isCreatingVisitor,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitorSearch,
  setVisitorSearch,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitorSearchResults,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isSearchingVisitors,
  potentialDuplicates,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isCheckingDuplicates,
  guestFeeDollars,
  isLessonOrStaffBlock,
  isConferenceRoom,
  filledSlotsCount,
  guestCount,
  updateSlot,
  clearSlot,
  handleMemberSelect,
  handleAddGuestPlaceholder,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleSelectExistingVisitor,
  handleCreateVisitorAndAssign,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderTierBadge,
  dayPassSelections,
  dayPassesBySlot,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isLoadingDayPasses,
  toggleDayPassForSlot,
  sessionDurationMinutes,
}: AssignModeSlotsProps) {
  const renderSlotInner = (slotIndex: number, isOwnerSlot: boolean) => {
    const slot = slots[slotIndex];
    const isActive = activeSlotIndex === slotIndex;
    
    if (slot.type !== 'empty') {
      return (
        <motion.div
          key={`filled-${slotIndex}`}
          variants={slotVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          layout
          className={`p-3 rounded-xl border ${isOwnerSlot ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                slot.type === 'guest_placeholder' ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-green-100 dark:bg-green-900/40'
              }`}>
                <Icon name={slot.type === 'guest_placeholder' ? 'person_add' : 'person'} className={`text-sm ${ slot.type === 'guest_placeholder' ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400' }`} />
              </div>
              <div>
                <p className="font-medium text-sm text-primary dark:text-white">
                  {slot.type === 'guest_placeholder' ? slot.guestName : slot.member?.name}
                </p>
                {slot.member?.email && (
                  <p className="text-xs text-primary/60 dark:text-white/60">{slot.member.email}</p>
                )}
                {isStaffTier(slot.member?.tier) ? (
                  <p className="text-xs text-blue-600 dark:text-blue-400">$0.00 — Staff — included</p>
                ) : slot.type === 'guest_placeholder' ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{`Guest fee: $${guestFeeDollars}`}</p>
                ) : null}
              </div>
            </div>
            <button
              onClick={() => clearSlot(slotIndex)}
              className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
              title="Remove"
            >
              <Icon name="close" className="text-sm" />
            </button>
          </div>
          {!isConferenceRoom && toggleDayPassForSlot && slot.type !== 'guest_placeholder' && (() => {
            const slotPasses = dayPassesBySlot?.[slotIndex];
            if (!slotPasses || slotPasses.length === 0) return null;
            const selectedPassId = dayPassSelections?.[slotIndex];
            const isSelected = !!selectedPassId;
            const activePass = isSelected ? slotPasses.find(p => p.id === selectedPassId) || slotPasses[0] : slotPasses[0];
            const totalRemaining = slotPasses.reduce((sum, p) => sum + p.remainingUses, 0);
            const otherSelectedFromSamePass = Object.entries(dayPassSelections || {})
              .filter(([idx, passId]) => passId && Number(idx) !== slotIndex && slotPasses.some(p => p.id === passId))
              .length;
            const canSelect = isSelected || (totalRemaining - otherSelectedFromSamePass) > 0;
            const purchaseDate = activePass.purchasedAt ? new Date(activePass.purchasedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
            const playerCount = slots.filter(s => s.type !== 'empty').length || 1;
            const perPlayerMinutes = sessionDurationMinutes ? Math.floor(sessionDurationMinutes / playerCount) : 60;
            const isShortSession = perPlayerMinutes < 60;
            return (
              <div className="mt-2 pt-2 border-t border-green-200/50 dark:border-green-700/50">
                <label className={`flex items-center gap-2 ${canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!canSelect && !isSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        toggleDayPassForSlot(slotIndex, activePass.id);
                      } else {
                        toggleDayPassForSlot(slotIndex, null);
                      }
                    }}
                    className="w-4 h-4 rounded border-green-300 text-green-600 focus:ring-green-500"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                      Redeem Day Pass (60 min covered)
                    </span>
                    <span className="text-[10px] text-green-600/70 dark:text-green-400/70">
                      {activePass.purchaserFirstName} {activePass.purchaserLastName}
                      {purchaseDate ? ` · Purchased ${purchaseDate}` : ''}
                      {' · '}{totalRemaining - otherSelectedFromSamePass} of {totalRemaining} use{totalRemaining !== 1 ? 's' : ''} left
                    </span>
                    {isShortSession && isSelected && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                        This slot is only {perPlayerMinutes} min — pass covers 60 min ({60 - perPlayerMinutes} min unused)
                      </span>
                    )}
                  </div>
                </label>
                {slotPasses.length > 1 && (
                  <select
                    className="mt-1 text-[10px] w-full border border-green-200 dark:border-green-700 rounded px-1 py-0.5 bg-white dark:bg-gray-800 text-green-700 dark:text-green-400"
                    value={selectedPassId || activePass.id}
                    onChange={(e) => toggleDayPassForSlot(slotIndex, e.target.value)}
                  >
                    {slotPasses.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.purchaserFirstName} {p.purchaserLastName} — {p.remainingUses} use{p.remainingUses !== 1 ? 's' : ''} left
                        {p.purchasedAt ? ` (${new Date(p.purchasedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })()}
        </motion.div>
      );
    }

    if (isActive) {
      if (showAddVisitor) {
        return (
          <motion.div
            key={`visitor-${slotIndex}`}
            variants={slotVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="p-3 rounded-xl border border-green-200 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm text-primary dark:text-white">Create New Visitor</h4>
              <button
                onClick={() => {
                  setShowAddVisitor(false);
                  setVisitorData({ firstName: '', lastName: '', email: '', visitorType: 'guest' });
                  setVisitorSearch('');
                }}
                className="text-primary/50 dark:text-white/50 hover:text-primary dark:hover:text-white"
              >
                <Icon name="close" className="text-sm" />
              </button>
            </div>

            <div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="First Name *"
                    value={visitorData.firstName}
                    onChange={(e) => setVisitorData({ ...visitorData, firstName: e.target.value })}
                    className="px-2 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/50 dark:placeholder:text-white/50 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Last Name *"
                    value={visitorData.lastName}
                    onChange={(e) => setVisitorData({ ...visitorData, lastName: e.target.value })}
                    className="px-2 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/50 dark:placeholder:text-white/50 text-xs"
                  />
                </div>
                <input
                  type="email"
                  placeholder="Email Address *"
                  value={visitorData.email}
                  onChange={(e) => setVisitorData({ ...visitorData, email: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-primary/20 dark:border-white/20 text-primary dark:text-white placeholder:text-primary/50 dark:placeholder:text-white/50 text-xs"
                />
                <div className="px-1 py-1 rounded-lg bg-primary/5 dark:bg-white/5">
                  <p className="text-xs text-primary/60 dark:text-white/60">
                    <Icon name="info" className="text-xs mr-0.5" />
                    {activeSlotIndex === 0
                      ? 'Will be created as Day Pass (Slot 1 owner)'
                      : 'Will be created as Member Guest'}
                  </p>
                </div>
              </div>
            </div>

            {potentialDuplicates.length > 0 && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-1">
                  <Icon name="warning" className="text-sm" />
                  Possible duplicate found
                </p>
                <div className="space-y-1">
                  {potentialDuplicates.map((dup) => (
                    <button
                      key={dup.id}
                      onClick={() => {
                        if (activeSlotIndex !== null) {
                          updateSlot(activeSlotIndex, {
                            type: 'visitor',
                            member: { id: dup.id, email: dup.email, name: dup.name }
                          });
                          setShowAddVisitor(false);
                          setVisitorData({ firstName: '', lastName: '', email: '', visitorType: '' });
                          setActiveSlotIndex(null);
                        }
                      }}
                      className="tactile-btn w-full p-1.5 text-left rounded-lg bg-white dark:bg-white/5 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors border border-amber-200 dark:border-amber-500/20"
                    >
                      <p className="text-xs font-medium text-primary dark:text-white">{dup.name}</p>
                      <p className="text-xs text-primary/60 dark:text-white/60">{dup.email}</p>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Click to use existing record instead</p>
              </div>
            )}

            <motion.button
              whileTap={buttonTap}
              transition={buttonSpring}
              onClick={handleCreateVisitorAndAssign}
              disabled={!visitorData.email || !visitorData.firstName || !visitorData.lastName || isCreatingVisitor}
              className="tactile-btn w-full py-2 px-3 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
            >
              {isCreatingVisitor ? (
                <>
                  <Icon name="progress_activity" className="animate-spin text-sm" />
                  Creating...
                </>
              ) : (
                <>
                  <Icon name="add_circle" className="text-sm" />
                  Create & Add
                </>
              )}
            </motion.button>
          </motion.div>
        );
      }

      return (
        <motion.div
          key={`active-${slotIndex}`}
          variants={slotVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="p-3 rounded-xl border border-primary/20 dark:border-white/20 bg-white/50 dark:bg-white/5 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-primary/60 dark:text-white/60">
              {isOwnerSlot ? 'Select Owner (Required)' : `Player ${slotIndex + 1}`}
            </span>
            <button
              onClick={() => setActiveSlotIndex(null)}
              className="text-primary/50 dark:text-white/50 hover:text-primary dark:hover:text-white"
            >
              <Icon name="close" className="text-sm" />
            </button>
          </div>
          
          <MemberSearchInput
            placeholder="Search..."
            onSelect={(member) => handleMemberSelect(member, slotIndex)}
            showTier={true}
            autoFocus={true}
            includeVisitors={true}
          />
          
          <div className="flex gap-2 pt-1">
            {!isOwnerSlot && (
              <motion.button
                whileTap={buttonTap}
                transition={buttonSpring}
                onClick={() => handleAddGuestPlaceholder(slotIndex)}
                className="tactile-btn flex-1 py-1.5 px-2 rounded-lg border border-amber-500 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-1"
              >
                <Icon name="person_add" className="text-sm" />
                Add Guest
              </motion.button>
            )}
            <motion.button
              whileTap={buttonTap}
              transition={buttonSpring}
              onClick={() => setShowAddVisitor(true)}
              className="tactile-btn flex-1 py-1.5 px-2 rounded-lg border border-green-500 text-green-600 dark:text-green-400 text-xs font-medium hover:bg-green-50 dark:hover:bg-green-500/10 transition-colors flex items-center justify-center gap-1"
            >
              <Icon name="person_add" className="text-sm" />
              New Visitor
            </motion.button>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.button
        key={`empty-${slotIndex}`}
        variants={slotVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        whileTap={buttonTap}
        onClick={() => setActiveSlotIndex(slotIndex)}
        className={`tactile-btn w-full p-3 rounded-xl border-2 border-dashed transition-colors text-left ${
          isOwnerSlot 
            ? 'border-amber-300 dark:border-amber-600 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-900/10'
            : 'border-primary/20 dark:border-white/20 hover:border-primary/40 dark:hover:border-white/40 hover:bg-primary/5 dark:hover:bg-white/5'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isOwnerSlot ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-primary/10 dark:bg-white/10'
          }`}>
            <Icon name="add" className={`text-sm ${ isOwnerSlot ? 'text-amber-600 dark:text-amber-400' : 'text-primary/40 dark:text-white/40' }`} />
          </div>
          <div>
            <p className={`font-medium text-sm ${isOwnerSlot ? 'text-amber-700 dark:text-amber-400' : 'text-primary/60 dark:text-white/60'}`}>
              {isOwnerSlot ? 'Add Owner (Required)' : `Add Player ${slotIndex + 1}`}
            </p>
            <p className="text-xs text-primary/40 dark:text-white/40">
              {isOwnerSlot ? 'Search member or add visitor' : 'Member or guest'}
            </p>
          </div>
        </div>
      </motion.button>
    );
  };

  const renderSlot = (slotIndex: number, isOwnerSlot: boolean) => (
    <AnimatePresence mode="wait">
      {renderSlotInner(slotIndex, isOwnerSlot)}
    </AnimatePresence>
  );

  if (isConferenceRoom) {
    return (
      <div className="space-y-3">
        <h4 className="font-medium text-primary dark:text-white">Assign To</h4>
        <div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-1 font-medium">Owner (Required)</p>
          {renderSlot(0, true)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-primary dark:text-white">Player Slots</h4>
        {filledSlotsCount > 0 && (
          <span className="text-xs text-primary/60 dark:text-white/60">
            {filledSlotsCount} player{filledSlotsCount !== 1 ? 's' : ''}
            {guestCount > 0 && ` (${guestCount} guest${guestCount !== 1 ? 's' : ''} = $${guestCount * guestFeeDollars})`}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-1 font-medium">Slot 1: Owner (Required)</p>
          {renderSlot(0, true)}
        </div>
        
        {!isLessonOrStaffBlock && (
          <div className="border-t border-primary/10 dark:border-white/10 pt-2">
            <p className="text-xs text-primary/50 dark:text-white/50 mb-1">Additional Players (Optional)</p>
            <div className="space-y-2">
              {[1, 2, 3].map(index => (
                <div key={index}>
                  {renderSlot(index, false)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!isLessonOrStaffBlock && slots.slice(1).some(s => s.type === 'empty') && (
        <motion.button
          whileTap={buttonTap}
          transition={buttonSpring}
          onClick={() => {
            const emptyIndex = slots.findIndex((s, i) => i > 0 && s.type === 'empty');
            if (emptyIndex > 0) handleAddGuestPlaceholder(emptyIndex);
          }}
          className="tactile-btn w-full py-2 px-3 rounded-lg border-2 border-dashed border-amber-300 dark:border-amber-600 text-amber-600 dark:text-amber-400 font-medium text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center justify-center gap-2"
        >
          <Icon name="person_add" className="text-sm" />
          {`Quick Add Guest (+$${guestFeeDollars})`}
        </motion.button>
      )}
    </div>
  );
}
