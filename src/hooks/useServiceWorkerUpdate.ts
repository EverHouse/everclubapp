import { useState, useEffect, useCallback } from 'react';

interface ServiceWorkerUpdateState {
  updateAvailable: boolean;
  isUpdating: boolean;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}

export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        console.log('[App] Service worker updated to version:', event.data.version);
        setUpdateAvailable(false);
        setIsUpdating(false);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    navigator.serviceWorker.ready.then(registration => {
      if (registration.waiting) {
        setWaitingWorker(registration.waiting);
        setUpdateAvailable(true);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[App] New service worker installed, update available');
            setWaitingWorker(newWorker);
            setUpdateAvailable(true);
          }
        });
      });
    });

    const checkForUpdates = () => {
      navigator.serviceWorker.ready.then(registration => {
        registration.update().catch(console.error);
      });
    };

    checkForUpdates();

    const intervalId = setInterval(checkForUpdates, 60 * 60 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    });

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      clearInterval(intervalId);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;

    setIsUpdating(true);
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, [waitingWorker]);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  return {
    updateAvailable,
    isUpdating,
    applyUpdate,
    dismissUpdate
  };
}
