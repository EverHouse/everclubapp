import { create } from 'zustand';
import { useCallback } from 'react';

interface PageReadyState {
  isPageReady: boolean;
  _timeoutId: ReturnType<typeof setTimeout> | null;
  setPageReady: (ready: boolean) => void;
  resetPageReady: () => void;
}

export const usePageReadyStore = create<PageReadyState>((set, get) => ({
  isPageReady: true,
  _timeoutId: null,

  setPageReady: (ready) => {
    const prev = get()._timeoutId;
    if (prev) clearTimeout(prev);
    set({ isPageReady: ready, _timeoutId: null });
  },

  resetPageReady: () => {
    const prev = get()._timeoutId;
    if (prev) clearTimeout(prev);
    set({ isPageReady: false });
    const timeoutId = setTimeout(() => {
      set({ isPageReady: true, _timeoutId: null });
    }, 5000);
    set({ _timeoutId: timeoutId });
  },
}));

export const usePageReady = () => {
  const isPageReady = usePageReadyStore((s) => s.isPageReady);
  const setPageReady = usePageReadyStore((s) => s.setPageReady);
  const resetPageReady = usePageReadyStore((s) => s.resetPageReady);
  return { isPageReady, setPageReady, resetPageReady };
};

export function usePageLoading() {
  const setPageReady = usePageReadyStore((s) => s.setPageReady);

  const startLoading = useCallback(() => {
    setPageReady(false);
  }, [setPageReady]);

  const finishLoading = useCallback(() => {
    setPageReady(true);
  }, [setPageReady]);

  return { startLoading, finishLoading };
}
