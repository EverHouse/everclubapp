import React, { createContext, useContext, useCallback, useRef, useEffect } from 'react';

export interface TransitionCustom {
  direction: number;
  distance: number;
}

const defaultCustom: TransitionCustom = { direction: 1, distance: 1 };

// eslint-disable-next-line react-refresh/only-export-components
export const TransitionContext = createContext<TransitionCustom>(defaultCustom);

// eslint-disable-next-line react-refresh/only-export-components
export const useTransitionState = () => useContext(TransitionContext);

// eslint-disable-next-line react-refresh/only-export-components
export const PageExitContext = createContext(false);

interface DirectionalPageTransitionProps {
  children: React.ReactNode;
}

const DirectionalPageTransition: React.FC<DirectionalPageTransitionProps> = ({ children }) => {
  const isExiting = useContext(PageExitContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.style.willChange = 'transform, opacity';
  }, [isExiting]);

  const handleAnimationEnd = useCallback(() => {
    if (ref.current) ref.current.style.willChange = 'auto';
  }, []);

  return (
    <div
      ref={ref}
      className={isExiting ? 'page-fade-out' : 'page-fade-in'}
      style={{ minHeight: '100%' }}
      onAnimationEnd={handleAnimationEnd}
    >
      {children}
    </div>
  );
};

export default DirectionalPageTransition;
