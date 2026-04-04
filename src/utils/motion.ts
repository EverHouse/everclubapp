import React from 'react';
import { type Transition, MotionConfig, useReducedMotion } from 'framer-motion';

export const springPresets = {
  gentle: {
    type: 'spring' as const,
    stiffness: 120,
    damping: 14,
    mass: 1,
  },
  snappy: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 20,
    mass: 0.8,
  },
  stiff: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 30,
    mass: 0.5,
  },
  bounce: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 10,
    mass: 0.8,
  },
} satisfies Record<string, Transition>;

export type SpringPreset = keyof typeof springPresets;

export const tapAnimation = {
  scale: 0.95,
  transition: springPresets.snappy,
};

export const hoverAnimation = {
  scale: 1.02,
  transition: springPresets.gentle,
};

export const noMotion: Transition = {
  duration: 0,
};

export const reducedMotionTap = {
  scale: 1,
  transition: noMotion,
};

export const reducedMotionHover = {
  scale: 1,
  transition: noMotion,
};

export { useReducedMotion };

export const ReducedMotion: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return React.createElement(
    MotionConfig,
    { reducedMotion: 'user' },
    children,
  );
};
