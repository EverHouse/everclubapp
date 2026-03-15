import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_THRESHOLD = 10;

export type ScrollDirection = 'up' | 'down' | null;

interface ScrollDirectionState {
  direction: ScrollDirection;
  isAtTop: boolean;
}

export function useScrollDirection(enabled = true): ScrollDirectionState {
  const [state, setState] = useState<ScrollDirectionState>(() => {
    const y = typeof window !== 'undefined' ? window.scrollY : 0;
    return { direction: null, isAtTop: y <= 0 };
  });
  const lastScrollY = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  const rafId = useRef<number>(0);

  const handleScroll = useCallback(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const atTop = currentY <= 0;

      if (atTop) {
        setState({ direction: null, isAtTop: true });
      } else if (currentY - lastScrollY.current > SCROLL_THRESHOLD) {
        setState({ direction: 'down', isAtTop: false });
      } else if (lastScrollY.current - currentY > SCROLL_THRESHOLD) {
        setState({ direction: 'up', isAtTop: false });
      }

      lastScrollY.current = currentY;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [enabled, handleScroll]);

  return state;
}
