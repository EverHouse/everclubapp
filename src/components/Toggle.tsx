import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { haptic } from '../utils/haptics';
import { springPresets } from '../utils/motion';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  loading = false,
  size = 'md',
  label,
  className = '',
}) => {
  const prefersReduced = useReducedMotion();

  const sizes = {
    sm: {
      track: 'h-[30px] w-[48px]',
      thumb: 'h-[22px] w-[22px]',
      translateX: 18,
    },
    md: {
      track: 'h-[36px] w-[56px]',
      thumb: 'h-[28px] w-[28px]',
      translateX: 20,
    },
  };

  const { track, thumb, translateX } = sizes[size];

  const handleClick = () => {
    if (!disabled && !loading) {
      haptic.light();
      onChange(!checked);
    }
  };

  const thumbTransition = prefersReduced
    ? { duration: 0 }
    : springPresets.snap;

  const trackTransition = prefersReduced
    ? { duration: 0 }
    : { duration: 0.15 };

  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={handleClick}
      animate={{
        backgroundColor: checked ? '#34C759' : '#E5E5EA',
        borderColor: checked ? '#34C759' : '#E5E5EA',
      }}
      transition={trackTransition}
      className={`
        relative inline-flex items-center ${track} shrink-0 rounded-full p-[2px]
        border-2 tactile-btn
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[#34C759]/50 focus-visible:ring-offset-2
        ${disabled ? 'opacity-40 cursor-not-allowed' : loading ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}
        ${loading ? 'animate-pulse' : ''}
        ${className}
      `}
    >
      <motion.span
        className={`
          pointer-events-none inline-block ${thumb} rounded-full 
          bg-white shadow-[0_2px_4px_rgba(0,0,0,0.12)]
        `}
        animate={{ x: checked ? translateX : 0 }}
        transition={thumbTransition}
      />
    </motion.button>
  );
};

export default Toggle;
