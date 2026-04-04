import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollLockManager } from '../hooks/useScrollLockManager';
import { useSafariThemeColor } from '../hooks/useSafariThemeColor';
import { springPresets, noMotion, useReducedMotion } from '../utils/motion';
import Icon from './icons/Icon';

const BASE_DIALOG_Z_INDEX = 10100;
const Z_INDEX_INCREMENT = 10;

type DialogVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  isLoading?: boolean;
}

interface ConfirmDialogState extends ConfirmDialogOptions {
  isOpen: boolean;
  resolve: ((value: boolean) => void) | null;
}

const variantStyles = {
  danger: {
    light: 'bg-red-500/15 text-red-600 hover:bg-red-500/25',
    dark: 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
    icon: 'error',
    iconColor: 'text-red-500',
    spinnerBorder: 'border-red-600/30 border-t-red-600 dark:border-red-400/30 dark:border-t-red-400'
  },
  warning: {
    light: 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25',
    dark: 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30',
    icon: 'warning',
    iconColor: 'text-amber-500',
    spinnerBorder: 'border-amber-600/30 border-t-amber-600 dark:border-amber-400/30 dark:border-t-amber-400'
  },
  info: {
    light: 'bg-blue-500/15 text-blue-600 hover:bg-blue-500/25',
    dark: 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
    icon: 'info',
    iconColor: 'text-blue-500',
    spinnerBorder: 'border-blue-600/30 border-t-blue-600 dark:border-blue-400/30 dark:border-t-blue-400'
  }
};

function ConfirmDialogComponent({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
  isLoading = false,
  onConfirm,
  onCancel
}: ConfirmDialogOptions & {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [dialogZIndex, setDialogZIndex] = useState(BASE_DIALOG_Z_INDEX);
  const prefersReducedMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(false);
  const pendingActionRef = useRef<'confirm' | 'cancel' | null>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  });

  const handleConfirm = useCallback(() => {
    if (isLoading || pendingActionRef.current) return;
    pendingActionRef.current = 'confirm';
    setIsVisible(false);
  }, [isLoading]);

  const handleCancel = useCallback(() => {
    if (isLoading || pendingActionRef.current) return;
    pendingActionRef.current = 'cancel';
    setIsVisible(false);
  }, [isLoading]);

  const handleExitComplete = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action === 'confirm') {
      onConfirmRef.current();
    } else if (action === 'cancel') {
      onCancelRef.current();
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      pendingActionRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(false);
    }
  }, [isOpen]);

  useScrollLockManager(isOpen, handleCancel);
  useSafariThemeColor(isOpen);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElement.current = document.activeElement as HTMLElement;

    const currentCount = parseInt(document.body.getAttribute('data-modal-count') || '0', 10);
    const newZIndex = BASE_DIALOG_Z_INDEX + (currentCount * Z_INDEX_INCREMENT);
    setDialogZIndex(newZIndex);
    document.body.setAttribute('data-modal-count', String(currentCount + 1));

    const focusTimer = setTimeout(() => {
      confirmButtonRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      const currentCount = parseInt(document.body.getAttribute('data-modal-count') || '0', 10);
      if (currentCount <= 1) {
        document.body.removeAttribute('data-modal-count');
      } else {
        document.body.setAttribute('data-modal-count', String(currentCount - 1));
      }

      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
        previousActiveElement.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;
      
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Tab') {
        const focusableSelectors = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelectors);
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, handleConfirm]);

  const variantConfig = variantStyles[variant];
  const backdropTransition = prefersReducedMotion ? noMotion : { duration: 0.2 };
  const panelTransition = prefersReducedMotion ? noMotion : springPresets.smooth;

  const dialogContent = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {isVisible && (
        <div
          className={`fixed inset-0 ${isDark ? 'dark' : ''}`}
          style={{ overscrollBehavior: 'contain', touchAction: 'none', zIndex: dialogZIndex, height: '100%' }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
            style={{ touchAction: 'none', height: '100%' }}
            onClick={!isLoading ? handleCancel : undefined}
          />

          <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ overscrollBehavior: 'contain', height: '100%' }}
          >
            <motion.div
              ref={dialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-message"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={panelTransition}
              className="relative w-full max-w-sm"
            >
              <div
                className={`
                  rounded-xl p-6 shadow-2xl
                  backdrop-blur-xl backdrop-saturate-150
                  ${isDark 
                    ? 'bg-[#1a1d15]/90 border border-white/10 shadow-black/50' 
                    : 'bg-white/90 border border-white/20 shadow-gray-900/20'
                  }
                `}
              >
                <div className="flex flex-col items-center text-center">
                  <div className={`mb-4 p-3 rounded-full ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                    <Icon name={variantConfig.icon} className={`text-3xl ${variantConfig.iconColor}`} />
                  </div>

                  <h2
                    id="confirm-dialog-title"
                    className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}
                  >
                    {title}
                  </h2>

                  <p
                    id="confirm-dialog-message"
                    className={`text-sm mb-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}
                  >
                    {message}
                  </p>

                  <div className="flex w-full gap-3">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={isLoading}
                      className={`
                        flex-1 px-4 py-3 rounded-xl font-medium text-sm
                        transition-gpu duration-fast ease-out
                        disabled:opacity-50 disabled:cursor-not-allowed tactile-btn
                        ${isDark 
                          ? 'text-white/70 hover:bg-white/5 active:bg-white/10' 
                          : 'text-primary/70 hover:bg-primary/5 active:bg-primary/10'
                        }
                      `}
                    >
                      {cancelText}
                    </button>

                    <button
                      ref={confirmButtonRef}
                      type="button"
                      onClick={handleConfirm}
                      disabled={isLoading}
                      className={`
                        flex-1 px-4 py-3 rounded-xl font-medium text-sm
                        transition-gpu duration-fast ease-out
                        disabled:opacity-70 disabled:cursor-not-allowed tactile-btn
                        ${isDark ? variantConfig.dark : variantConfig.light}
                        flex items-center justify-center gap-2
                      `}
                    >
                      {isLoading ? (
                        <>
                          <span className={`w-4 h-4 border-2 rounded-full animate-spin ${variantConfig.spinnerBorder}`} />
                          <span>Loading...</span>
                        </>
                      ) : (
                        confirmText
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(dialogContent, document.body);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'info',
    isLoading: false,
    resolve: null
  });

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        variant: options.variant || 'info',
        isLoading: options.isLoading || false,
        resolve
      });
    });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState(prev => ({ ...prev, isLoading }));
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState(prev => ({ ...prev, isOpen: false, resolve: null }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState(prev => ({ ...prev, isOpen: false, resolve: null }));
  }, [state]);

  const ConfirmDialogPortal = useCallback(() => (
    <ConfirmDialogComponent
      isOpen={state.isOpen}
      title={state.title}
      message={state.message}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      variant={state.variant}
      isLoading={state.isLoading}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ), [state, handleConfirm, handleCancel]);

  return {
    confirm,
    setLoading,
    ConfirmDialogComponent: ConfirmDialogPortal
  };
}

export default ConfirmDialogComponent;
