import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthData, useMemberData } from '../../../../contexts/DataContext';
import { usePageReady } from '../../../../stores/pageReadyStore';
import { getTodayPacific } from '../../../../utils/dateUtils';
import { usePricing } from '../../../../hooks/usePricing';
import { useToast } from '../../../../hooks/useToast';
import { useTheme } from '../../../../contexts/ThemeContext';
import { TabType, tabToPath } from '../../layout/types';
import QrScannerModal from '../../../../components/staff-command-center/modals/QrScannerModal';
import { AnimatedPage } from '../../../../components/motion';
import { SimulatorTabSkeleton } from '../../../../components/skeletons';
import FloatingActionButton from '../../../../components/FloatingActionButton';
import { useFeeEstimate } from '../../../../hooks/queries/useBookingsQueries';
import { simulatorKeys } from '../../../../hooks/queries/adminKeys';

import type { BookingRequest } from '../simulator/simulatorTypes';
import CalendarGrid from '../simulator/CalendarGrid';
import BookingRequestsPanel from '../simulator/BookingRequestsPanel';
import GuideBookings from '../../../../components/guides/GuideBookings';
import { TrackmanIcon } from '../../../../components/icons/TrackmanIcon';
import SimulatorModals from './SimulatorModals';
import SimulatorBottomModals from './SimulatorBottomModals';
import { useSimulatorHandlers } from './useSimulatorHandlers';
import { useSimulatorQueries, useDerivedBookingData } from './useSimulatorQueries';
import { useSimulatorEffects } from './useSimulatorEffects';
import { useSimulatorState } from './useSimulatorState';

const SimulatorTab: React.FC = () => {
    const navigate = useNavigate();
    const { setPageReady } = usePageReady();
    const { user, actualUser } = useAuthData();
  const { members } = useMemberData();
    const queryClient = useQueryClient();
    const { guestFeeDollars, overageRatePerBlockDollars, tierMinutes } = usePricing();
    
    const navigateToTab = useCallback((tab: TabType) => {
        if (tabToPath[tab]) {
            navigate(tabToPath[tab]);
        }
    }, [navigate]);
    
    const _activeMemberEmails = new Set(members.map(m => m.email.toLowerCase()));
    
    const { showToast } = useToast();
    const { effectiveTheme } = useTheme();
    const isDark = effectiveTheme === 'dark';
    const [activeView, setActiveView] = useState<'requests' | 'calendar'>('requests');
    const [calendarDate, setCalendarDate] = useState(() => getTodayPacific());

    const {
        today,
        calendarStartDate,
        calendarEndDate,
        isLoading,
        resources,
        closures,
        availabilityBlocks,
        requests,
        approvedBookings,
        scheduledRangeData,
        memberStatusMap,
        memberNameMap,
    } = useSimulatorQueries(calendarDate);
    
    const {
        selectedRequest, setSelectedRequest,
        actionModal, setActionModal,
        selectedBayId, setSelectedBayId,
        staffNotes, setStaffNotes,
        suggestedTime, setSuggestedTime,
        declineAvailableSlots, setDeclineAvailableSlots,
        declineSlotsLoading, setDeclineSlotsLoading,
        declineSlotsError, setDeclineSlotsError,
        isProcessing, setIsProcessing,
        error, setError,
        availabilityStatus, setAvailabilityStatus,
        conflictDetails, setConflictDetails,
        showTrackmanConfirm, setShowTrackmanConfirm,
        showManualBooking, setShowManualBooking,
        prefillResourceId, setPrefillResourceId,
        prefillDate, setPrefillDate,
        prefillStartTime, setPrefillStartTime,
        scheduledFilter, setScheduledFilter,
        showDatePicker, setShowDatePicker,
        isSyncing, setIsSyncing,
        lastRefresh, setLastRefresh,
        trackmanModal, setTrackmanModal,
        confirm, ConfirmDialogComponent,
        bookingSheet, setBookingSheet,
        cancelConfirmModal, setCancelConfirmModal,
        staffManualBookingModalOpen, setStaffManualBookingModalOpen,
        staffManualBookingDefaults, setStaffManualBookingDefaults,
        actionInProgress, setActionInProgress,
        qrScannerOpen, setQrScannerOpen,
        calendarColRef,
        queueMaxHeight, setQueueMaxHeight,
    } = useSimulatorState();

    const feeEstimateBookingId = actionModal === 'approve' && selectedRequest?.id ? selectedRequest.id : null;
    const { data: feeEstimate, isLoading: isFetchingFeeEstimate } = useFeeEstimate(feeEstimateBookingId);

    const {
        handleRefresh,
        prefetchDate,
        handleTrackmanConfirm,
        handleDevConfirm,
        updateBookingStatusOptimistic,
        handleQrScanSuccess,
        showCancelConfirmation,
        performCancellation,
        cancelBookingOptimistic,
        isBookingUnmatched,
        initiateApproval,
        handleApprove,
        handleDecline,
    } = useSimulatorHandlers({
        requests,
        approvedBookings,
        calendarStartDate,
        calendarEndDate,
        selectedRequest,
        setSelectedRequest,
        actionModal,
        setActionModal,
        selectedBayId,
        setSelectedBayId,
        staffNotes,
        setStaffNotes,
        suggestedTime,
        setSuggestedTime,
        isProcessing,
        setIsProcessing,
        setError,
        showTrackmanConfirm,
        setShowTrackmanConfirm,
        cancelConfirmModal,
        setCancelConfirmModal,
        setActionInProgress,
        setBookingSheet: setBookingSheet as (sheet: Record<string, unknown>) => void,
        setLastRefresh: (d: Date) => setLastRefresh(d),
        setQrScannerOpen,
    });

    useSimulatorEffects({
        isLoading,
        calendarDate,
        calendarColRef: calendarColRef as React.RefObject<HTMLDivElement | null>,
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
    });

    const {
        pendingRequests,
        cancellationPendingBookings,
        queueItems,
        scheduledBookings,
    } = useDerivedBookingData(requests, approvedBookings, scheduledRangeData as BookingRequest[], today, scheduledFilter);

    return (
            <AnimatedPage className="flex flex-col">
                <div className="w-full bg-white dark:bg-surface-dark rounded-xl shadow-lg border border-gray-200 dark:border-white/25 flex flex-col">
                <div className="lg:hidden flex items-center justify-between border-b border-gray-200 dark:border-white/25 mb-0 px-4 py-3">
                    <div className="flex">
                        <button
                            onClick={() => setActiveView('requests')}
                            className={`tactile-btn py-3 px-6 font-medium text-sm transition-colors duration-fast relative ${
                                activeView === 'requests'
                                    ? 'text-primary dark:text-white'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                            Queue {queueItems.length > 0 && `(${queueItems.length})`}
                            {activeView === 'requests' && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-white" />
                            )}
                        </button>
                        <button
                            onClick={() => setActiveView('calendar')}
                            className={`tactile-btn py-3 px-6 font-medium text-sm transition-colors duration-fast relative ${
                                activeView === 'calendar'
                                    ? 'text-primary dark:text-white'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                            Calendar
                            {activeView === 'calendar' && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary dark:bg-white" />
                            )}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <GuideBookings />
                        <button
                            onClick={() => navigateToTab('trackman')}
                            className="p-2 rounded-xl bg-white/60 dark:bg-white/10 backdrop-blur-sm border border-primary/10 dark:border-white/20 hover:bg-white/80 dark:hover:bg-white/15 transition-colors tactile-btn"
                            title="Import bookings from Trackman CSV"
                        >
                            <TrackmanIcon size={24} />
                        </button>
                    </div>
                </div>

            {isLoading ? (
                <SimulatorTabSkeleton />
            ) : (
                <div className="flex flex-col lg:grid lg:grid-cols-[400px_1fr] xl:grid-cols-[450px_1fr] lg:items-start flex-1">
                    <BookingRequestsPanel
                        queueItems={queueItems}
                        pendingRequests={pendingRequests}
                        cancellationPendingBookings={cancellationPendingBookings}
                        scheduledBookings={scheduledBookings as BookingRequest[]}
                        scheduledFilter={scheduledFilter}
                        setScheduledFilter={setScheduledFilter}
                        resources={resources}
                        memberNameMap={memberNameMap}
                        actionInProgress={actionInProgress}
                        navigateToTab={navigateToTab as (tab: string) => void}
                        setBookingSheet={setBookingSheet as (sheet: Record<string, unknown> | null) => void}
                        setTrackmanModal={setTrackmanModal}
                        setSelectedRequest={setSelectedRequest}
                        setActionModal={setActionModal}
                        cancelBookingOptimistic={cancelBookingOptimistic}
                        updateBookingStatusOptimistic={updateBookingStatusOptimistic}
                        isBookingUnmatched={isBookingUnmatched}
                        handleRefresh={handleRefresh}
                        showToast={showToast}
                        confirm={confirm as (opts: { title: string; message: string; confirmText: string; variant: string }) => Promise<boolean>}
                        guestFeeDollars={guestFeeDollars}
                        overageRatePerBlockDollars={overageRatePerBlockDollars}
                        tierMinutes={tierMinutes}
                        startDate={calendarStartDate}
                        endDate={calendarEndDate}
                        queryClient={queryClient}
                        simulatorKeys={simulatorKeys}
                        activeView={activeView}
                        queueMaxHeight={queueMaxHeight}
                        setActionInProgress={setActionInProgress}
                    />
                    
                    <CalendarGrid
                        resources={resources}
                        calendarDate={calendarDate}
                        setCalendarDate={setCalendarDate}
                        showDatePicker={showDatePicker}
                        setShowDatePicker={setShowDatePicker}
                        approvedBookings={approvedBookings}
                        pendingRequests={pendingRequests}
                        closures={closures}
                        availabilityBlocks={availabilityBlocks}
                        memberStatusMap={memberStatusMap}
                        memberNameMap={memberNameMap}
                        setBookingSheet={setBookingSheet as (sheet: Record<string, unknown> | null) => void}
                        setStaffManualBookingDefaults={setStaffManualBookingDefaults}
                        setStaffManualBookingModalOpen={setStaffManualBookingModalOpen}
                        setTrackmanModal={setTrackmanModal}
                        handleRefresh={handleRefresh}
                        isSyncing={isSyncing}
                        setIsSyncing={setIsSyncing}
                        lastRefresh={lastRefresh}
                        setLastRefresh={setLastRefresh}
                        isDark={isDark}
                        showToast={showToast}
                        calendarColRef={calendarColRef as React.RefObject<HTMLDivElement>}
                        activeView={activeView}
                        guestFeeDollars={guestFeeDollars}
                        overageRatePerBlockDollars={overageRatePerBlockDollars}
                        tierMinutes={tierMinutes}
                        prefetchDate={prefetchDate}
                    />
                </div>
            )}
            
            <SimulatorModals
                selectedRequest={selectedRequest}
                actionModal={actionModal}
                setActionModal={setActionModal}
                setSelectedRequest={setSelectedRequest}
                error={error}
                setError={setError}
                showTrackmanConfirm={showTrackmanConfirm}
                setShowTrackmanConfirm={setShowTrackmanConfirm}
                cancelConfirmModal={cancelConfirmModal}
                setCancelConfirmModal={setCancelConfirmModal}
                feeEstimate={feeEstimate}
                isFetchingFeeEstimate={isFetchingFeeEstimate}
                resources={resources}
                selectedBayId={selectedBayId}
                setSelectedBayId={setSelectedBayId}
                availabilityStatus={availabilityStatus}
                conflictDetails={conflictDetails}
                staffNotes={staffNotes}
                setStaffNotes={setStaffNotes}
                suggestedTime={suggestedTime}
                setSuggestedTime={setSuggestedTime}
                declineAvailableSlots={declineAvailableSlots}
                declineSlotsLoading={declineSlotsLoading}
                declineSlotsError={declineSlotsError}
                isProcessing={isProcessing}
                guestFeeDollars={guestFeeDollars}
                initiateApproval={initiateApproval}
                handleApprove={handleApprove}
                handleDecline={handleDecline}
                performCancellation={performCancellation}
            />
            <SimulatorBottomModals
              trackmanModal={trackmanModal}
              setTrackmanModal={setTrackmanModal}
              handleTrackmanConfirm={handleTrackmanConfirm}
              handleDevConfirm={handleDevConfirm}
              staffManualBookingModalOpen={staffManualBookingModalOpen}
              setStaffManualBookingModalOpen={setStaffManualBookingModalOpen}
              staffManualBookingDefaults={staffManualBookingDefaults}
              setStaffManualBookingDefaults={setStaffManualBookingDefaults}
              bookingSheet={bookingSheet}
              setBookingSheet={setBookingSheet}
              showManualBooking={showManualBooking}
              setShowManualBooking={setShowManualBooking}
              prefillResourceId={prefillResourceId}
              setPrefillResourceId={setPrefillResourceId}
              prefillDate={prefillDate}
              setPrefillDate={setPrefillDate}
              prefillStartTime={prefillStartTime}
              setPrefillStartTime={setPrefillStartTime}
              resources={resources}
              handleRefresh={handleRefresh}
              showToast={showToast}
              confirm={confirm as (opts: { title: string; message: string; confirmText: string; variant: string }) => Promise<boolean>}
              actualUserEmail={actualUser?.email}
              userEmail={user?.email}
              queryClient={queryClient}
              calendarStartDate={calendarStartDate}
              calendarEndDate={calendarEndDate}
            />
                </div>

                <ConfirmDialogComponent />

                <FloatingActionButton
                    onClick={() => setQrScannerOpen(true)}
                    icon="qr_code_scanner"
                    label="Scan Check-in"
                    text="Scan Check-in"
                    extended
                    color="brand"
                />

                <QrScannerModal
                    isOpen={qrScannerOpen}
                    onClose={() => setQrScannerOpen(false)}
                    onScanSuccess={handleQrScanSuccess}
                />
            </AnimatedPage>
    );
};

export default SimulatorTab;
