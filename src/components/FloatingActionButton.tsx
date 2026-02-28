import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBottomNav } from '../contexts/BottomNavContext';

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
  brand: 'fab-main-btn bg-[#293515] dark:bg-[#CCB8E4] text-white dark:text-[#293515] backdrop-blur-xl border border-[#293515]/80 dark:border-[#CCB8E4]/80 shadow-lg',
  amber: 'fab-main-btn bg-amber-500/50 dark:bg-amber-400/50 text-white dark:text-gray-900 backdrop-blur-xl border border-white/30 dark:border-amber-300/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]',
  green: 'fab-main-btn bg-[#293515] dark:bg-[#CCB8E4] text-white dark:text-[#293515] backdrop-blur-xl border border-[#293515]/80 dark:border-[#CCB8E4]/80 shadow-lg',
  purple: 'fab-main-btn bg-[#CCB8E4]/50 dark:bg-[#CCB8E4]/50 text-[#293515] dark:text-[#293515] backdrop-blur-xl border border-white/40 dark:border-white/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]',
  red: 'fab-main-btn bg-red-600/50 dark:bg-red-500/50 text-white backdrop-blur-xl border border-white/30 dark:border-red-400/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]',
};

const SCROLL_THRESHOLD = 10;

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
  const [collapsed, setCollapsed] = useState(false);
  const lastScrollY = useRef(0);
  const rafId = useRef<number>(0);

  const handleScroll = useCallback(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const currentY = window.scrollY;
      if (currentY <= 0) {
        setCollapsed(false);
      } else if (currentY - lastScrollY.current > SCROLL_THRESHOLD) {
        setCollapsed(true);
      } else if (lastScrollY.current - currentY > SCROLL_THRESHOLD) {
        setCollapsed(false);
      }
      lastScrollY.current = currentY;
    });
  }, []);

  useEffect(() => {
    if (!extended) return;
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [extended, handleScroll]);

  useEffect(() => {
    document.body.classList.add('has-fab');
    return () => {
      document.body.classList.remove('has-fab');
    };
  }, []);
  
  if (drawerOpen) return null;
  
  const mobileBottom = isAtBottom 
    ? 'calc(24px + env(safe-area-inset-bottom, 0px))' 
    : 'calc(140px + env(safe-area-inset-bottom, 0px))';

  const isExpanded = extended && !collapsed;

  const iconContent = secondaryIcon ? (
    <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
      <span className="material-symbols-outlined text-2xl">{secondaryIcon}</span>
      <span className="material-symbols-outlined text-[10px] font-bold absolute -left-0.5 -top-0.5 text-inherit flex items-center justify-center">{icon}</span>
    </div>
  ) : (
    <span className="material-symbols-outlined text-2xl shrink-0">{icon}</span>
  );

  const fabContent = (
    <button
      onClick={onClick}
      className={`fixed right-5 md:right-8 bottom-8 shadow-lg flex items-center justify-center transition-all duration-200 ease-out hover:scale-110 active:scale-95 fab-button animate-fab-bounce-in ${colorClasses[color]} ${
        isExpanded
          ? 'min-h-[56px] px-4 gap-3 rounded-2xl'
          : 'w-14 h-14 rounded-full'
      }`}
      style={{ 
        zIndex: 'var(--z-fab)',
        '--fab-mobile-bottom': mobileBottom,
      } as React.CSSProperties}
      aria-label={isExpanded && text ? text : label || 'Add new item'}
    >
      {iconContent}
      {extended && (
        <span
          className={`text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-200 ease-out ${
            isExpanded ? 'max-w-[200px] opacity-100' : 'max-w-0 opacity-0'
          }`}
        >
          {text}
        </span>
      )}
    </button>
  );
  
  return createPortal(fabContent, document.body);
};

export default FloatingActionButton;
