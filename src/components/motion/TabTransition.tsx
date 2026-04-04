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
  const rafRef = useRef<number | null>(null);
  const innerRafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevKeyRef.current = activeKey;
      return;
    }

    if (activeKey !== prevKeyRef.current) {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (innerRafRef.current) cancelAnimationFrame(innerRafRef.current);
      prevKeyRef.current = activeKey;

      const el = containerRef.current;
      if (el) {
        el.style.willChange = 'transform, opacity';
        el.style.transition = 'none';
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        rafRef.current = requestAnimationFrame(() => {
          innerRafRef.current = requestAnimationFrame(() => {
            if (!el) return;
            el.style.transition = 'opacity 200ms cubic-bezier(0.2, 0, 0, 1), transform 200ms cubic-bezier(0.2, 0, 0, 1)';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
          });
        });
        enterTimerRef.current = setTimeout(() => {
          el.style.transition = '';
          el.style.opacity = '';
          el.style.transform = '';
          el.style.willChange = 'auto';
        }, 220);
      }
    }

    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (innerRafRef.current) cancelAnimationFrame(innerRafRef.current);
    };
  }, [activeKey]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
};

export default TabTransition;
