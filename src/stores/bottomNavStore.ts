import { create } from 'zustand';

interface BottomNavState {
  isAtBottom: boolean;
  setIsAtBottom: (value: boolean) => void;
  drawerOpen: boolean;
  setDrawerOpen: (value: boolean) => void;
}

export const useBottomNavStore = create<BottomNavState>((set) => ({
  isAtBottom: false,
  setIsAtBottom: (value) => set({ isAtBottom: value }),
  drawerOpen: false,
  setDrawerOpen: (value) => set({ drawerOpen: value }),
}));

export const useBottomNav = () => {
  const isAtBottom = useBottomNavStore((s) => s.isAtBottom);
  const setIsAtBottom = useBottomNavStore((s) => s.setIsAtBottom);
  const drawerOpen = useBottomNavStore((s) => s.drawerOpen);
  const setDrawerOpen = useBottomNavStore((s) => s.setDrawerOpen);
  return { isAtBottom, setIsAtBottom, drawerOpen, setDrawerOpen };
};
