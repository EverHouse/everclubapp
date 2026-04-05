import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { springPresets } from '../utils/motion';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const prefersReduced = useReducedMotion();

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

  return (
    <div className="fixed top-0 left-0 right-0" style={{ zIndex: 'var(--z-nav)', contain: 'layout' }}>
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: '-100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-100%' }}
            transition={prefersReduced ? { duration: 0 } : springPresets.snappy}
            className="bg-amber-500 text-white text-center py-2 px-4 text-sm font-medium"
          >
            You're offline. Showing your last available data.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
