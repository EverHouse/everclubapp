import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollLockManager } from '../hooks/useScrollLockManager';
import { haptic } from '../utils/haptics';

interface MenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const previewImages: Record<string, string> = {
  'Membership': '/images/golf-sims-optimized.webp',
  'Cafe': '/images/cafe-bar-optimized.webp',
  'Host Events': '/images/private-dining-optimized.webp',
  "What's On": '/images/events-crowd-optimized.webp',
  'Gallery': '/images/venue-wide-optimized.webp',
  'FAQ': '/images/cowork-optimized.webp',
};

const defaultPreviewImage = '/images/hero-lounge-optimized.webp';

const MenuOverlay: React.FC<MenuOverlayProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsVisible(true);
      setIsClosing(false);
    } else if (isVisible) {
      setIsClosing(true);
      timerRef.current = setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
        timerRef.current = null;
      }, 250);
    }
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setHoveredLink(null);
    }
  }, [isVisible]);

  useScrollLockManager(isVisible);

  const handleClose = () => {
    haptic.selection();
    onClose();
  };

  const handleNav = (path: string) => {
    haptic.light();
    navigate(path);
    handleClose();
  };

  if (!isVisible) return null;

  const currentPreviewImage = hoveredLink ? previewImages[hoveredLink] || defaultPreviewImage : defaultPreviewImage;

  const menuContent = (
    <div className="fixed inset-0 flex justify-start overflow-hidden pointer-events-auto" style={{ zIndex: 'var(--z-drawer)' }}>
      <div 
        className={`absolute inset-0 bg-black/20 backdrop-blur-xl ${isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'}`}
        onClick={handleClose}
      ></div>

      <div className={`relative w-[85%] md:w-[320px] lg:w-[680px] h-full flex flex-col lg:flex-row overflow-hidden glass-navbar rounded-none rounded-r-[2rem] border-l-0 ${isClosing ? 'animate-slide-out-left' : 'animate-slide-in-left'}`}>
        
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] pointer-events-none mix-blend-multiply"></div>

        <div className={`relative z-10 flex flex-col h-full lg:w-[320px] py-8 safe-area-inset-menu ${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`}>
            
            <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={() => handleNav('/')}
                  aria-label="Go to home"
                  className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform duration-300 rounded-full active:scale-90 hover:scale-105"
                >
                  <img 
                    src={isDark ? "/assets/logos/mascot-white.webp" : "/assets/logos/mascot-dark.webp"}
                    alt="Ever House"
                    className="h-10 w-auto object-contain"
                  />
                </button>
                <button 
                  onClick={handleClose}
                  aria-label="Close menu"
                  className={`w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center hover:rotate-90 transition-transform duration-300 rounded-full active:scale-90 lg:hidden ${isDark ? 'text-[#F2F2EC] hover:bg-white/10' : 'text-[#293515] hover:bg-black/5'}`}
                >
                    <span className="material-symbols-outlined text-3xl">close</span>
                </button>
            </div>
            
            <nav className="flex flex-col gap-4 flex-1 overflow-y-auto scrollbar-hide py-2">
                <MenuLink 
                  label="Membership" 
                  onClick={() => handleNav('/membership')} 
                  delay="0.05s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink('Membership')}
                  onMouseLeave={() => setHoveredLink(null)}
                />
                <MenuLink 
                  label="Cafe" 
                  onClick={() => handleNav('/menu')} 
                  delay="0.1s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink('Cafe')}
                  onMouseLeave={() => setHoveredLink(null)}
                />
                <MenuLink 
                  label="Host Events" 
                  onClick={() => handleNav('/private-hire')} 
                  delay="0.15s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink('Host Events')}
                  onMouseLeave={() => setHoveredLink(null)}
                />
                <MenuLink 
                  label="What's On" 
                  onClick={() => handleNav('/whats-on')} 
                  delay="0.2s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink("What's On")}
                  onMouseLeave={() => setHoveredLink(null)}
                />
                <MenuLink 
                  label="Gallery" 
                  onClick={() => handleNav('/gallery')} 
                  delay="0.25s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink('Gallery')}
                  onMouseLeave={() => setHoveredLink(null)}
                />
                <MenuLink 
                  label="FAQ" 
                  onClick={() => handleNav('/faq')} 
                  delay="0.3s" 
                  isDark={isDark}
                  onMouseEnter={() => setHoveredLink('FAQ')}
                  onMouseLeave={() => setHoveredLink(null)}
                />
            </nav>
            
            <div className={`mt-4 pt-6 border-t animate-pop-in ${isDark ? 'border-[#F2F2EC]/10' : 'border-[#293515]/10'}`} style={{ animationDelay: '0.4s' }}>
                <button 
                    onClick={() => handleNav('/contact')}
                    className={`w-full group flex items-center justify-between px-4 py-3 min-h-[44px] rounded-[2rem] glass-button border ${isDark ? 'border-white/20' : 'border-black/20'}`}
                >
                    <span className={`text-xl font-bold ${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`}>Contact Us</span>
                    <span className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full glass-button flex items-center justify-center group-hover:scale-110 transition-all duration-[400ms] ease-in-out">
                        <span className={`material-symbols-outlined ${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`}>arrow_forward</span>
                    </span>
                </button>
            </div>
        </div>

        <div className="hidden lg:flex lg:flex-1 relative z-10 p-6 pl-0 items-center">
          <div className="relative w-full h-full max-h-[500px] rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.15)]">
            {Object.entries(previewImages).map(([label, imagePath]) => (
              <img
                key={label}
                src={imagePath}
                alt={`${label} preview`}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
                  currentPreviewImage === imagePath ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ))}
            {!Object.values(previewImages).includes(currentPreviewImage) && (
              <img
                src={defaultPreviewImage}
                alt="Default preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
          </div>
          
          <button 
            onClick={handleClose}
            aria-label="Close menu"
            className={`absolute top-6 right-6 w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center hover:rotate-90 transition-transform duration-300 rounded-full active:scale-90 ${isDark ? 'text-[#F2F2EC] hover:bg-white/10' : 'text-[#293515] hover:bg-black/5'}`}
          >
            <span className="material-symbols-outlined text-3xl">close</span>
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(menuContent, document.body);
};

interface MenuLinkProps {
  label: string;
  onClick: () => void;
  delay: string;
  isDark: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const MenuLink: React.FC<MenuLinkProps> = ({ label, onClick, delay, isDark, onMouseEnter, onMouseLeave }) => {
  const lastTapRef = useRef(0);
  
  const handlePointerUp = () => {
    if (Date.now() - lastTapRef.current < 350) return;
    lastTapRef.current = Date.now();
    onClick();
  };
  
  return (
    <button 
      type="button"
      onClick={onClick}
      onPointerUp={handlePointerUp}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ touchAction: 'manipulation', animationDelay: delay, animationFillMode: 'both' }}
      className={`text-left text-[24px] font-display font-medium transition-all duration-300 tracking-tight animate-pop-in leading-tight min-h-[44px] hoverable-translate active:translate-x-2 ${isDark ? 'text-[#F2F2EC] hover:text-[#F2F2EC]/80' : 'text-[#293515] hover:text-[#293515]/80'}`}
    >
      {label}
    </button>
  );
};

export default MenuOverlay;
