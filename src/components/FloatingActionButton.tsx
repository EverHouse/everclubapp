import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useBottomNav } from '../stores/bottomNavStore';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { springPresets, useReducedMotion } from '../utils/motion';
import Icon from './icons/Icon';

export type FABColor = 'brand' | 'amber' | 'green' | 'purple' | 'red';

interface FloatingActionButtonProps {
  onClick: () => void;
  color?: FABColor;
  icon?: string;
  secondaryIcon?: string;
  label?: string;
  extended?: boolean;
  text?: string;
}

const colorClasses: Record<FABColor, string> = {
  brand: 'fab-main-btn bg-[#293515]/50 dark:bg-[#CCB8E4]/50 text-white dark:text-white backdrop-blur-xl border border-white/15 dark:border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
  amber: 'fab-main-btn bg-amber-500/50 dark:bg-amber-400/50 text-white dark:text-gray-900 backdrop-blur-xl border border-white/15 dark:border-amber-300/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
  green: 'fab-main-btn bg-[#293515]/50 dark:bg-[#CCB8E4]/50 text-white dark:text-white backdrop-blur-xl border border-white/15 dark:border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
  purple: 'fab-main-btn bg-[#CCB8E4]/50 dark:bg-[#CCB8E4]/50 text-[#293515] dark:text-white backdrop-blur-xl border border-white/15 dark:border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
  red: 'fab-main-btn bg-red-600/50 dark:bg-red-500/50 text-white backdrop-blur-xl border border-white/15 dark:border-red-400/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
};

const fabVariants = {
  initial: { opacity: 0, scale: 0.85, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springPresets.popIn,
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    transition: springPresets.stiffQuick,
  },
};

const fabReducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onClick,
  color = 'brand',
  icon = 'add',
  secondaryIcon,
  label,
  extended = false,
  text,
}) => {
  const { isAtBottom, drawerOpen } = useBottomNav();
  const { direction, isAtTop } = useScrollDirection(extended);
  const prefersReducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldCollapse = extended && direction === 'down' && !isAtTop;

  useEffect(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (shouldCollapse) {
      collapseTimerRef.current = setTimeout(() => {
        setCollapsed(true);
      }, 150);
    } else {
      setCollapsed(false);
    }
    return () => {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
      }
    };
  }, [shouldCollapse]);

  useEffect(() => {
    const currentCount = parseInt(document.body.getAttribute('data-fab-count') || '0', 10);
    document.body.setAttribute('data-fab-count', String(currentCount + 1));
    return () => {
      const currentCount = parseInt(document.body.getAttribute('data-fab-count') || '0', 10);
      if (currentCount <= 1) {
        document.body.removeAttribute('data-fab-count');
      } else {
        document.body.setAttribute('data-fab-count', String(currentCount - 1));
      }
    };
  }, []);

  const mobileBottom = isAtBottom 
    ? 'calc(24px + env(safe-area-inset-bottom, 0px))' 
    : 'calc(140px + env(safe-area-inset-bottom, 0px))';

  const isExpanded = extended && !collapsed;

  const iconContent = secondaryIcon ? (
    <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
      <Icon name={secondaryIcon} className="text-2xl" />
      <Icon name={icon} className="text-[10px] font-bold absolute -left-0.5 -top-0.5 text-inherit flex items-center justify-center" />
    </div>
  ) : (
    <Icon name={icon} className="text-2xl shrink-0" />
  );

  const variants = prefersReducedMotion ? fabReducedVariants : fabVariants;

  const labelTransition = prefersReducedMotion
    ? { duration: 0 }
    : { width: springPresets.smooth, opacity: { duration: 0.2 } };

  const fabContent = (
    <AnimatePresence>
      {!drawerOpen && (
        <motion.button
          key="fab"
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClick}
          className={`fixed right-5 md:right-8 bottom-8 shadow-lg flex items-center justify-center hover:shadow-xl hover:brightness-110 dark:hover:brightness-110 active:scale-[0.97] fab-button ${colorClasses[color]} ${
            isExpanded
              ? 'min-h-[56px] px-4 gap-2 rounded-2xl'
              : 'w-14 h-14 rounded-full'
          }`}
          style={{ 
            zIndex: 'var(--z-fab)',
            '--fab-mobile-bottom': mobileBottom,
            transition: 'border-radius 0.35s var(--m3-standard), box-shadow 0.2s var(--m3-standard)',
          } as React.CSSProperties}
          aria-label={isExpanded && text ? text : label || 'Add new item'}
        >
          {iconContent}
          {extended && (
            <motion.span
              className="text-sm font-semibold whitespace-nowrap overflow-hidden"
              animate={{
                width: isExpanded ? 'auto' : 0,
                opacity: isExpanded ? 1 : 0,
              }}
              initial={false}
              transition={labelTransition}
            >
              {text}
            </motion.span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
  
  return createPortal(fabContent, document.body);
};

export default FloatingActionButton;
