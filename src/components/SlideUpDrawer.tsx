import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollLockManager } from '../hooks/useScrollLockManager';
import { useSafariThemeColor } from '../hooks/useSafariThemeColor';
import { useReducedMotion, springPresets } from '../utils/motion';
import Icon from './icons/Icon';

const BASE_DRAWER_Z_INDEX = 10000;
const STANDARD_DRAWER_Z_INDEX = 5000;
const Z_INDEX_INCREMENT = 10;
const DISMISS_VELOCITY = 500;
const DISMISS_DISTANCE_RATIO = 0.3;

interface SlideUpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  showCloseButton?: boolean;
  dismissible?: boolean;
  maxHeight?: 'full' | 'large' | 'medium' | 'small';
  className?: string;
  hideHandle?: boolean;
  stickyFooter?: ReactNode;
  onContentScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
  variant?: 'modal' | 'standard';
}

const maxHeightClasses = {
  full: 'max-h-[95dvh]',
  large: 'max-h-[85dvh]',
  medium: 'max-h-[70dvh]',
  small: 'max-h-[50dvh]'
};

export function SlideUpDrawer({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  dismissible = true,
  maxHeight = 'large',
  className = '',
  hideHandle = false,
  stickyFooter,
  onContentScroll,
  variant = 'modal'
}: SlideUpDrawerProps) {
  const isModal = variant === 'modal';
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const drawerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [drawerZIndex, setDrawerZIndex] = useState(isModal ? BASE_DRAWER_Z_INDEX : STANDARD_DRAWER_Z_INDEX);
  const [isClosing, setIsClosing] = useState(false);
  const reducedMotion = useReducedMotion();
  const allowDragRef = useRef(true);

  const y = useMotionValue(0);
  const dragProgress = useTransform(y, [0, 260], [0, 1]);
  const backdropOpacity = useTransform(y, [0, 400], [1, 0.2]);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useScrollLockManager(isOpen && isModal, isModal && dismissible ? onClose : undefined);
  useSafariThemeColor(isOpen);

  useEffect(() => {
    if (!isOpen) {
      y.jump(0);
      setIsClosing(false);
      return;
    }

    const startY = window.innerHeight;
    y.jump(startY);
    if (reducedMotion) {
      y.jump(0);
    } else {
      animate(y, 0, springPresets.sheet);
    }

    if (isModal) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      
      const currentCount = parseInt(document.body.getAttribute('data-modal-count') || '0', 10);
      const newZIndex = BASE_DRAWER_Z_INDEX + (currentCount * Z_INDEX_INCREMENT);
      setDrawerZIndex(newZIndex);
      document.body.setAttribute('data-modal-count', String(currentCount + 1));
      
      setTimeout(() => {
        drawerRef.current?.focus();
      }, 50);
    } else {
      setDrawerZIndex(STANDARD_DRAWER_Z_INDEX);
    }

    return () => {
      if (isModal) {
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
      }
    };
  }, [isOpen, isModal, y, reducedMotion]);

  const animateClose = useCallback(() => {
    if (!dismissible || isClosing) return;
    setIsClosing(true);

    const height = drawerRef.current?.getBoundingClientRect().height || 600;
    if (reducedMotion) {
      y.jump(height + 40);
      onCloseRef.current();
    } else {
      animate(y, height + 40, springPresets.sheetClose)
        .then(() => onCloseRef.current());
    }
  }, [dismissible, isClosing, y, reducedMotion]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      animateClose();
      return;
    }

    if (isModal && e.key === 'Tab') {
      const focusableSelectors = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelectors);
      if (!focusableElements || focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement || document.activeElement === drawerRef.current) {
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
  }, [dismissible, animateClose, isModal]);

  const handleDragStart = useCallback(() => {
    const contentEl = contentRef.current;
    if (contentEl && contentEl.scrollTop > 0) {
      allowDragRef.current = false;
    } else {
      allowDragRef.current = true;
    }
  }, []);

  const handleDrag = useCallback((_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!allowDragRef.current) {
      y.set(0);
      return;
    }
    if (info.offset.y < 0) {
      y.set(info.offset.y * 0.05);
    }
  }, [y]);

  const handleDragEnd = useCallback((_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!allowDragRef.current) {
      allowDragRef.current = true;
      animate(y, 0, springPresets.snap);
      return;
    }

    if (!dismissible) {
      animate(y, 0, springPresets.snap);
      return;
    }

    const height = drawerRef.current?.getBoundingClientRect().height || 400;
    const shouldDismiss =
      info.velocity.y > DISMISS_VELOCITY ||
      info.offset.y > height * DISMISS_DISTANCE_RATIO;

    if (shouldDismiss) {
      setIsClosing(true);
      if (reducedMotion) {
        y.jump(height + 40);
        onCloseRef.current();
      } else {
        animate(y, height + 40, springPresets.sheetClose)
          .then(() => onCloseRef.current());
      }
    } else {
      if (reducedMotion) {
        y.jump(0);
      } else {
        animate(y, 0, springPresets.stiff);
      }
    }
  }, [dismissible, y, reducedMotion]);

  if (!isOpen) return null;

  const drawerContent = (
    <div 
      className={`fixed ${isModal ? 'inset-0' : 'inset-x-0 bottom-0 pointer-events-none'} ${isDark ? 'dark' : ''}`}
      style={{ 
        overscrollBehavior: 'contain', 
        touchAction: isModal ? 'none' : undefined, 
        zIndex: drawerZIndex, 
        height: isModal ? '100%' : undefined,
      }}
    >
      {isModal && (
        <motion.div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          aria-hidden="true"
          style={{ touchAction: 'none', height: '100%', opacity: backdropOpacity }}
          onClick={dismissible ? animateClose : undefined}
        />
      )}
      
      <motion.div 
        ref={drawerRef}
        role="dialog"
        aria-modal={isModal ? 'true' : undefined}
        aria-labelledby={title ? 'drawer-title' : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        className={`fixed inset-x-0 bottom-0 flex flex-col pointer-events-auto ${maxHeightClasses[maxHeight]} ${isDark ? 'bg-[#1a1d15]' : 'bg-white'} rounded-t-3xl ${className}`}
        style={{ y }}
        drag={dismissible ? 'y' : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.6 }}
        dragMomentum={true}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        onKeyDown={handleKeyDown}
      >
        {!hideHandle && (
          <div className="flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }}>
            <div className={`h-1 rounded-full transition-colors duration-200 ease-out w-10 ${isDark ? 'bg-white/20' : 'bg-gray-300'}`} />
            {dismissible && (
              <motion.div 
                className="mt-1.5 flex items-center gap-1 select-none"
                style={{ opacity: dragProgress }}
              >
                <Icon name="keyboard_arrow_down" className={`text-sm ${isDark ? 'text-white/40' : 'text-gray-400'}`} />
                <span className={`text-xs font-medium tracking-wide uppercase ${isDark ? 'text-white/40' : 'text-gray-400'}`}>
                  close
                </span>
              </motion.div>
            )}
          </div>
        )}
        
        {(title || showCloseButton) && (
          <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'} shrink-0`}>
            {title ? (
              <h3 
                id="drawer-title"
                className={`text-xl font-bold ${isDark ? 'text-white' : 'text-primary'}`}
              >
                {title}
              </h3>
            ) : <div />}
            {showCloseButton && (
              <button
                onClick={animateClose}
                className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                aria-label="Close drawer"
              >
                <Icon name="close" className="text-xl" />
              </button>
            )}
          </div>
        )}
        
        <div 
          ref={contentRef}
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
          data-scroll-lock-allow=""
          style={{ 
            WebkitOverflowScrolling: 'touch', 
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            paddingBottom: stickyFooter ? undefined : 'env(safe-area-inset-bottom, 0px)'
          }}
          onScroll={onContentScroll}
        >
          {children}
        </div>
        
        {stickyFooter && (
          <div 
            className={`shrink-0 border-t ${isDark ? 'border-white/10 bg-[#1a1d15]' : 'border-gray-200 bg-white'}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            {stickyFooter}
          </div>
        )}
      </motion.div>
    </div>
  );

  return createPortal(drawerContent, document.body);
}

export default SlideUpDrawer;
