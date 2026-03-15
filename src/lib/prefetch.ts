import { registerMemberRoutes, registerStaffRoutes } from './prefetch-actions';

export { prefetchRoute, prefetchAdjacentRoutes, prefetchOnIdle, prefetchAllNavRoutes, prefetchStaffRoute, prefetchAdjacentStaffRoutes, prefetchMemberProfile, prefetchBookingDetail } from './prefetch-actions';

registerMemberRoutes(
  {
    '/book': () => import('../pages/Member/BookGolf'),
    '/events': () => import('../pages/Member/Events'),
    '/wellness': () => import('../pages/Member/Wellness'),
    '/profile': () => import('../pages/Member/Profile'),
    '/dashboard': () => import('../pages/Member/Dashboard'),
    '/updates': () => import('../pages/Member/Updates'),
  },
  {
    '/book': ['/api/bays'],
    '/events': ['/api/events'],
    '/wellness': ['/api/wellness-classes'],
    '/updates': ['/api/announcements', '/api/closures'],
    '/dashboard': ['/api/member/dashboard/bookings', '/api/member/dashboard/booking-requests', '/api/member/dashboard/stats'],
  }
);

registerStaffRoutes(
  {
    '/admin': () => import('../pages/Admin/AdminDashboard'),
    '/admin/bookings': () => import('../pages/Admin/tabs/SimulatorTab'),
    '/admin/financials': () => import('../pages/Admin/tabs/FinancialsTab'),
    '/admin/directory': () => import('../pages/Admin/tabs/DirectoryTab'),
    '/admin/calendar': () => import('../pages/Admin/tabs/EventsTab'),
    '/admin/notices': () => import('../pages/Admin/tabs/BlocksTab'),
    '/admin/updates': () => import('../pages/Admin/tabs/UpdatesTab'),
    '/admin/tours': () => import('../pages/Admin/tabs/ToursTab'),
    '/admin/team': () => import('../pages/Admin/tabs/TeamTab'),
    '/admin/tiers': () => import('../pages/Admin/tabs/TiersTab'),
    '/admin/changelog': () => import('../pages/Admin/tabs/ChangelogTab'),
  },
  {
    '/admin': ['/api/admin/dashboard-summary'],
    '/admin/bookings': ['/api/admin/todays-bookings'],
    '/admin/directory': ['/api/members/directory'],
    '/admin/financials': ['/api/admin/financials/summary'],
  }
);
