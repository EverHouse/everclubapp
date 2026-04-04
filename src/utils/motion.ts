import React from 'react';
import { type Transition, MotionConfig, useReducedMotion } from 'framer-motion';

export const springPresets = {
  gentle: {
    type: 'spring' as const,
    stiffness: 120,
    damping: 14,
    mass: 1,
  },
  smooth: {
    type: 'spring' as const,
    stiffness: 160,
    damping: 20,
    mass: 0.8,
  },
  skeletonExit: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 24,
    mass: 0.6,
  },
  snappy: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 20,
    mass: 0.8,
  },
  ease: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 25,
  },
  easeOut: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 28,
  },
  sheetClose: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 30,
    mass: 0.8,
  },
  tilt: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 25,
    mass: 0.5,
  },
  listItem: {
    type: 'spring' as const,
    stiffness: 350,
    damping: 25,
  },
  popIn: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 20,
  },
  buttonPress: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 25,
  },
  pill: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 28,
    mass: 0.8,
  },
  quick: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30,
  },
  sheet: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30,
    mass: 0.8,
  },
  bounce: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 10,
    mass: 0.8,
  },
  snap: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 30,
  },
  stiff: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 30,
    mass: 0.5,
  },
  stiffSheet: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 30,
    mass: 0.8,
  },
  stiffQuick: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 35,
    mass: 0.5,
  },
  buttonTapStiff: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 20,
  },
  statusBadge: {
    type: 'spring' as const,
    stiffness: 500,
    damping: 25,
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
