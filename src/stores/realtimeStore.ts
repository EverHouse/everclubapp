import { create } from 'zustand';

interface RealtimeState {
  wsConnected: boolean;
  supabaseConnected: boolean;
  setWsConnected: (status: boolean) => void;
  setSupabaseConnected: (status: boolean) => void;
  shouldUseSupabase: () => boolean;
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  wsConnected: false,
  supabaseConnected: false,
  setWsConnected: (status: boolean) => set({ wsConnected: status }),
  setSupabaseConnected: (status: boolean) => set({ supabaseConnected: status }),
  shouldUseSupabase: () => {
    const { wsConnected, supabaseConnected } = get();
    // Use Supabase only if WebSocket is not connected but Supabase is.
    return !wsConnected && supabaseConnected;
  },
}));
