export type TabType = 'home' | 'events' | 'announcements' | 'directory' | 'simulator' | 'team' | 'faqs' | 'inquiries' | 'applications' | 'gallery' | 'tiers' | 'blocks' | 'changelog' | 'training' | 'updates' | 'tours' | 'bugs' | 'trackman' | 'data-integrity' | 'settings' | 'financials' | 'email-templates';

export interface NavItemData {
  id: TabType;
  icon: string;
  label: string;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItemData[] = [
  { id: 'home', icon: 'home', label: 'Home' },
  { id: 'simulator', icon: 'event_note', label: 'Bookings' },
  { id: 'financials', icon: 'point_of_sale', label: 'Financials' },
  { id: 'events', icon: 'calendar_month', label: 'Calendar' },
  { id: 'directory', icon: 'groups', label: 'Directory' },
];

export const MAIN_NAV_ITEMS: NavItemData[] = [
  { id: 'home', icon: 'dashboard', label: 'Dashboard' },
  { id: 'simulator', icon: 'event_note', label: 'Bookings' },
  { id: 'financials', icon: 'point_of_sale', label: 'Financials' },
  { id: 'tours', icon: 'directions_walk', label: 'Tours' },
  { id: 'events', icon: 'calendar_month', label: 'Calendar' },
  { id: 'blocks', icon: 'domain', label: 'Facility' },
  { id: 'updates', icon: 'campaign', label: 'Updates' },
  { id: 'directory', icon: 'group', label: 'Directory' },
  { id: 'training', icon: 'school', label: 'Training' },
];

export const ADMIN_NAV_ITEMS: NavItemData[] = [
  { id: 'tiers', icon: 'storefront', label: 'Products', adminOnly: true },
  { id: 'team', icon: 'badge', label: 'Team', adminOnly: true },
  { id: 'gallery', icon: 'photo_library', label: 'Gallery', adminOnly: true },
  { id: 'faqs', icon: 'help_outline', label: 'FAQs', adminOnly: true },
  { id: 'inquiries', icon: 'mail', label: 'Inquiries', adminOnly: true },
  { id: 'applications', icon: 'how_to_reg', label: 'Applications', adminOnly: true },
  { id: 'bugs', icon: 'bug_report', label: 'Bugs', adminOnly: true },
  { id: 'email-templates', icon: 'forward_to_inbox', label: 'Emails', adminOnly: true },
  { id: 'changelog', icon: 'history', label: 'Changelog', adminOnly: true },
  { id: 'data-integrity', icon: 'fact_check', label: 'Integrity', adminOnly: true },
  { id: 'settings', icon: 'settings', label: 'Settings', adminOnly: true },
];

export const tabToPath: Record<TabType, string> = {
  'home': '/admin',
  'simulator': '/admin/bookings',
  'directory': '/admin/directory',
  'events': '/admin/calendar',
  'blocks': '/admin/notices',
  'updates': '/admin/updates',
  'announcements': '/admin/news',
  'team': '/admin/team',
  'tiers': '/admin/tiers',
  'trackman': '/admin/trackman',
  'data-integrity': '/admin/data-integrity',
  'financials': '/admin/financials',
  'gallery': '/admin/gallery',
  'faqs': '/admin/faqs',
  'inquiries': '/admin/inquiries',
  'bugs': '/admin/bugs',
  'settings': '/admin/settings',
  'changelog': '/admin/changelog',
  'tours': '/admin/tours',
  'training': '/admin/training',
  'applications': '/admin/applications',
  'email-templates': '/admin/email-templates'
};

export const pathToTab: Record<string, TabType> = Object.entries(tabToPath).reduce(
  (acc, [tab, path]) => {
    acc[path] = tab as TabType;
    return acc;
  },
  {} as Record<string, TabType>
);

export function getTabFromPathname(pathname: string): TabType {
  if (pathToTab[pathname]) {
    return pathToTab[pathname];
  }
  if (pathname === '/admin' || pathname === '/admin/') {
    return 'home';
  }
  const pathWithoutTrailingSlash = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (pathToTab[pathWithoutTrailingSlash]) {
    return pathToTab[pathWithoutTrailingSlash];
  }
  return 'home';
}
