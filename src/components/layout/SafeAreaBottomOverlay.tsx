import React from 'react';
import { createPortal } from 'react-dom';
import { useBottomNav } from '../../contexts/BottomNavContext';

interface SafeAreaBottomOverlayProps {
  children: React.ReactNode;
}

export const SafeAreaBottomOverlay: React.FC<SafeAreaBottomOverlayProps> = ({ children }) => {
  const overlayRoot = document.getElementById('nav-overlay-root');
  const { isAtBottom, drawerOpen } = useBottomNav();
  
  if (!overlayRoot) return null;
  
  const isHidden = isAtBottom || drawerOpen;
  
  const overlayContent = (
    <div 
      className={`fixed inset-x-0 bottom-0 pointer-events-none transition-all duration-300 ease-out lg:hidden ${isHidden ? 'translate-y-[calc(100%+env(safe-area-inset-bottom,0px))] opacity-0' : 'translate-y-0 opacity-100'}`}
      style={{ zIndex: 'var(--z-nav)' }}
    >
      {children}
      <div 
        className="w-full pointer-events-none bg-transparent"
        style={{ 
          height: 'env(safe-area-inset-bottom, 0px)'
        }}
      />
    </div>
  );
  
  return createPortal(overlayContent, overlayRoot);
};
