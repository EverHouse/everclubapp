import React, { useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { haptic } from '../../../utils/haptics';
import { EmptySlots } from '../../../components/EmptyState';
import type { TimeSlot } from './bookGolfTypes';
import Icon from '../../../components/icons/Icon';
import { springPresets } from '../../../utils/motion';

interface HourGroup {
  hourLabel: string;
  hour24: string;
  slots: TimeSlot[];
  totalAvailable: number;
}

interface TimeSlotsSectionProps {
  slotsByHour: HourGroup[];
  selectedSlot: TimeSlot | null;
  setSelectedSlot: (s: TimeSlot | null) => void;
  setSelectedResource: (r: null) => void;
  expandedHour: string | null;
  setExpandedHour: (h: string | null) => void;
  isLoading: boolean;
  isDark: boolean;
  activeTab: 'simulator' | 'conference';
  dates: Array<{ label: string; date: string; day: string; dateNum: string }>;
  selectedDateObj: { date: string } | null;
  setSelectedDateObj: (d: { label: string; date: string; day: string; dateNum: string }) => void;
  timeSlotsRef: React.RefObject<HTMLDivElement | null>;
  timeSlotsAnimRef: React.RefObject<HTMLDivElement | null>;
}

const expandSpring = springPresets.sheet;
const slotStagger = springPresets.stiffQuick;

const TimeSlotsSection: React.FC<TimeSlotsSectionProps> = ({
  slotsByHour, selectedSlot, setSelectedSlot, setSelectedResource,
  expandedHour, setExpandedHour, isLoading, isDark, activeTab,
  dates, selectedDateObj, setSelectedDateObj, timeSlotsRef, timeSlotsAnimRef,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const noMotion = { duration: 0 };
  const [scrollingElement, setScrollingElement] = useState<HTMLElement | null>(null);
  const hasLoadedOnce = useRef(false);
  if (!isLoading) hasLoadedOnce.current = true;
  const showSkeleton = isLoading && !hasLoadedOnce.current;

  return (
    <section ref={timeSlotsRef} className="min-h-[120px]">
      <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-3 ${isDark ? 'text-white/80' : 'text-primary/80'}`} style={{ fontFamily: 'var(--font-label)' }}>Available Times</h3>

      {showSkeleton && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`h-14 rounded-xl animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          ))}
        </div>
      )}
      <div className={showSkeleton ? 'hidden' : ''}>
        <div ref={timeSlotsAnimRef} className="space-y-2">
          {slotsByHour.map((hourGroup) => {
            const isExpanded = expandedHour === hourGroup.hour24;
            const hasSelectedSlot = hourGroup.slots.some(s => selectedSlot?.id === s.id);

            return (
              <div key={hourGroup.hour24} className="scroll-mt-20">
                <button
                  id={`hour-trigger-${hourGroup.hour24}`}
                  onClick={(e) => {
                    haptic.light();
                    const isExpanding = !isExpanded;
                    setExpandedHour(isExpanding ? hourGroup.hour24 : null);
                    if (isExpanding) {
                      const el = e.currentTarget.parentElement;
                      if (el) setScrollingElement(el);
                    } else {
                      setScrollingElement(null);
                    }
                  }}
                  aria-expanded={isExpanded}
                  aria-controls={`hour-content-${hourGroup.hour24}`}
                  className={`w-full p-4 rounded-xl border text-left transition-transform duration-fast active:scale-[0.99] flex items-center justify-between ${
                    hasSelectedSlot
                      ? (isDark ? 'bg-white/10 border-white/30' : 'bg-primary/5 border-primary/20')
                      : isExpanded
                        ? (isDark ? 'border-white/20 bg-white/10' : 'bg-white border-black/20')
                        : (isDark ? 'bg-transparent border-white/15 hover:bg-white/5' : 'bg-white border-black/10 hover:bg-black/5')
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <motion.div
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={prefersReducedMotion ? noMotion : expandSpring}
                    >
                      <Icon name="chevron_right" className={`text-xl ${ hasSelectedSlot ? (isDark ? 'text-accent' : 'text-accent-dark') : (isDark ? 'text-white/80' : 'text-primary/80') }`} />
                    </motion.div>
                    <div>
                      <div className={`font-bold text-base ${hasSelectedSlot ? (isDark ? 'text-accent' : 'text-primary') : (isDark ? 'text-white' : 'text-primary')}`}>
                        {hourGroup.hourLabel}
                      </div>
                      <div className={`text-[10px] font-bold uppercase tracking-wide ${hasSelectedSlot ? 'text-accent-dark/80 dark:text-accent/80' : 'opacity-50'}`}>
                        {hourGroup.slots.length} {hourGroup.slots.length === 1 ? 'time' : 'times'} · {hourGroup.totalAvailable} {activeTab === 'simulator' ? 'bays' : 'rooms'}
                      </div>
                    </div>
                  </div>
                  {hasSelectedSlot && (
                    <Icon name="check_circle" className="text-accent-dark dark:text-accent" />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      id={`hour-content-${hourGroup.hour24}`}
                      role="region"
                      aria-labelledby={`hour-trigger-${hourGroup.hour24}`}
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      transition={prefersReducedMotion ? noMotion : expandSpring}
                      onAnimationComplete={() => {
                        if (scrollingElement) {
                          scrollingElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          setScrollingElement(null);
                        }
                      }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-2 pl-6">
                        {hourGroup.slots.map((slot, slotIndex) => {
                          const isRequestedOnly = !slot.available && slot.requestedResourceDbIds.length > 0;
                          if (isRequestedOnly) {
                            return (
                              <motion.button
                                disabled
                                key={slot.id}
                                initial={{ y: prefersReducedMotion ? 0 : 8 }}
                                animate={{ y: 0 }}
                                transition={prefersReducedMotion ? noMotion : { ...slotStagger, delay: slotIndex * 0.03 }}
                                className={`p-3 rounded-xl border text-left cursor-not-allowed opacity-50 ${
                                  isDark ? 'bg-white/5 border-amber-500/30' : 'bg-amber-50 border-amber-200'
                                }`}
                              >
                                <div className={`font-bold text-sm ${isDark ? 'text-white/60' : 'text-primary/60'}`}>{slot.start}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wide ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>Requested</div>
                              </motion.button>
                            );
                          }
                          const isSelected = selectedSlot?.id === slot.id;
                          return (
                            <motion.button
                              key={slot.id}
                              initial={{ y: prefersReducedMotion ? 0 : 8 }}
                              animate={{ y: 0 }}
                              transition={prefersReducedMotion ? noMotion : { ...slotStagger, delay: slotIndex * 0.03 }}
                              onClick={() => { haptic.light(); setSelectedSlot(slot); setSelectedResource(null); }}
                              aria-pressed={isSelected}
                              className={`relative p-3 rounded-[4px] border text-left transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-accent focus:outline-none ${
                                isSelected
                                  ? (isDark ? 'bg-transparent text-primary border-white' : 'bg-transparent text-white border-primary')
                                  : (isDark ? 'bg-transparent text-white hover:bg-white/10 border-white/15' : 'bg-white text-primary hover:bg-black/5 border-black/10')
                              }`}
                            >
                              {isSelected && (
                                <motion.div
                                  layoutId="timeslot-selected"
                                  className={`absolute inset-0 rounded-[4px] ${isDark ? 'bg-white' : 'bg-primary'}`}
                                  transition={prefersReducedMotion ? noMotion : slotStagger}
                                  style={{ zIndex: 0 }}
                                />
                              )}
                              <div className="relative z-10">
                                <div className="font-bold text-sm">{slot.start}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wide ${isSelected ? 'opacity-80' : 'opacity-40'}`}>
                                  {slot.availableResourceDbIds.length} {activeTab === 'simulator' ? 'bays' : 'rooms'}
                                </div>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {slotsByHour.length === 0 && !isLoading && (
            <EmptySlots onChangeDate={dates.length > 1 ? () => {
              if (selectedDateObj) {
                const currentIdx = dates.findIndex(d => d.date === selectedDateObj.date);
                const nextIdx = (currentIdx + 1) % dates.length;
                setSelectedDateObj(dates[nextIdx]);
              }
            } : undefined} />
          )}
        </div>
      </div>
    </section>
  );
};

export default TimeSlotsSection;
