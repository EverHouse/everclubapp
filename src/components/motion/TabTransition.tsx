import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { springPresets, tabFadeVariants } from '../../utils/motion';

interface TabTransitionProps {
  activeKey: string | number;
  children: React.ReactNode;
  className?: string;
}

export const TabTransition: React.FC<TabTransitionProps> = ({ 
  activeKey, 
  children, 
  className = '' 
}) => {
  const prefersReduced = useReducedMotion();

  const transition = prefersReduced
    ? { duration: 0 }
    : springPresets.smooth;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeKey}
        className={className}
        variants={prefersReduced ? undefined : tabFadeVariants}
        initial={prefersReduced ? false : 'enter'}
        animate="center"
        exit="exit"
        transition={transition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};

export default TabTransition;
