import React from 'react';
import { motion } from 'framer-motion';
import { haptic } from '../utils/haptics';
import { useReducedMotion, springPresets } from '../utils/motion';

interface TabButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  isDark?: boolean;
  icon?: string;
  layoutGroupId?: string;
}

const TabButton: React.FC<TabButtonProps> = ({ label, active, onClick, isDark = true, layoutGroupId }) => {
  const reducedMotion = useReducedMotion();

  const handleClick = () => {
    haptic.light();
    onClick();
  };

  const pillTransition = reducedMotion
    ? { duration: 0 }
    : springPresets.pill;

  return (
    <button 
      type="button"
      role="tab"
      aria-selected={active}
      onClick={handleClick}
      style={{ touchAction: 'manipulation' }}
      className={`tactile-btn relative text-sm whitespace-nowrap flex-shrink-0 transition-colors min-h-[36px] px-3 py-1.5 rounded-full focus:ring-2 focus:ring-offset-1 focus:ring-accent focus:outline-none ${
        active 
          ? (isDark ? 'text-white font-bold' : 'text-white font-bold') 
          : (isDark ? 'text-white/60 font-medium' : 'text-primary/60 font-medium')
      }`}
    >
      {active && layoutGroupId ? (
        <motion.span
          layoutId={`tab-pill-${layoutGroupId}`}
          className={`absolute inset-0 rounded-full ${isDark ? 'bg-white/15' : 'bg-primary'}`}
          transition={pillTransition}
          style={{ zIndex: 0 }}
        />
      ) : active ? (
        <span
          className={`absolute inset-0 rounded-full ${isDark ? 'bg-white/15' : 'bg-primary'}`}
          style={{ zIndex: 0 }}
        />
      ) : null}
      <span className="relative z-10">{label}</span>
    </button>
  );
};

export default TabButton;
