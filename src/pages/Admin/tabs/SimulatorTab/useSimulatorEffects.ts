import { useEffect, useLayoutEffect } from 'react';
import { formatTime12Hour } from '../../../../utils/dateUtils';
import { fetchWithCredentials } from '../../../../hooks/queries/useFetch';

import type { BookingRequest } from '../simulator/simulatorTypes';

interface BookingSheetState {
    isOpen: boolean;
    trackmanBookingId: string | null;
    bayName?: string;
    bookingDate?: string;
    timeSlot?: string;
    matchedBookingId?: number;
    currentMemberName?: string;
    currentMemberEmail?: string;
    isRelink?: boolean;
    importedName?: string;
    notes?: string;
    bookingId?: number | null;
    mode?: 'assign' | 'manage';
    ownerName?: string;
    ownerEmail?: string;
    declaredPlayerCount?: number;
    bookingStatus?: string;
    bookingContext?: { requestDate?: string; startTime?: string; endTime?: string; resourceId?: number; resourceName?: string; durationMinutes?: number; notes?: string };
    ownerMembershipStatus?: string | null;
}

interface UseSimulatorEffectsParams {
    isLoading: boolean;
    calendarDate: string;
    calendarColRef: React.RefObject<HTMLDivElement | null>;
    setQueueMaxHeight: (h: number | null) => void;
    setPageReady: (ready: boolean) => void;
    setBookingSheet: (sheet: BookingSheetState) => void;
    actionModal: 'approve' | 'decline' | null;
    showTrackmanConfirm: boolean;
    selectedBayId: number | null;
    selectedRequest: BookingRequest | null;
    setAvailabilityStatus: (s: 'checking' | 'available' | 'conflict' | null) => void;
    setConflictDetails: (d: string | null) => void;
    setSuggestedTime: (t: string) => void;
    setDeclineAvailableSlots: (slots: string[]) => void;
    setDeclineSlotsLoading: (loading: boolean) => void;
    setDeclineSlotsError: (error: string | null) => void;
    handleRefresh: () => void;
}

export function useSimulatorEffects({
    isLoading,
    calendarDate,
    calendarColRef,
    setQueueMaxHeight,
    setPageReady,
    setBookingSheet,
    actionModal,
    showTrackmanConfirm,
    selectedBayId,
    selectedRequest,
    setAvailabilityStatus,
    setConflictDetails,
    setSuggestedTime,
    setDeclineAvailableSlots,
    setDeclineSlotsLoading,
    setDeclineSlotsError,
    handleRefresh,
}: UseSimulatorEffectsParams) {
    useLayoutEffect(() => {
        const syncHeights = () => {
            if (calendarColRef.current) {
                const calendarHeight = calendarColRef.current.offsetHeight;
                if (calendarHeight > 0) {
                    setQueueMaxHeight(calendarHeight);
                }
            }
        };

        const timer = setTimeout(syncHeights, 100);

        window.addEventListener('resize', syncHeights);

        const observer = new ResizeObserver(syncHeights);
        if (calendarColRef.current) {
            observer.observe(calendarColRef.current);
        }

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', syncHeights);
            observer.disconnect();
        };
    }, [isLoading, calendarDate]);

    useEffect(() => {
        if (!isLoading) {
            setPageReady(true);
        }
    }, [isLoading, setPageReady]);

    useEffect(() => {
        let cancelled = false;

        const openBookingById = async (bookingId: number | string) => {
            try {
                const data = await fetchWithCredentials<Array<{
                    id: number; user_email?: string; user_name?: string; trackman_booking_id?: string | null;
                    is_unmatched?: boolean; bay_name?: string; resource_name?: string; request_date?: string;
                    start_time?: string; end_time?: string; resource_id?: number; duration_minutes?: number;
                    status?: string; declared_player_count?: number; player_count?: number; notes?: string; note?: string;
                    userName?: string;
                }>>(`/api/booking-requests?id=${bookingId}`);
                if (cancelled) return;
                if (data && data.length > 0) {
                        const booking = data[0];
                        const email = (booking.user_email || '').toLowerCase();
                        const isPlaceholderEmail = !email ||
                            email.includes('@trackman.local') ||
                            email.includes('@visitors.evenhouse.club') ||
                            email.includes('@visitors.everclub.co') ||
                            email.startsWith('unmatched-') ||
                            email.startsWith('golfnow-') ||
                            email.startsWith('classpass-') ||
                            email === 'unmatched@trackman.import';
                        const isUnmatched = booking.is_unmatched === true ||
                            isPlaceholderEmail ||
                            booking.user_name === 'Unknown (Trackman)';
                        setBookingSheet({
                            isOpen: true,
                            trackmanBookingId: booking.trackman_booking_id || null,
                            bookingId: booking.id,
                            mode: isUnmatched ? 'assign' as const : 'manage' as const,
                            bayName: booking.bay_name || booking.resource_name,
                            bookingDate: booking.request_date,
                            timeSlot: `${formatTime12Hour(booking.start_time || '')} - ${formatTime12Hour(booking.end_time || '')}`,
                            matchedBookingId: Number(booking.id),
                            currentMemberName: isUnmatched ? undefined : (booking.user_name || undefined),
                            currentMemberEmail: isUnmatched ? undefined : (booking.user_email || undefined),
                            ownerName: booking.user_name || undefined,
                            ownerEmail: booking.user_email || undefined,
                            declaredPlayerCount: booking.declared_player_count || booking.player_count || 1,
                            isRelink: !isUnmatched,
                            importedName: booking.user_name || booking.userName,
                            notes: booking.notes || booking.note,
                            bookingStatus: booking.status,
                            bookingContext: { requestDate: booking.request_date, startTime: booking.start_time, endTime: booking.end_time, resourceId: booking.resource_id, resourceName: booking.bay_name || booking.resource_name, durationMinutes: booking.duration_minutes },
                        });
                    }
            } catch (err: unknown) {
                console.error('Failed to open booking details:', err);
            }
        };

        const handleOpenBookingDetails = async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.bookingId) {
                await openBookingById(detail.bookingId);
            }
        };
        window.addEventListener('open-booking-details', handleOpenBookingDetails);

        const pendingBookingId = sessionStorage.getItem('pendingRosterBookingId');
        if (pendingBookingId) {
            sessionStorage.removeItem('pendingRosterBookingId');
            openBookingById(pendingBookingId);
        }

        return () => {
            cancelled = true;
            window.removeEventListener('open-booking-details', handleOpenBookingDetails);
        };
    }, []);

    useEffect(() => {
        if (actionModal || showTrackmanConfirm) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [actionModal, showTrackmanConfirm]);

    useEffect(() => {
        const handleBookingUpdate = () => {
            handleRefresh();
        };
        window.addEventListener('booking-update', handleBookingUpdate);
        return () => window.removeEventListener('booking-update', handleBookingUpdate);
    }, [handleRefresh]);

    useEffect(() => {
        const checkAvailability = async () => {
            if (!selectedBayId || !selectedRequest || actionModal !== 'approve') {
                setAvailabilityStatus(null);
                setConflictDetails(null);
                return;
            }

            setAvailabilityStatus('checking');
            setConflictDetails(null);

            try {
                const [bookings, allClosures] = await Promise.all([
                    fetchWithCredentials<Array<{ resource_id?: number; request_date?: string; start_time: string; end_time: string }>>(`/api/approved-bookings?start_date=${selectedRequest.request_date}&end_date=${selectedRequest.request_date}`),
                    fetchWithCredentials<Array<{ startDate: string; endDate: string; affectedAreas: string | null; startTime?: string; endTime?: string; title: string }>>('/api/closures')
                ]);

                let hasConflict = false;
                let details = '';

                const reqStart = selectedRequest.start_time;
                const reqEnd = selectedRequest.end_time;

                const conflict = bookings.find((b) =>
                    b.resource_id === selectedBayId &&
                    b.request_date === selectedRequest.request_date &&
                    b.start_time < reqEnd && b.end_time > reqStart
                );

                if (conflict) {
                    hasConflict = true;
                    details = `Conflicts with existing booking: ${formatTime12Hour(conflict.start_time)} - ${formatTime12Hour(conflict.end_time)}`;
                }

                if (!hasConflict) {
                    const reqDate = selectedRequest.request_date;
                    const reqStartMins = parseInt(selectedRequest.start_time.split(':')[0], 10) * 60 + parseInt(selectedRequest.start_time.split(':')[1], 10);
                    const reqEndMins = parseInt(selectedRequest.end_time.split(':')[0], 10) * 60 + parseInt(selectedRequest.end_time.split(':')[1], 10);

                    const closure = allClosures.find((c: { startDate: string; endDate: string; affectedAreas: string | null; startTime?: string; endTime?: string; title: string }) => {
                        if (c.startDate > reqDate || c.endDate < reqDate) return false;

                        const areas = c.affectedAreas || '';
                        const affectsResource = areas === 'entire_facility' ||
                            areas === 'all_bays' ||
                            areas.includes(String(selectedBayId));

                        if (!affectsResource) return false;

                        if (c.startTime && c.endTime) {
                            const closureStartMins = parseInt(c.startTime.split(':')[0], 10) * 60 + parseInt(c.startTime.split(':')[1], 10);
                            const closureEndMins = parseInt(c.endTime.split(':')[0], 10) * 60 + parseInt(c.endTime.split(':')[1], 10);
                            return reqStartMins < closureEndMins && reqEndMins > closureStartMins;
                        }
                        return true;
                    });

                    if (closure) {
                        hasConflict = true;
                        details = `Conflicts with notice: ${closure.title}`;
                    }
                }

                setAvailabilityStatus(hasConflict ? 'conflict' : 'available');
                setConflictDetails(hasConflict ? details : null);
            } catch (_err: unknown) {
                setAvailabilityStatus(null);
            }
        };

        checkAvailability();
    }, [selectedBayId, selectedRequest, actionModal]);


    useEffect(() => {
        let cancelled = false;

        const fetchDeclineSlots = async (bookingDate: string, resourceId: number) => {
            setDeclineSlotsLoading(true);
            setDeclineSlotsError(null);
            try {
                const response = await fetchWithCredentials<{
                    bookings: Array<{ start_time: string; end_time: string }>;
                    blocks: Array<{ start_time: string; end_time: string; block_type?: string }>;
                }>(`/api/bays/${resourceId}/availability?date=${bookingDate}`);
                if (cancelled) return;

                const busySlots = [
                    ...(response.bookings || []),
                    ...(response.blocks || []),
                ];

                const parseTime = (t: string): number => {
                    const [h, m] = t.split(':').map(Number);
                    return h * 60 + m;
                };

                const openMin = 8 * 60 + 30;
                const closeMin = 22 * 60;
                const available: string[] = [];
                for (let t = openMin; t + 30 <= closeMin; t += 30) {
                    const slotEnd = t + 30;
                    const conflicts = busySlots.some((b) => {
                        const bStart = parseTime(b.start_time);
                        const bEnd = parseTime(b.end_time);
                        return t < bEnd && slotEnd > bStart;
                    });
                    if (!conflicts) {
                        const hh = String(Math.floor(t / 60)).padStart(2, '0');
                        const mm = String(t % 60).padStart(2, '0');
                        available.push(`${hh}:${mm}`);
                    }
                }
                setDeclineAvailableSlots(available);
            } catch (err: unknown) {
                console.error('Failed to fetch available slots:', err);
                if (!cancelled) {
                    setDeclineAvailableSlots([]);
                    setDeclineSlotsError('Could not load available time slots. You can still decline without suggesting an alternative.');
                }
            } finally {
                if (!cancelled) setDeclineSlotsLoading(false);
            }
        };

        if (actionModal === 'decline' && selectedRequest) {
            setSuggestedTime('');
            setDeclineAvailableSlots([]);
            setDeclineSlotsError(null);
            if (selectedRequest.resource_id) {
                fetchDeclineSlots(selectedRequest.request_date, selectedRequest.resource_id);
            }
        }

        return () => {
            cancelled = true;
        };
    }, [actionModal, selectedRequest]);
}
