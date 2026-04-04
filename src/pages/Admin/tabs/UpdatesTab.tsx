import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuthData } from '../../../contexts/DataContext';
import { useAnnouncementData } from '../../../contexts/AnnouncementDataContext';
import { usePageReady } from '../../../stores/pageReadyStore';
import { formatRelativeTime } from '../../../utils/dateUtils';
import { useNotificationSounds } from '../../../hooks/useNotificationSounds';
import { AnimatedPage } from '../../../components/motion';
import { AnnouncementFormDrawer } from '../../../components/admin/AnnouncementFormDrawer';
import { fetchWithCredentials } from '../../../hooks/queries/useFetch';
import type { Announcement } from '../../../types/data';
import Icon from '../../../components/icons/Icon';
import {
    useStaffNotifications,
    useMarkNotificationRead,
    useMarkAllNotificationsRead,
    useDismissAllNotifications,
} from '../../../hooks/queries/useAdminQueries';

interface StaffNotification {
    id: number;
    user_email: string;
    type: string;
    title: string;
    message: string;
    url?: string | null;
    data?: Record<string, unknown>;
    is_read: boolean;
    created_at: string;
}

const UpdatesTab: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { setPageReady } = usePageReady();
    const { actualUser } = useAuthData();
    const { deleteAnnouncement } = useAnnouncementData();
    const [notificationsRef] = useAutoAnimate();
    const [activeSubTab, setActiveSubTab] = useState<'alerts' | 'announcements'>('alerts');
    const [announcementFormOpen, setAnnouncementFormOpen] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
    const { processNotifications } = useNotificationSounds(true, actualUser?.email);

    const { data: notificationsData, isLoading: notificationsLoading } = useStaffNotifications(actualUser?.email, {
        enabled: !!actualUser?.email,
    });
    const markReadMutation = useMarkNotificationRead();
    const markAllReadMutation = useMarkAllNotificationsRead();
    const dismissAllMutation = useDismissAllNotifications();

    const notifications = useMemo(() => (notificationsData || []) as unknown as StaffNotification[], [notificationsData]);
    const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);

    useEffect(() => {
        if (notifications.length > 0) {
            processNotifications(notifications);
        }
    }, [notifications, processNotifications]);

    const refetchNotifications = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'staff-notifications'] });
    }, [queryClient]);

    useEffect(() => {
        const handleBookingUpdate = () => {
            refetchNotifications();
        };
        window.addEventListener('booking-update', handleBookingUpdate);
        return () => window.removeEventListener('booking-update', handleBookingUpdate);
    }, [refetchNotifications]);

    useEffect(() => {
        if (!notificationsLoading) {
            setPageReady(true);
        }
    }, [notificationsLoading, setPageReady]);

    useEffect(() => {
        const handleSwitchToAlertsTab = () => {
            setActiveSubTab('alerts');
        };
        window.addEventListener('switch-to-alerts-tab', handleSwitchToAlertsTab);
        return () => {
            window.removeEventListener('switch-to-alerts-tab', handleSwitchToAlertsTab);
        };
    }, []);

    const { data: announcementsData, isLoading: announcementsLoading } = useQuery({
        queryKey: ['announcements-feed'],
        queryFn: () => fetchWithCredentials<Announcement[]>('/api/announcements'),
        enabled: activeSubTab === 'announcements',
    });

    const getStaffNotificationRoute = (notif: StaffNotification): string | null => {
        const routeMap: Record<string, string> = {
            booking: '/admin/bookings',
            booking_request: '/admin/bookings',
            booking_approved: '/admin/bookings',
            booking_declined: '/admin/bookings',
            booking_cancelled: '/admin/bookings',
            booking_cancelled_by_staff: '/admin/bookings',
            booking_cancelled_via_trackman: '/admin/bookings',
            booking_reminder: '/admin/bookings',
            booking_update: '/admin/bookings',
            booking_updated: '/admin/bookings',
            booking_confirmed: '/admin/bookings',
            booking_auto_confirmed: '/admin/bookings',
            booking_checked_in: '/admin/bookings',
            booking_created: '/admin/bookings',
            booking_participant_added: '/admin/bookings',
            booking_invite: '/admin/bookings',
            booking_pending: '/admin/bookings',
            cancellation_pending: '/admin/bookings',
            cancellation_stuck: '/admin/bookings',
            attendance: '/admin/bookings',
            trackman_booking: '/admin/bookings',
            trackman_unmatched: '/admin/trackman',
            trackman_cancelled_link: '/admin/bookings',
            event: '/admin/calendar',
            event_rsvp: '/admin/calendar',
            event_rsvp_cancelled: '/admin/calendar',
            event_reminder: '/admin/calendar',
            wellness: '/admin/calendar',
            wellness_booking: '/admin/calendar',
            wellness_enrollment: '/admin/calendar',
            wellness_cancellation: '/admin/calendar',
            wellness_reminder: '/admin/calendar',
            wellness_class: '/admin/calendar',
            tour_scheduled: '/admin/tours',
            tour_reminder: '/admin/tours',
            tour: '/admin/tours',
            payment_success: '/admin/financials',
            payment_failed: '/admin/financials',
            payment_receipt: '/admin/financials',
            payment_error: '/admin/financials',
            payment_dispute: '/admin/financials',
            payment_dispute_closed: '/admin/financials',
            payment_method_update: '/admin/financials',
            outstanding_balance: '/admin/financials',
            fee_waived: '/admin/financials',
            billing: '/admin/financials',
            billing_alert: '/admin/financials',
            billing_migration: '/admin/financials',
            terminal_refund: '/admin/financials',
            terminal_dispute: '/admin/financials',
            terminal_dispute_closed: '/admin/financials',
            terminal_payment_canceled: '/admin/financials',
            funds_added: '/admin/financials',
            membership_renewed: '/admin/directory',
            membership_failed: '/admin/financials',
            membership_past_due: '/admin/financials',
            membership_cancelled: '/admin/directory',
            membership_terminated: '/admin/directory',
            membership_cancellation: '/admin/directory',
            new_member: '/admin/directory',
            member_status_change: '/admin/members',
            membership_tier_change: '/admin/members',
            card_expiring: '/admin/financials',
            trial_expired: '/admin/directory',
            trial_ending: '/admin/directory',
            day_pass: '/admin/bookings',
            guest_pass: '/admin/bookings',
            staff_note: '/admin/members',
            account_deletion: '/admin/members',
            bug_report: '/admin/bugs',
            import_failure: '/admin/data-integrity',
            integration_error: '/admin/data-integrity',
            waiver_review: '/admin/waivers',
            system: '/admin/data-integrity',
            closure: '/admin/notices',
            closure_today: '/admin/notices',
            closure_created: '/admin/notices',
            announcement: '/admin/updates',
            info: '/admin/updates',
            success: '/admin/updates',
            warning: '/admin/updates',
            error: '/admin/updates',
        };
        return routeMap[notif.type] || null;
    };

    const handleNotificationClick = async (notif: StaffNotification) => {
        if (!notif.is_read) {
            markReadMutation.mutate(notif.id, {
                onSuccess: () => {
                    window.dispatchEvent(new CustomEvent('notifications-read'));
                },
            });
        }
        
        const route = notif.url || getStaffNotificationRoute(notif);
        if (route) {
            navigate(route);
        }
    };

    const markAllAsRead = async () => {
        if (!actualUser?.email) return;
        markAllReadMutation.mutate(actualUser.email, {
            onSuccess: () => {
                window.dispatchEvent(new CustomEvent('notifications-read'));
            },
        });
    };

    const dismissAll = async () => {
        if (!actualUser?.email) return;
        dismissAllMutation.mutate(actualUser.email, {
            onSuccess: () => {
                window.dispatchEvent(new CustomEvent('notifications-read'));
            },
        });
    };

    const renderAlertsTab = () => (
        <div className="animate-content-enter">
            {notifications.length > 0 && (
                <div className="flex justify-end gap-2 mb-4">
                    {unreadCount > 0 && (
                        <button 
                            onClick={markAllAsRead}
                            className="tactile-btn text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 dark:text-white/70 dark:hover:text-white dark:bg-white/5 dark:hover:bg-white/10"
                        >
                            Mark all as read
                        </button>
                    )}
                    <button 
                        onClick={dismissAll}
                        className="tactile-btn text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-red-600/70 hover:text-red-600 bg-red-500/5 hover:bg-red-500/10 dark:text-red-400/70 dark:hover:text-red-400"
                    >
                        Dismiss all
                    </button>
                </div>
            )}
            
            <div ref={notificationsRef} className="space-y-3">
            {notificationsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl animate-pulse bg-white dark:bg-white/[0.03]">
                        <div className="flex gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-white/10" />
                            <div className="flex-1">
                                <div className="h-4 w-1/2 rounded mb-2 bg-gray-200 dark:bg-white/10" />
                                <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-white/5" />
                            </div>
                        </div>
                    </div>
                ))
            ) : notifications.length === 0 ? (
                <div className="text-center py-16 text-primary/70 dark:text-white/70">
                    <Icon name="notifications_off" className="text-6xl mb-4 block mx-auto opacity-30" />
                    <p className="text-lg font-medium">No new alerts</p>
                    <p className="text-sm mt-1 opacity-70">New tours, booking requests, and system alerts will appear here.</p>
                </div>
            ) : (
                notifications.map((notif, index) => (
                        <div
                            key={notif.id}
                            onClick={() => handleNotificationClick(notif)}
                            className={`tactile-row rounded-xl transition-colors cursor-pointer overflow-hidden ${
                                notif.is_read 
                                    ? 'bg-white hover:bg-gray-50 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]' 
                                    : 'bg-accent/10 hover:bg-accent/15 border border-accent/30 dark:border-accent/20'
                            } shadow-layered dark:shadow-layered-dark`}
                            style={{ '--stagger-index': index } as React.CSSProperties}
                        >
                            <div className="flex gap-3 p-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                    notif.type === 'booking_request' ? 'bg-blue-500/20' :
                                    notif.type === 'system_alert' ? 'bg-amber-500/20' :
                                    'bg-accent/20'
                                }`}>
                                    <Icon name={notif.type === 'booking_request' ? 'event_note' :
                                         notif.type === 'system_alert' ? 'warning' :
                                         'notifications'} className={`text-[20px] ${ notif.type === 'booking_request' ? 'text-blue-500' : notif.type === 'system_alert' ? 'text-amber-500' : 'text-primary dark:text-white' }`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start">
                                        <h4 className={`font-bold text-sm ${notif.is_read ? 'text-primary/70 dark:text-white/70' : 'text-primary dark:text-white'}`}>
                                            {notif.title}
                                        </h4>
                                        <span className="text-[10px] ml-2 shrink-0 text-primary/70 dark:text-white/70">
                                            {notif.created_at ? formatRelativeTime(notif.created_at) : 'Just now'}
                                        </span>
                                    </div>
                                    <p className={`text-xs mt-0.5 ${notif.is_read ? 'text-primary/70 dark:text-white/70' : 'text-primary/70 dark:text-white/70'}`}>
                                        {notif.message}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))
            )}
            </div>
        </div>
    );

    const handleEditAnnouncement = (ann: Announcement) => {
        setEditingAnnouncement(ann);
        setAnnouncementFormOpen(true);
    };

    const handleDeleteAnnouncement = async (ann: Announcement) => {
        if (!window.confirm(`Delete "${ann.title}"? This cannot be undone.`)) return;
        try {
            await deleteAnnouncement(ann.id);
            queryClient.invalidateQueries({ queryKey: ['announcements-feed'] });
        } catch {
            // error handled by context
        }
    };

    const handleAnnouncementFormClose = () => {
        setAnnouncementFormOpen(false);
        setEditingAnnouncement(null);
        queryClient.invalidateQueries({ queryKey: ['announcements-feed'] });
    };

    const renderAnnouncementsFeed = () => {
        const announcements = Array.isArray(announcementsData) ? announcementsData : [];
        return (
            <div className="animate-content-enter space-y-3">
                <button
                    onClick={() => { setEditingAnnouncement(null); setAnnouncementFormOpen(true); }}
                    className="w-full py-3 px-4 rounded-xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors tactile-btn shadow-md"
                >
                    <Icon name="add" className="text-lg" />
                    New Announcement
                </button>
                {announcementsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="p-4 rounded-xl animate-pulse bg-white dark:bg-white/[0.03]">
                            <div className="h-4 w-1/2 rounded mb-2 bg-gray-200 dark:bg-white/10" />
                            <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-white/5" />
                        </div>
                    ))
                ) : announcements.length === 0 ? (
                    <div className="text-center py-16 text-primary/70 dark:text-white/70">
                        <Icon name="campaign" className="text-6xl mb-4 block mx-auto opacity-30" />
                        <p className="text-lg font-medium">No announcements</p>
                        <p className="text-sm mt-1 opacity-70">Published announcements will appear here.</p>
                    </div>
                ) : (
                    announcements.map((ann) => (
                        <div
                            key={ann.id}
                            className="p-4 rounded-xl bg-white dark:bg-white/[0.03] border border-primary/10 dark:border-white/10"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="font-bold text-sm text-primary dark:text-white">{ann.title}</h4>
                                        {ann.priority && ann.priority !== 'normal' && (
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                ann.priority === 'urgent'
                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                            }`}>{ann.priority}</span>
                                        )}
                                        {ann.showAsBanner && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Banner</span>
                                        )}
                                    </div>
                                    <p className="text-xs mt-0.5 text-primary/70 dark:text-white/70 line-clamp-2">{ann.desc}</p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] text-primary/50 dark:text-white/50 mr-1">
                                        {ann.createdAt ? formatRelativeTime(ann.createdAt) : (ann.date || '')}
                                    </span>
                                    <button
                                        onClick={() => handleEditAnnouncement(ann)}
                                        className="p-1.5 rounded-lg hover:bg-primary/10 dark:hover:bg-white/10 transition-colors"
                                        title="Edit announcement"
                                    >
                                        <Icon name="edit" className="text-base text-primary/60 dark:text-white/60" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAnnouncement(ann)}
                                        className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                        title="Delete announcement"
                                    >
                                        <Icon name="delete" className="text-base text-red-500/70 dark:text-red-400/70" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        );
    };

    return (
            <AnimatedPage className="pb-32">
                <div className="flex gap-1.5 sm:gap-2 mb-6 animate-content-enter-delay-1">
                    <button
                        onClick={() => setActiveSubTab('alerts')}
                        className={`tactile-btn flex-1 py-3 px-2 sm:px-4 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wide transition-colors duration-fast relative ${
                            activeSubTab === 'alerts'
                                ? 'bg-accent text-primary'
                                : 'bg-primary/5 text-primary/80 hover:bg-primary/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
                        }`}
                    >
                        Alerts
                        {unreadCount > 0 && activeSubTab !== 'alerts' && (
                            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveSubTab('announcements')}
                        className={`tactile-btn flex-1 py-3 px-2 sm:px-4 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-wide transition-colors duration-fast ${
                            activeSubTab === 'announcements'
                                ? 'bg-[#CCB8E4] text-[#293515]'
                                : 'bg-primary/5 text-primary/80 hover:bg-primary/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
                        }`}
                    >
                        Announce
                    </button>
                </div>

                {activeSubTab === 'alerts' && renderAlertsTab()}
                {activeSubTab === 'announcements' && renderAnnouncementsFeed()}

                <AnnouncementFormDrawer
                    isOpen={announcementFormOpen}
                    onClose={handleAnnouncementFormClose}
                    editItem={editingAnnouncement}
                />
            </AnimatedPage>
    );
};

export default UpdatesTab;
