import React, { useState, useEffect, useRef } from 'react';

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
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'entering'>('idle');
  const prevKeyRef = useRef(activeKey);
  const isFirstRender = useRef(true);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevKeyRef.current = activeKey;
      return;
    }

    if (activeKey !== prevKeyRef.current) {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);

      prevKeyRef.current = activeKey;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnimationPhase('entering');

      enterTimerRef.current = setTimeout(() => {
        setAnimationPhase('idle');
      }, 200);
    }

    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    };
  }, [activeKey]);

  const animationClass = animationPhase === 'entering' ? 'animate-tab-enter' : '';

  return (
    <div className={`${animationClass} ${className}`}>
      {children}
    </div>
  );
};

export default TabTransition;
