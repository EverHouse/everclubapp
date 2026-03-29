import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
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
  isExiting?: boolean;
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

const ProgressBar: React.FC<{ duration: number; isExiting: boolean; color: string }> = ({ duration, isExiting, color }) => {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden rounded-b-xl">
      <div
        className="h-full rounded-b-xl"
        style={{
          backgroundColor: color,
          opacity: 0.6,
          transformOrigin: 'left',
          animation: isExiting ? 'none' : `toast-progress ${duration}ms linear forwards`,
        }}
      />
    </div>
  );
};

const SWIPE_THRESHOLD = 80;
type SwipeState = 'idle' | 'dragging' | 'snapping-back';

const ToastItem: React.FC<{
  toast: ToastMessage;
  onDismiss: () => void;
  isDark: boolean;
}> = ({ toast, onDismiss, isDark }) => {
  const duration = toast.duration || 3000;
  const borderColor = getBorderColor(toast.type);

  const [swipeX, setSwipeX] = useState(0);
  const [swipeState, setSwipeState] = useState<SwipeState>('idle');

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);
  const currentSwipeX = useRef(0);

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
    if (!toast.isExiting && remainingRef.current > 0) {
      startTimer(remainingRef.current);
    }
  }, [toast.isExiting, startTimer]);

  useEffect(() => {
    if (toast.isExiting) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    remainingRef.current = duration;
    startTimer(duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, toast.isExiting]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
    currentSwipeX.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    if (!isHorizontalSwipe.current) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX < 8 && absY < 8) return;
      if (absY >= absX) return;
      isHorizontalSwipe.current = true;
      pauseTimer();
      setSwipeState('dragging');
    }

    e.preventDefault();
    currentSwipeX.current = deltaX;
    setSwipeX(deltaX);
  };

  const handleTouchEnd = () => {
    if (!isHorizontalSwipe.current) return;
    isHorizontalSwipe.current = false;

    const finalX = currentSwipeX.current;

    if (Math.abs(finalX) >= SWIPE_THRESHOLD) {
      onDismissRef.current();
    } else {
      setSwipeX(0);
      currentSwipeX.current = 0;
      setSwipeState('snapping-back');
      setTimeout(() => setSwipeState('idle'), 350);
      resumeTimer();
    }
  };

  const handleTouchCancel = () => {
    if (!isHorizontalSwipe.current) return;
    isHorizontalSwipe.current = false;
    setSwipeX(0);
    currentSwipeX.current = 0;
    setSwipeState('snapping-back');
    setTimeout(() => setSwipeState('idle'), 350);
    resumeTimer();
  };

  const handleActionClick = () => {
    if (toast.action) {
      toast.action.onClick();
      onDismiss();
    }
  };

  const isDragging = swipeState === 'dragging';

  const swipeOpacity = isDragging
    ? Math.max(0, 1 - Math.abs(swipeX) / 180)
    : 1;

  const swipeTransition = isDragging
    ? 'none'
    : 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease';

  return (
    <div
      className={`pointer-events-auto ${toast.isExiting ? 'toast-slide-out' : 'toast-slide-in'}`}
    >
      <div
        className={`relative overflow-hidden rounded-xl
          ${isDark ? 'bg-white/[0.08] border border-white/[0.12]' : 'bg-white/80 border border-black/[0.06]'}
        `}
        style={{
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderLeft: `3px solid ${borderColor}`,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)'
            : '0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
          minWidth: '280px',
          maxWidth: '420px',
          transform: `translateX(${swipeX}px)`,
          opacity: swipeOpacity,
          transition: swipeTransition,
          touchAction: 'pan-y',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
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
        <ProgressBar duration={duration} isExiting={toast.isExiting || false} color={borderColor} />
      </div>
    </div>
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
    setToasts(prev => prev.map(t => t.id === id ? { ...t, isExiting: true } : t));

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      <div
        className="fixed bottom-0 left-0 right-0 pb-[calc(80px+env(safe-area-inset-bottom,0px))] px-4 flex flex-col gap-3 items-center pointer-events-none sm:bottom-6 sm:left-6 sm:right-auto sm:pb-0 sm:px-0 sm:items-start"
        style={{ zIndex: 'var(--z-toast)', maxWidth: '420px' }}
      >
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => hideToast(toast.id)}
            isDark={isDarkTheme}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export type { ToastAction };
export default ToastProvider;
