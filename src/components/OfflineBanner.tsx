import { useEffect, useState } from 'react';
import { useRealtimeHealth, type RealtimeStatus } from '../hooks/useRealtimeHealth';

interface OfflineBannerProps {
  staffWsConnected?: boolean;
}

export default function OfflineBanner({ staffWsConnected }: OfflineBannerProps) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const { status, justReconnected } = useRealtimeHealth(staffWsConnected);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (justReconnected) {
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [justReconnected]);

  if (isOffline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium">
        You're offline. Showing your last available data.
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-emerald-500 text-white text-center py-2 px-4 text-sm font-medium animate-fade-in"
        style={{ animation: 'fadeInOut 3s ease-in-out forwards' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">check_circle</span>
          Live updates restored
        </span>
      </div>
    );
  }

  if (status === 'degraded') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500/90 text-white text-center py-2 px-4 text-sm font-medium">
        <span className="inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
          Live updates paused. Reconnecting...
        </span>
      </div>
    );
  }

  return null;
}
