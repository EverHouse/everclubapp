import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useNavigationLoading } from '../contexts/NavigationLoadingContext';
import { getLatestVersion } from '../data/changelog';
import { TabType } from '../pages/Admin/layout/types';

interface NavItem {
  id: TabType;
  icon: string;
  label: string;
}

interface StaffMobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  isAdmin?: boolean;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: 'dashboard', label: 'Dashboard' },
  { id: 'simulator', icon: 'event_note', label: 'Bookings' },
  { id: 'financials', icon: 'point_of_sale', label: 'Financials' },
  { id: 'tours', icon: 'directions_walk', label: 'Tours' },
  { id: 'events', icon: 'calendar_month', label: 'Calendar' },
  { id: 'blocks', icon: 'domain', label: 'Facility' },
  { id: 'updates', icon: 'campaign', label: 'Updates' },
  { id: 'directory', icon: 'group', label: 'Directory' },
];

const RESOURCES_ITEMS: NavItem[] = [
  { id: 'cafe', icon: 'local_cafe', label: 'Cafe Menu' },
  { id: 'training', icon: 'school', label: 'Training Guide' },
  { id: 'team', icon: 'badge', label: 'Team' },
];

const ADMIN_ITEMS: NavItem[] = [
  { id: 'tiers', icon: 'settings', label: 'Membership Config' },
  { id: 'gallery', icon: 'photo_library', label: 'Gallery' },
  { id: 'faqs', icon: 'help_outline', label: 'FAQs' },
  { id: 'inquiries', icon: 'mail', label: 'Inquiries' },
  { id: 'bugs', icon: 'bug_report', label: 'Bug Reports' },
  { id: 'changelog', icon: 'history', label: 'Changelog' },
  { id: 'data-integrity', icon: 'fact_check', label: 'Data Integrity' },
];

export const StaffMobileSidebar: React.FC<StaffMobileSidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  isAdmin = false,
}) => {
  const navigate = useNavigate();
  const { startNavigation } = useNavigationLoading();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleNavClick = (tab: TabType) => {
    onTabChange(tab);
    onClose();
  };

  const handleHomeClick = () => {
    startNavigation();
    navigate('/');
    onClose();
  };

  const NavButton: React.FC<{ item: NavItem }> = ({ item }) => {
    const isActive = activeTab === item.id;
    return (
      <button
        onClick={() => handleNavClick(item.id)}
        className={`
          relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200
          ${isActive 
            ? 'text-white font-semibold' 
            : 'text-white/70 hover:bg-white/10 hover:text-white'
          }
        `}
      >
        {isActive && (
          <div className="absolute inset-0 rounded-xl bg-white/15 border border-white/25 shadow-[0_0_20px_rgba(255,255,255,0.08),inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-md" />
        )}
        <span className={`material-symbols-outlined text-xl relative z-10 ${isActive ? 'filled text-[#CCB8E4]' : ''}`}>
          {item.icon}
        </span>
        <span className="text-sm relative z-10">{item.label}</span>
        {isActive && (
          <span className="relative z-10 ml-auto w-2 h-2 rounded-full bg-[#CCB8E4]" />
        )}
      </button>
    );
  };

  if (!isOpen) return null;

  const sidebarContent = (
    <div className="lg:hidden fixed inset-0" style={{ zIndex: 'var(--z-modal, 100)' }}>
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <aside 
        className="absolute left-0 top-0 bottom-0 w-72 bg-[#293515] shadow-2xl flex flex-col animate-slide-in-left"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button 
          onClick={handleHomeClick}
          className="flex items-center gap-3 px-4 py-5 flex-shrink-0 hover:opacity-80 transition-opacity w-full text-left border-b border-white/10"
          aria-label="Go to home"
        >
          <img 
            src="/assets/logos/mascot-white.webp" 
            alt="Ever House" 
            className="h-10 w-auto object-contain"
          />
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Staff Portal</h1>
            <p className="text-white/50 text-xs">Ever House</p>
          </div>
        </button>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-1">
            {MAIN_NAV_ITEMS.map(item => (
              <NavButton key={item.id} item={item} />
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="px-3 mb-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
              Resources
            </p>
            <div className="space-y-1">
              {RESOURCES_ITEMS.map(item => (
                <NavButton key={item.id} item={item} />
              ))}
            </div>
          </div>

          {isAdmin && (
            <div className="mt-6 pt-4 border-t border-white/10">
              <p className="px-3 mb-2 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                Admin
              </p>
              <div className="space-y-1">
                {ADMIN_ITEMS.map(item => (
                  <NavButton key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-white/10 flex-shrink-0" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
          <p className="text-white/40 text-[10px] text-center">
            v{getLatestVersion().version} · Updated {new Date(getLatestVersion().date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </aside>
    </div>
  );

  return createPortal(sidebarContent, document.body);
};

export default StaffMobileSidebar;
