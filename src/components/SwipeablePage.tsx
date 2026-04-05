import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface SwipeablePageProps {
  children: React.ReactNode;
  className?: string;
}

const SwipeablePage: React.FC<SwipeablePageProps> = ({ children, className = "" }) => {
  const { effectiveTheme } = useTheme();
  const _isDark = effectiveTheme === 'dark';

  return (
    <div 
      className={`full-bleed-page w-full bg-transparent ${className}`}
      style={{
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)'
      }}
    >
      {children}
    </div>
  );
};

export default SwipeablePage;
