import { useMemo } from 'react';
import { getTodayPacific, addDaysToPacificDate } from '../../../../utils/dateUtils';
import {
    useResources,
    useBays,
    useAllBookingRequests,
    usePendingBookings,
    useApprovedBookings,
    useCalendarClosures,
    useAvailabilityBlocks,
    useMemberContacts,
} from '../../../../hooks/queries/useBookingsQueries';
import { BOOKING_STATUS } from '../../../../../shared/constants/statuses';

import type { BookingRequest, Bay, Resource, CalendarClosure, AvailabilityBlock } from '../simulator/simulatorTypes';

export function useSimulatorQueries(calendarDate: string) {
    const { data: resourcesData = [], isLoading: resourcesLoading } = useResources();
    const { data: baysData = [], isLoading: baysLoading } = useBays();
    const { data: bookingRequestsData = [], isLoading: requestsLoading } = useAllBookingRequests();
    const { data: pendingBookingsData = [] } = usePendingBookings();
    const { data: memberContactsData = [] } = useMemberContacts('all');
    const { data: closuresData = [] } = useCalendarClosures();

    const today = getTodayPacific();
    const calendarStartDate = calendarDate;
    const calendarEndDate = calendarDate;

    const scheduledEndDate = useMemo(() => {
        return addDaysToPacificDate(today, 60);
    }, [today]);

    const { data: approvedBookingsData = [], isLoading: approvedLoading } = useApprovedBookings(calendarStartDate, calendarEndDate);
    const { data: scheduledRangeData = [] } = useApprovedBookings(today, scheduledEndDate);
    const { data: availabilityBlocksData = [] } = useAvailabilityBlocks(calendarDate);

    const isLoading = resourcesLoading || baysLoading || requestsLoading || approvedLoading;

    const resources: Resource[] = resourcesData;
    const _bays: Bay[] = baysData;
    const closures: CalendarClosure[] = closuresData.filter((c: CalendarClosure) =>
        c.startDate <= calendarEndDate && c.endDate >= calendarStartDate
    );

    const availabilityBlocks: AvailabilityBlock[] = useMemo(() =>
        (availabilityBlocksData as Array<{ id: number; resource_id?: number; resourceId?: number; block_date?: string; blockDate?: string; start_time?: string; startTime?: string; end_time?: string; endTime?: string; block_type?: string; blockType?: string; notes?: string; closure_title?: string; closureTitle?: string }>).map((b) => ({
            id: b.id,
            resourceId: b.resource_id || b.resourceId,
            blockDate: b.block_date?.includes('T') ? b.block_date.split('T')[0] : (b.blockDate || b.block_date),
            startTime: b.start_time || b.startTime,
            endTime: b.end_time || b.endTime,
            blockType: b.block_type || b.blockType,
            notes: b.notes,
            closureTitle: b.closure_title || b.closureTitle
        } as AvailabilityBlock)),
        [availabilityBlocksData]
    );

    const requests: BookingRequest[] = useMemo(() => {
        const fromRequests = (bookingRequestsData as BookingRequest[]).map((r) => ({ ...r, source: 'booking_request' as const } as BookingRequest));
        const fromPending = pendingBookingsData.map((b) => ({
            id: b.id,
            user_email: b.user_email,
            user_name: b.first_name && b.last_name ? `${b.first_name} ${b.last_name}` : b.user_email,
            resource_id: null,
            bay_name: null,
            resource_preference: b.resource_name || null,
            request_date: b.booking_date,
            start_time: b.start_time,
            end_time: b.end_time,
            duration_minutes: 60,
            notes: b.notes,
            status: b.status,
            staff_notes: null,
            suggested_time: null,
            created_at: b.created_at,
            source: 'booking' as const,
            resource_name: b.resource_name
        }));
        return [...fromRequests, ...fromPending] as BookingRequest[];
    }, [bookingRequestsData, pendingBookingsData]);

    const approvedBookings: BookingRequest[] = approvedBookingsData as BookingRequest[];

    const { memberStatusMap, memberNameMap } = useMemo(() => {
        const statusMap: Record<string, string> = {};
        const nameMap: Record<string, string> = {};
        (memberContactsData as { email?: string; firstName?: string; lastName?: string; status?: string; manuallyLinkedEmails?: string[] }[]).forEach((m) => {
            const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ');
            if (m.email) {
                const emailLower = m.email.toLowerCase();
                statusMap[emailLower] = m.status || 'unknown';
                if (fullName) {
                    nameMap[emailLower] = fullName;
                }
            }
            if (m.manuallyLinkedEmails && fullName) {
                m.manuallyLinkedEmails.forEach((linkedEmail: string) => {
                    if (linkedEmail) {
                        const linkedEmailLower = linkedEmail.toLowerCase();
                        statusMap[linkedEmailLower] = m.status || 'unknown';
                        nameMap[linkedEmailLower] = fullName;
                    }
                });
            }
        });
        return { memberStatusMap: statusMap, memberNameMap: nameMap };
    }, [memberContactsData]);

    return {
        today,
        calendarStartDate,
        calendarEndDate,
        isLoading,
        resources,
        _bays,
        closures,
        availabilityBlocks,
        requests,
        approvedBookings,
        scheduledRangeData,
        memberStatusMap,
        memberNameMap,
    };
}

export function useDerivedBookingData(
    requests: BookingRequest[],
    approvedBookings: BookingRequest[],
    scheduledRangeData: BookingRequest[],
    today: string,
    scheduledFilter: 'all' | 'today' | 'tomorrow' | 'week',
) {
    const pendingRequests = requests.filter(r =>
        r.status === BOOKING_STATUS.PENDING ||
        r.status === BOOKING_STATUS.PENDING_APPROVAL
    );

    const _unmatchedWebhookBookings = approvedBookings.filter(b => {
        const email = (b.user_email || '').toLowerCase();
        const isPlaceholderEmail = !email ||
            email.includes('@trackman.local') ||
            email.includes('@visitors.evenhouse.club') ||
            email.includes('@visitors.everclub.co') ||
            email.startsWith('unmatched-') ||
            email.startsWith('golfnow-') ||
            email.startsWith('classpass-') ||
            email === 'unmatched@trackman.import';

        const isUnmatched = b.is_unmatched === true ||
            isPlaceholderEmail ||
            (b.user_name || '').includes('Unknown (Trackman)');

        const bookingDate = b.request_date || '';
        return isUnmatched && bookingDate >= today;
    });

    const cancellationPendingBookings = approvedBookings.filter(b =>
        b.status === BOOKING_STATUS.CANCELLATION_PENDING
    );

    const queueItems = [
        ...cancellationPendingBookings.map(b => ({ ...b, queueType: 'cancellation' as const })),
        ...pendingRequests.map(r => ({ ...r, queueType: 'pending' as const })),
    ].sort((a, b) => {
        if (a.queueType === 'cancellation' && b.queueType !== 'cancellation') return -1;
        if (a.queueType !== 'cancellation' && b.queueType === 'cancellation') return 1;
        if (a.request_date !== b.request_date) {
            return a.request_date.localeCompare(b.request_date);
        }
        return a.start_time.localeCompare(b.start_time);
    });

    const scheduledBookings = useMemo(() => {
        const today = getTodayPacific();
        const tomorrow = addDaysToPacificDate(today, 1);
        const weekEnd = addDaysToPacificDate(today, 7);

        return scheduledRangeData
            .filter(b => {
                const isScheduledStatus = b.status === BOOKING_STATUS.APPROVED || b.status === BOOKING_STATUS.CONFIRMED;
                const isCheckedInToday = b.status === BOOKING_STATUS.ATTENDED && b.request_date === today;
                if (!(isScheduledStatus || isCheckedInToday) || b.request_date < today) return false;

                if (scheduledFilter === 'today') return b.request_date === today;
                if (scheduledFilter === 'tomorrow') return b.request_date === tomorrow;
                if (scheduledFilter === 'week') return b.request_date >= today && b.request_date <= weekEnd;
                return true;
            })
            .sort((a, b) => {
                if (a.request_date !== b.request_date) {
                    return a.request_date.localeCompare(b.request_date);
                }
                return a.start_time.localeCompare(b.start_time);
            });
    }, [scheduledRangeData, scheduledFilter]);

    return {
        pendingRequests,
        cancellationPendingBookings,
        queueItems,
        scheduledBookings,
    };
}
