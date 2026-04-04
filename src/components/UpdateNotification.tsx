import React, { useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useServiceWorkerUpdate } from '../hooks/useServiceWorkerUpdate';
import { springPresets } from '../utils/motion';
import Icon from './icons/Icon';

const notificationVariants = {
  initial: { opacity: 0, scale: 0.92, y: -8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: -8 },
};

const reducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const UpdateNotification: React.FC = () => {
  const { updateAvailable, isUpdating, applyUpdate, dismissUpdate } = useServiceWorkerUpdate();
  const prefersReduced = useReducedMotion();
  const [dismissed, setDismissed] = useState(false);
  const pendingDismiss = useRef(false);

  const handleDismiss = useCallback(() => {
    pendingDismiss.current = true;
    setDismissed(true);
  }, []);

  const handleExitComplete = useCallback(() => {
    if (pendingDismiss.current) {
      pendingDismiss.current = false;
      dismissUpdate();
    }
    setDismissed(false);
  }, [dismissUpdate]);

  const show = updateAvailable && !dismissed;

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {show && (
        <motion.div
          key="update-notification"
          variants={prefersReduced ? reducedVariants : notificationVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={prefersReduced ? { duration: 0.15 } : springPresets.popIn}
          className="fixed left-4 right-4 md:left-auto md:right-6 md:max-w-sm"
          style={{
            top: 'max(120px, calc(max(env(safe-area-inset-top, 0px), env(titlebar-area-height, 0px)) + 100px))',
            zIndex: 'var(--z-toast, 10500)',
          }}
          role="alert"
          aria-live="polite"
        >
          <div className="glass-card p-4 shadow-lg border border-brand-green/20">
            <div className="flex items-start gap-3">
              <Icon name="system_update" className="text-2xl text-brand-green mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Update Available</p>
                <p className="text-xs text-muted mt-1">
                  A new version is ready. Refresh to get the latest features.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={applyUpdate}
                    disabled={isUpdating}
                    className="px-4 py-2 bg-brand-green text-white text-xs font-semibold rounded-full hover:bg-brand-green/90 transition-colors disabled:opacity-50 tactile-btn"
                  >
                    {isUpdating ? 'Updating...' : 'Refresh Now'}
                  </button>
                  <button
                    onClick={handleDismiss}
                    disabled={isUpdating}
                    className="px-4 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors tactile-btn"
                  >
                    Later
                  </button>
                </div>
              </div>
              <button
                onClick={handleDismiss}
                className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors tactile-btn"
                aria-label="Dismiss"
              >
                <Icon name="close" className="text-lg text-muted" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UpdateNotification;
