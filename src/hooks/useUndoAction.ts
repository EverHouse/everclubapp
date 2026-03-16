import { useCallback, useEffect, useRef } from 'react';
import { useToast } from '../components/Toast';

interface UndoActionOptions {
  message: string;
  duration?: number;
  onExecute: () => Promise<void>;
  onUndo?: () => void;
  errorMessage?: string;
}

export function useUndoAction() {
  const { showToast } = useToast();
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const execute = useCallback((options: UndoActionOptions) => {
    const {
      message,
      duration = 5000,
      onExecute,
      onUndo,
      errorMessage = 'Action failed',
    } = options;

    const actionId = `undo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let cancelled = false;

    const timer = setTimeout(() => {
      pendingTimers.current.delete(actionId);
      if (!cancelled) {
        onExecute().catch(() => {
          onUndo?.();
          showToast(errorMessage, 'error');
        });
      }
    }, duration);

    pendingTimers.current.set(actionId, timer);

    showToast(message, 'info', duration, actionId, {
      label: 'Undo',
      onClick: () => {
        cancelled = true;
        clearTimeout(timer);
        pendingTimers.current.delete(actionId);
        onUndo?.();
      },
    });
  }, [showToast]);

  return { execute };
}
