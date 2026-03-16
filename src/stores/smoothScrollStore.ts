import { create } from 'zustand';
import { acquireScrollLock, releaseScrollLock } from '../hooks/useScrollLockManager';

interface SmoothScrollState {
  lenis: null;
  _lockId: string | null;
  scrollTo: (target: number | string | HTMLElement, options?: { offset?: number; duration?: number }) => void;
  stop: () => void;
  start: () => void;
}

export const useSmoothScrollStore = create<SmoothScrollState>((set, get) => ({
  lenis: null,
  _lockId: null,

  scrollTo: (target, options) => {
    const offset = options?.offset ?? 0;
    if (typeof target === 'number') {
      window.scrollTo({ top: target + offset, behavior: 'smooth' });
    } else if (typeof target === 'string') {
      const element = document.querySelector(target);
      if (element) {
        const rect = element.getBoundingClientRect();
        const scrollTop = window.scrollY + rect.top + offset;
        window.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    } else if (target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      const scrollTop = window.scrollY + rect.top + offset;
      window.scrollTo({ top: scrollTop, behavior: 'smooth' });
    }
  },

  stop: () => {
    const state = get();
    if (!state._lockId) {
      const lockId = acquireScrollLock('smooth-scroll');
      set({ _lockId: lockId });
    }
  },

  start: () => {
    const state = get();
    if (state._lockId) {
      releaseScrollLock(state._lockId);
      set({ _lockId: null });
    }
  },
}));

export const useSmoothScroll = () => {
  const lenis = useSmoothScrollStore((s) => s.lenis);
  const scrollTo = useSmoothScrollStore((s) => s.scrollTo);
  const stop = useSmoothScrollStore((s) => s.stop);
  const start = useSmoothScrollStore((s) => s.start);
  return { lenis, scrollTo, stop, start };
};
