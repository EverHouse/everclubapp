import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { springPresets, useReducedMotion } from '../utils/motion';
import { useTheme } from '../contexts/ThemeContext';
import Icon from './icons/Icon';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  key?: string;
  createdAt?: number;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number, key?: string, action?: ToastAction) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const getIconForType = (type: ToastType): string => {
  switch (type) {
    case 'success': return 'check_circle';
    case 'error': return 'error';
    case 'warning': return 'warning';
    case 'info': return 'info';
  }
};

const getBorderColor = (type: ToastType): string => {
  switch (type) {
    case 'success': return '#22c55e';
    case 'error': return '#ef4444';
    case 'warning': return '#f97316';
    case 'info': return '#8b5cf6';
  }
};

const getIconColor = (type: ToastType): string => {
  switch (type) {
    case 'success': return 'text-green-400';
    case 'error': return 'text-red-400';
    case 'warning': return 'text-orange-400';
    case 'info': return 'text-violet-400';
  }
};

const getTitleForType = (type: ToastType): string => {
  switch (type) {
    case 'success': return 'Success';
    case 'error': return 'Error';
    case 'warning': return 'Warning';
    case 'info': return 'Notice';
  }
};

const ProgressBar: React.FC<{ duration: number; isPaused: boolean; color: string; reducedMotion: boolean }> = ({ duration, isPaused, color, reducedMotion }) => {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden rounded-b-xl">
      <div
        className="h-full rounded-b-xl"
        style={{
          backgroundColor: color,
          opacity: 0.6,
          transformOrigin: 'left',
          ...(reducedMotion
            ? { transform: 'scaleX(0)' }
            : {
                animation: `toast-progress ${duration}ms linear forwards`,
                animationPlayState: isPaused ? 'paused' : 'running',
              }),
        }}
      />
    </div>
  );
};

const SWIPE_DISMISS_THRESHOLD = 80;
const SWIPE_VELOCITY_THRESHOLD = 300;

const ToastItem: React.FC<{
  toast: ToastMessage;
  onDismiss: () => void;
  isDark: boolean;
}> = ({ toast, onDismiss, isDark }) => {
  const duration = toast.duration || 3000;
  const borderColor = getBorderColor(toast.type);
  const prefersReducedMotion = useReducedMotion();

  const dragX = useMotionValue(0);
  const dragOpacity = useTransform(dragX, [-180, 0, 180], [0, 1, 0]);

  const [isDragging, setIsDragging] = useState(false);
  const swipeDirRef = useRef<'left' | 'right' | null>(null);
  const [swipeExit, setSwipeExit] = useState<{ x: number; opacity: number } | null>(null);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerStartRef = useRef<number>(Date.now());
  const remainingRef = useRef<number>(duration);

  const startTimer = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerStartRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismissRef.current(), ms);
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const elapsed = Date.now() - timerStartRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (remainingRef.current > 0) {
      startTimer(remainingRef.current);
    }
  }, [startTimer]);

  useEffect(() => {
    remainingRef.current = duration;
    startTimer(duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const handleDragStart = () => {
    setIsDragging(true);
    pauseTimer();
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const shouldDismiss =
      Math.abs(info.offset.x) >= SWIPE_DISMISS_THRESHOLD ||
      Math.abs(info.velocity.x) >= SWIPE_VELOCITY_THRESHOLD;

    if (shouldDismiss) {
      swipeDirRef.current = info.offset.x >= 0 ? 'right' : 'left';
      setSwipeExit({ x: swipeDirRef.current === 'right' ? 300 : -300, opacity: 0 });
      onDismissRef.current();
    } else {
      resumeTimer();
    }
  };

  const handleActionClick = () => {
    if (toast.action) {
      toast.action.onClick();
      onDismiss();
    }
  };

  return (
    <motion.div
      layout={!prefersReducedMotion}
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.95 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, x: 0, scale: 1 }}
      exit={prefersReducedMotion
        ? { opacity: 0 }
        : swipeExit
          ? swipeExit
          : { opacity: 0, y: -20, scale: 0.95 }
      }
      transition={springPresets.smooth}
      className="pointer-events-auto"
    >
      <motion.div
        drag={prefersReducedMotion ? false : "x"}
        dragSnapToOrigin
        dragElastic={0.5}
        dragConstraints={{ left: 0, right: 0 }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{
          x: prefersReducedMotion ? undefined : dragX,
          opacity: prefersReducedMotion ? undefined : dragOpacity,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderLeft: `3px solid ${borderColor}`,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)'
            : '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
          minWidth: '280px',
          maxWidth: '420px',
          touchAction: 'pan-y',
          cursor: prefersReducedMotion ? undefined : (isDragging ? 'grabbing' : 'grab'),
        }}
        className={`relative overflow-hidden rounded-xl
          ${isDark ? 'bg-[#1e2319] border border-white/[0.12]' : 'bg-white border border-black/[0.06]'}
        `}
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      >
        <div className="flex items-start gap-3 pl-4 pr-2 py-3">
          <Icon name={getIconForType(toast.type)} className={`text-xl mt-0.5 flex-shrink-0 ${getIconColor(toast.type)}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold tracking-wide uppercase ${isDark ? 'text-white/90' : 'text-gray-900'}`}>
              {getTitleForType(toast.type)}
            </p>
            <p className={`text-sm mt-0.5 leading-snug ${isDark ? 'text-white/70' : 'text-gray-600'}`}>
              {toast.message}
            </p>
          </div>
          {toast.action && (
            <button
              onClick={handleActionClick}
              className={`tactile-btn px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                isDark ? 'text-white/90 hover:bg-white/15 bg-white/10' : 'text-gray-800 hover:bg-black/10 bg-black/5'
              }`}
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={onDismiss}
            className={`tactile-btn p-1.5 rounded-lg transition-colors flex-shrink-0 ${
              isDark ? 'hover:bg-white/10 text-white/40 hover:text-white/70' : 'hover:bg-black/5 text-gray-400 hover:text-gray-600'
            }`}
            aria-label="Dismiss notification"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
        <ProgressBar duration={duration} isPaused={isDragging} color={borderColor} reducedMotion={!!prefersReducedMotion} />
      </motion.div>
    </motion.div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const { effectiveTheme } = useTheme();
  const isDarkTheme = effectiveTheme === 'dark';

  const recentToastsRef = useRef<Array<{ message: string; type: ToastType; timestamp: number }>>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success', duration: number = 3000, key?: string, action?: ToastAction) => {
    if (key) {
      setToasts(prev => {
        const existingIndex = prev.findIndex(t => t.key === key);
        const newToast: ToastMessage = {
          id: existingIndex !== -1 ? prev[existingIndex].id : `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          message,
          type,
          duration,
          key,
          createdAt: Date.now(),
          action,
        };

        if (existingIndex !== -1) {
          const updated = [...prev];
          updated[existingIndex] = newToast;
          return updated;
        } else {
          return [...prev, newToast];
        }
      });
      return;
    }

    const now = Date.now();
    const isDuplicate = recentToastsRef.current.some(
      t => t.message === message && t.type === type && (now - t.timestamp) < 2000
    );

    if (isDuplicate) return;

    recentToastsRef.current.push({ message, type, timestamp: now });
    recentToastsRef.current = recentToastsRef.current.filter(t => (now - t.timestamp) < 2000);

    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts(prev => [...prev, { id, message, type, duration, createdAt: now, action }]);
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      <div
        className="fixed bottom-0 left-0 right-0 pb-[calc(80px+env(safe-area-inset-bottom,0px))] px-4 flex flex-col gap-3 items-center pointer-events-none sm:bottom-6 sm:left-6 sm:right-auto sm:pb-0 sm:px-0 sm:items-start"
        style={{ zIndex: 'var(--z-toast)', maxWidth: '420px' }}
      >
        <AnimatePresence mode="popLayout">
          {toasts.map(toast => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onDismiss={() => hideToast(toast.id)}
              isDark={isDarkTheme}
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export type { ToastAction };
export default ToastProvider;
