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

export const staggerContainer = (staggerChildren = 0.05) => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren,
    },
  },
});

export const listItemVariant = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: springPresets.listItem },
};

export const pageEnterVariant = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: springPresets.smooth },
};

export const contentEnterVariant = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: springPresets.gentle },
};

export const popInVariant = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: springPresets.popIn },
};

export const slideUpVariant = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: springPresets.smooth },
};

export const noMotionVariant = {
  hidden: {},
  show: {},
};

export const sidebarVariants = {
  hidden: { x: '-100%' },
  visible: { x: 0 },
  exit: { x: '-100%' },
};

export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const menuItemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export const menuContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
  exit: {},
};

export const collapseVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
};

export const pageFadeVariants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export const tabFadeVariants = {
  enter: { opacity: 0, y: 4 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

export function scrollToAccordion(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement);
      const offset = parseFloat(style.getPropertyValue('--header-offset')) || 96;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  });
}
