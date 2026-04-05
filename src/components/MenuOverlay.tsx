import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useScrollLockManager } from '../hooks/useScrollLockManager';
import { useNavigationLoading } from '../stores/navigationLoadingStore';
import { haptic } from '../utils/haptics';
import { springPresets, sidebarVariants, backdropVariants, menuItemVariants, menuContainerVariants } from '../utils/motion';
import Icon from './icons/Icon';

interface MenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const MenuOverlay: React.FC<MenuOverlayProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const { startNavigation } = useNavigationLoading();
  const isDark = effectiveTheme === 'dark';
  const prefersReduced = useReducedMotion();
  const originalBodyBgRef = useRef<string>('');
  const originalHtmlBgRef = useRef<string>('');
  const scrollingRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const scrollCooldownRef = useRef<NodeJS.Timeout | null>(null);

  const menuBgColor = isDark ? '#141414' : '#F2F2EC';

  useEffect(() => {
    return () => {
      if (scrollCooldownRef.current) {
        clearTimeout(scrollCooldownRef.current);
        scrollCooldownRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      originalBodyBgRef.current = document.body.style.backgroundColor || '';
      originalHtmlBgRef.current = document.documentElement.style.backgroundColor || '';
      document.documentElement.style.backgroundColor = menuBgColor;
      document.body.style.backgroundColor = menuBgColor;
    }
    return () => {
      if (isOpen) {
        document.documentElement.style.backgroundColor = originalHtmlBgRef.current;
        document.body.style.backgroundColor = originalBodyBgRef.current;
      }
    };
  }, [isOpen, menuBgColor]);

  useScrollLockManager(isOpen);

  const handleExitComplete = () => {
    document.documentElement.style.backgroundColor = originalHtmlBgRef.current;
    document.body.style.backgroundColor = originalBodyBgRef.current;
  };

  const handleClose = () => {
    haptic.selection();
    onClose();
  };

  const handleNav = (path: string) => {
    haptic.light();
    startNavigation();
    navigate(path);
    handleClose();
  };

  const handleDrag = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    if (info.offset.x < -50 || info.velocity.x < -300) {
      handleClose();
    }
  };

  const sidebarTransition = prefersReduced
    ? { duration: 0.15 }
    : springPresets.sheet;

  const backdropTransition = prefersReduced
    ? { duration: 0.15 }
    : { duration: 0.25 };

  const menuContent = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {isOpen && (
        <div 
          className="fixed inset-0 flex justify-start pointer-events-auto" 
          style={{ zIndex: 'var(--z-drawer)' }}
        >
          <motion.div 
            className="absolute inset-0 bg-black/20 backdrop-blur-xl"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={backdropTransition}
            onClick={handleClose}
            aria-hidden="true"
          />

          <motion.div 
            className="relative w-[85%] md:w-[320px] lg:w-[320px] h-full flex flex-col border-l-0"
            variants={sidebarVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={sidebarTransition}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.4, right: 0 }}
            onDragEnd={handleDrag}
          >
          <div 
            style={{ height: '100%' }}
            className={`relative flex flex-col overflow-hidden rounded-tr-xl rounded-br-xl ${isDark ? 'bg-[#141414]' : 'bg-[#F2F2EC]'} backdrop-blur-xl`}
          >
            
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-multiply"></div>

            <div className={`relative z-10 flex flex-col lg:w-[320px] safe-area-inset-menu h-full ${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`}>
                
                <div className="flex items-center justify-between mb-10">
                    <button 
                      onClick={() => handleNav('/')}
                      aria-label="Go to home"
                      className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform duration-normal rounded-full active:scale-90 hover:scale-105"
                    >
                      <img 
                        src={isDark ? "/assets/logos/mascot-white.webp" : "/assets/logos/mascot-dark.webp"}
                        alt="Ever Club mascot character"
                        className="h-10 w-auto object-contain"
                        width={40}
                        height={40}
                      />
                    </button>
                    <button 
                      onClick={handleClose}
                      aria-label="Close menu"
                      className={`w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center hover:rotate-90 transition-transform duration-normal rounded-full active:scale-90 tactile-btn ${isDark ? 'text-[#F2F2EC] hover:bg-white/10' : 'text-[#293515] hover:bg-black/5'}`}
                    >
                        <Icon name="close" className="text-3xl" />
                    </button>
                </div>
                
                <motion.nav
                  className="flex flex-col gap-0 flex-1 overflow-y-auto scrollbar-hide py-4" data-scroll-lock-allow
                  variants={prefersReduced ? undefined : menuContainerVariants}
                  initial="hidden"
                  animate="visible"
                  onTouchStart={(e) => {
                    touchStartYRef.current = e.touches[0].clientY;
                    if (scrollCooldownRef.current) {
                      clearTimeout(scrollCooldownRef.current);
                      scrollCooldownRef.current = null;
                    }
                  }}
                  onTouchMove={(e) => {
                    if (touchStartYRef.current !== null && Math.abs(e.touches[0].clientY - touchStartYRef.current) > 8) {
                      scrollingRef.current = true;
                    }
                  }}
                  onTouchEnd={() => {
                    touchStartYRef.current = null;
                    if (scrollingRef.current) {
                      scrollCooldownRef.current = setTimeout(() => {
                        scrollingRef.current = false;
                        scrollCooldownRef.current = null;
                      }, 300);
                    }
                  }}
                >
                    <MenuLink label="Membership" onClick={() => handleNav('/membership')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                    <MenuLink label="Cafe" onClick={() => handleNav('/menu')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                    <MenuLink label="Host Events" onClick={() => handleNav('/private-hire')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                    <MenuLink label="What's On" onClick={() => handleNav('/whats-on')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                    <MenuLink label="Gallery" onClick={() => handleNav('/gallery')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                    <MenuLink label="FAQ" onClick={() => handleNav('/faq')} isDark={isDark} scrollingRef={scrollingRef} prefersReduced={prefersReduced} />
                </motion.nav>
                
                <motion.div
                  className={`mt-4 pt-6 border-t ${isDark ? 'border-[#F2F2EC]/10' : 'border-[#293515]/10'}`}
                  variants={prefersReduced ? undefined : menuItemVariants}
                  transition={prefersReduced ? { duration: 0 } : springPresets.listItem}
                >
                    <button 
                        onClick={() => handleNav('/contact')}
                        style={{ fontFamily: 'var(--font-label)' }}
                        className={`w-full group flex items-center justify-between px-4 py-3 min-h-[44px] rounded-[4px] glass-button border tactile-btn ${isDark ? 'border-white/20' : 'border-black/20'}`}
                    >
                        <span className={`text-sm uppercase tracking-[0.3em] font-semibold ${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`}>Contact Us</span>
                        <span className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full glass-button flex items-center justify-center group-hover:scale-110 transition-transform duration-[400ms] ease-in-out">
                            <Icon name="arrow_forward" className={`${isDark ? 'text-[#F2F2EC]' : 'text-[#293515]'}`} />
                        </span>
                    </button>
                </motion.div>
            </div>
          </div>
          <div className={`flex-1 ${isDark ? 'bg-[#141414]' : 'bg-[#F2F2EC]'}`} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(menuContent, document.body);
};

interface MenuLinkProps {
  label: string;
  onClick: () => void;
  isDark: boolean;
  scrollingRef: React.MutableRefObject<boolean>;
  prefersReduced: boolean | null;
}

const MenuLink: React.FC<MenuLinkProps> = ({ label, onClick, isDark, scrollingRef, prefersReduced }) => {
  const handleClick = () => {
    if (scrollingRef.current) return;
    onClick();
  };

  return (
    <motion.button 
      type="button"
      onClick={handleClick}
      style={{ touchAction: 'pan-y', fontFamily: 'var(--font-label)' }}
      variants={prefersReduced ? undefined : menuItemVariants}
      transition={prefersReduced ? { duration: 0 } : springPresets.listItem}
      className={`text-left text-sm uppercase tracking-[0.3em] font-medium py-4 transition-interactive duration-normal leading-none min-h-[44px] hoverable-translate active:translate-x-2 tactile-row ${isDark ? 'text-[#F2F2EC]/70 hover:text-[#F2F2EC]' : 'text-[#293515]/70 hover:text-[#293515]'}`}
    >
      {label}
    </motion.button>
  );
};

export default MenuOverlay;
