import { create } from 'zustand';

const NAVIGATION_TIMEOUT_MS = 5000;

interface NavigationLoadingState {
  isNavigating: boolean;
  _timeoutId: ReturnType<typeof setTimeout> | null;
  startNavigation: () => void;
  endNavigation: () => void;
}

export const useNavigationLoadingStore = create<NavigationLoadingState>((set, get) => ({
  isNavigating: false,
  _timeoutId: null,

  startNavigation: () => {
    const prev = get()._timeoutId;
    if (prev) clearTimeout(prev);
    const timeoutId = setTimeout(() => {
      set({ isNavigating: false, _timeoutId: null });
    }, NAVIGATION_TIMEOUT_MS);
    set({ isNavigating: true, _timeoutId: timeoutId });
  },

  endNavigation: () => {
    const prev = get()._timeoutId;
    if (prev) clearTimeout(prev);
    set({ isNavigating: false, _timeoutId: null });
  },
}));

export const useNavigationLoading = () => {
  const isNavigating = useNavigationLoadingStore((s) => s.isNavigating);
  const startNavigation = useNavigationLoadingStore((s) => s.startNavigation);
  const endNavigation = useNavigationLoadingStore((s) => s.endNavigation);
  return { isNavigating, startNavigation, endNavigation };
};
