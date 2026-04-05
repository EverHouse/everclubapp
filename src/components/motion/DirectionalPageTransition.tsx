import React, { createContext, useContext } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { springPresets } from '../../utils/motion';

export interface TransitionCustom {
  direction: number;
  distance: number;
}

const defaultCustom: TransitionCustom = { direction: 1, distance: 1 };

// eslint-disable-next-line react-refresh/only-export-components
export const TransitionContext = createContext<TransitionCustom>(defaultCustom);

// eslint-disable-next-line react-refresh/only-export-components
export const useTransitionState = () => useContext(TransitionContext);

const directionVariants = {
  enter: (custom: TransitionCustom) => ({
    opacity: 0,
    y: 6 * custom.direction,
  }),
  center: { opacity: 1, y: 0 },
  exit: (custom: TransitionCustom) => ({
    opacity: 0,
    y: -4 * custom.direction,
  }),
};

interface DirectionalPageTransitionProps {
  children: React.ReactNode;
}

const DirectionalPageTransition: React.FC<DirectionalPageTransitionProps> = ({ children }) => {
  const prefersReduced = useReducedMotion();
  const custom = useContext(TransitionContext);

  return (
    <motion.div
      custom={custom}
      initial={prefersReduced ? false : 'enter'}
      animate="center"
      exit="exit"
      variants={prefersReduced ? undefined : directionVariants}
      transition={prefersReduced ? { duration: 0 } : springPresets.smooth}
      style={{ minHeight: '100%' }}
    >
      {children}
    </motion.div>
  );
};

export default DirectionalPageTransition;
