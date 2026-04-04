import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { springPresets } from '../../utils/motion';

interface SmoothRevealProps {
  isLoaded: boolean;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

const springTransition = springPresets.smooth;

export const SmoothReveal: React.FC<SmoothRevealProps> = ({ 
  isLoaded, 
  children, 
  className = '',
  delay = 0 
}) => {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <div className={className} style={{ opacity: isLoaded ? 1 : 0 }}>
        {children}
      </div>
    );
  }

  return (
    <AnimatePresence>
      {isLoaded && (
        <motion.div
          className={className}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6, transition: { ...springTransition, delay: 0 } }}
          transition={{
            ...springTransition,
            delay: delay / 1000,
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SmoothReveal;
