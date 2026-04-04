import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollLockManager } from '../hooks/useScrollLockManager';
import { useSafariThemeColor } from '../hooks/useSafariThemeColor';
import { springPresets, noMotion, useReducedMotion } from '../utils/motion';
import Icon from './icons/Icon';

const BASE_MODAL_Z_INDEX = 10000;
const Z_INDEX_INCREMENT = 10;

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  showCloseButton?: boolean;
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  hideTitleBorder?: boolean;
  overflowVisible?: boolean;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl'
};

export function ModalShell({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  dismissible = true,
  size = 'md',
  className = '',
  hideTitleBorder = false,
  overflowVisible = false
}: ModalShellProps) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const [modalZIndex, setModalZIndex] = useState(BASE_MODAL_Z_INDEX);
  const prefersReducedMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState(false);
  const closeRequestedRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (isOpen) {
      closeRequestedRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    setIsVisible(false);
  }, []);

  const handleExitComplete = useCallback(() => {
    if (closeRequestedRef.current) {
      closeRequestedRef.current = false;
      onCloseRef.current();
    }
  }, []);

  useScrollLockManager(isOpen, dismissible ? handleClose : undefined);
  useSafariThemeColor(isOpen);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElement.current = document.activeElement as HTMLElement;
    
    const currentCount = parseInt(document.body.getAttribute('data-modal-count') || '0', 10);
    const newZIndex = BASE_MODAL_Z_INDEX + (currentCount * Z_INDEX_INCREMENT);
    setModalZIndex(newZIndex);
    const myLayer = currentCount + 1;
    document.body.setAttribute('data-modal-count', String(myLayer));
    
    const focusTimer = setTimeout(() => {
      modalRef.current?.focus();
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      const currentCount = parseInt(document.body.getAttribute('data-modal-count') || '0', 10);
      if (currentCount <= 1) {
        document.body.removeAttribute('data-modal-count');
      } else {
        document.body.setAttribute('data-modal-count', String(currentCount - 1));
      }
      
      const isTopModal = currentCount === myLayer;
      if (isTopModal && previousActiveElement.current) {
        previousActiveElement.current.focus();
        previousActiveElement.current = null;
      }
    };
  }, [isOpen]);

  const backdropTransition = prefersReducedMotion ? noMotion : { duration: 0.2 };
  const panelTransition = prefersReducedMotion ? noMotion : springPresets.smooth;

  const modalContent = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {isVisible && (
        <div 
          className={`fixed inset-0 ${isDark ? 'dark' : ''}`}
          style={{ overscrollBehavior: 'contain', touchAction: 'none', zIndex: modalZIndex, height: '100%' }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
            style={{ touchAction: 'none', height: '100%' }}
          />
          
          <div 
            className="fixed inset-0 overflow-y-auto"
            style={{ overscrollBehavior: 'contain', height: '100%' }}
            onClick={(e) => {
              if (dismissible && e.target === e.currentTarget) {
                handleClose();
              }
            }}
          >
            <div 
              className="flex min-h-full items-center justify-center p-4"
              onClick={(e) => {
                if (dismissible && e.target === e.currentTarget) {
                  handleClose();
                }
              }}
            >
              <motion.div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? 'modal-title' : undefined}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={panelTransition}
                className={`relative w-full ${sizeClasses[size]} ${isDark ? 'bg-[#1a1d15] border-white/10' : 'bg-white border-gray-200'} rounded-xl shadow-2xl border ${className}`}
              >
                {(title || showCloseButton) && (
                  <div className={`flex items-center justify-between p-4 ${hideTitleBorder ? '' : `border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}`}>
                    {title && (
                      <h3 
                        id="modal-title"
                        className={`text-xl font-bold ${isDark ? 'text-white' : 'text-primary'}`}
                      >
                        {title}
                      </h3>
                    )}
                    {showCloseButton && (
                      <button
                        onClick={handleClose}
                        className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                        aria-label="Close modal"
                      >
                        <Icon name="close" className="text-xl" />
                      </button>
                    )}
                  </div>
                )}
                
                <div 
                  className={`modal-keyboard-aware ${overflowVisible ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden'} max-h-[85dvh]`}
                  data-scroll-lock-allow=""
                  style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehavior: 'contain' }}
                >
                  {children}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}

export default ModalShell;
