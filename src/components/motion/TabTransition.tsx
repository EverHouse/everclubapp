import React, { useLayoutEffect, useRef } from 'react';

interface TabTransitionProps {
  activeKey: string | number;
  children: React.ReactNode;
  className?: string;
}

export const TabTransition: React.FC<TabTransitionProps> = ({ 
  activeKey, 
  children, 
  className = '' 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevKeyRef = useRef(activeKey);
  const isFirstRender = useRef(true);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevKeyRef.current = activeKey;
      return;
    }

    if (activeKey !== prevKeyRef.current) {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      prevKeyRef.current = activeKey;

      const el = containerRef.current;
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        requestAnimationFrame(() => {
          el.style.transition = 'opacity 200ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1)';
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        });
        enterTimerRef.current = setTimeout(() => {
          el.style.transition = '';
          el.style.opacity = '';
          el.style.transform = '';
        }, 220);
      }
    }

    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    };
  }, [activeKey]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
};

export default TabTransition;
