import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePageReady } from '../../../stores/pageReadyStore';
import EmptyState from '../../../components/EmptyState';
import { formatDateDisplayWithDay, formatTime12Hour } from '../../../utils/dateUtils';
import { formatPhoneNumber } from '../../../utils/formatting';
import { AnimatedPage } from '../../../components/motion';
import { useTourData, useSyncTours, useCheckInTour, useUpdateTourStatus } from '../../../hooks/queries';
import { ToursTabSkeleton } from '../../../components/skeletons';
import { fetchWithCredentials, postWithCredentials } from '../../../hooks/queries/useFetch';
import Icon from '../../../components/icons/Icon';

interface Tour {
  id: number;
  googleCalendarId: string | null;
  hubspotMeetingId: string | null;
  title: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  tourDate: string;
  startTime: string;
  endTime: string | null;
  notes: string | null;
  status: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
}

interface HubSpotMeetingPotentialMatch {
  id: number;
  guestName: string | null;
  guestEmail: string | null;
  tourDate: string;
  startTime: string;
  status: string | null;
}

interface HubSpotUnmatchedMeeting {
  hubspotMeetingId: string;
  title: string;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  tourDate: string;
  startTime: string;
  endTime: string | null;
  notes: string | null;
  isCancelled: boolean;
  potentialMatches: HubSpotMeetingPotentialMatch[];
  wouldBackfill: boolean;
}

interface NeedsReviewResponse {
  unmatchedMeetings: HubSpotUnmatchedMeeting[];
}

const statusConfig: Record<string, { label: string; icon: string; colors: string }> = {
  scheduled: { label: 'Scheduled', icon: 'schedule', colors: 'bg-primary/10 dark:bg-white/10 text-primary/70 dark:text-white/70' },
  checked_in: { label: 'Checked In', icon: 'check_circle', colors: 'bg-green-500/20 text-green-700 dark:text-green-400' },
  completed: { label: 'Completed', icon: 'task_alt', colors: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' },
  'no-show': { label: 'No Show', icon: 'person_off', colors: 'bg-red-500/20 text-red-700 dark:text-red-400' },
  cancelled: { label: 'Cancelled', icon: 'cancel', colors: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' },
  pending: { label: 'Pending', icon: 'hourglass_empty', colors: 'bg-amber-500/20 text-amber-700 dark:text-amber-400' },
};

interface TourCardProps {
  tour: Tour;
  isToday?: boolean;
  isPast?: boolean;
  statusMenuTourId: number | null;
  onStatusMenuToggle: (tourId: number | null) => void;
  isUpdating: boolean;
  isCheckingIn: boolean;
  onCheckIn: (tour: Tour) => void;
  onStatusUpdate: (tourId: number, newStatus: string) => void;
  formatDate: (dateStr: string) => string;
}

const TourCard: React.FC<TourCardProps> = ({ tour, isToday = false, isPast = false, statusMenuTourId, onStatusMenuToggle, isUpdating, isCheckingIn, onCheckIn, onStatusUpdate, formatDate }) => {
  const config = statusConfig[tour.status] || statusConfig.scheduled;
  const isMenuOpen = statusMenuTourId === tour.id;
  
  return (
    <div className={`p-4 rounded-xl border tactile-card ${isMenuOpen ? 'relative z-30' : ''} ${tour.status === 'checked_in' 
      ? 'bg-green-500/10 border-green-500/30' 
      : tour.status === 'no-show'
        ? 'bg-red-500/5 border-red-500/20'
        : tour.status === 'cancelled'
          ? 'bg-gray-500/5 border-gray-500/20'
          : isPast
            ? 'bg-primary/5 dark:bg-white/3 border-primary/5 dark:border-white/20'
            : 'bg-white/60 dark:bg-white/5 border-primary/10 dark:border-white/25'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-bold ${isPast ? 'text-primary/70 dark:text-white/70' : 'text-primary dark:text-white'}`}>
              {formatTime12Hour(tour.startTime)}
            </span>
            {tour.endTime && (
              <span className="text-xs text-primary/70 dark:text-white/70">
                - {formatTime12Hour(tour.endTime)}
              </span>
            )}
          </div>
          <h4 className={`font-semibold truncate ${isPast ? 'text-primary/80 dark:text-white/80' : 'text-primary dark:text-white'}`}>
            {tour.guestName || tour.title}
          </h4>
          {tour.guestEmail && (
            <p className="text-xs text-primary/80 dark:text-white/80 truncate">{tour.guestEmail}</p>
          )}
          {tour.guestPhone && (
            <p className="text-xs text-primary/80 dark:text-white/80">{formatPhoneNumber(tour.guestPhone)}</p>
          )}
          {!isToday && (
            <p className="text-xs text-primary/70 dark:text-white/70 mt-1">{formatDate(tour.tourDate)}</p>
          )}
        </div>
        <div className="flex-shrink-0 relative">
          {isToday && tour.status === 'scheduled' ? (
            <button
              onClick={() => onCheckIn(tour)}
              disabled={isCheckingIn}
              className="px-4 py-2 rounded-[4px] bg-accent text-primary text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1 disabled:opacity-50"
            >
              {isCheckingIn ? (
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
              ) : (
                <Icon name="how_to_reg" className="text-sm" />
              )}
              Check In
            </button>
          ) : (
            <button
              onClick={() => onStatusMenuToggle(isMenuOpen ? null : tour.id)}
              disabled={isUpdating}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[4px] text-xs font-medium transition-opacity duration-fast ${config.colors} ${isUpdating ? 'opacity-50' : 'hover:ring-2 hover:ring-primary/20 dark:hover:ring-white/20 cursor-pointer'}`}
            >
              {isUpdating ? (
                <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
              ) : (
                <Icon name={config.icon} className="text-sm" />
              )}
              {config.label}
              <Icon name="expand_more" className="text-sm ml-0.5" />
            </button>
          )}
          
          {isMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => onStatusMenuToggle(null)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-primary/10 dark:border-white/20 py-1 min-w-[140px] animate-pop-in">
                {Object.entries(statusConfig).filter(([key]) => key !== 'pending').map(([key, { label, icon, colors }]) => (
                  <button
                    key={key}
                    onClick={() => onStatusUpdate(tour.id, key)}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-primary/5 dark:hover:bg-white/5 transition-colors ${tour.status === key ? 'font-bold' : ''}`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${colors}`}>
                      <Icon name={icon} className="text-xs" />
                    </span>
                    {label}
                    {tour.status === key && (
                      <Icon name="check" className="text-sm ml-auto text-green-600" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ToursTab: React.FC = () => {
  const { setPageReady } = usePageReady();
  const { data: toursData, isLoading } = useTourData();
  const _syncMutation = useSyncTours();
  const checkInMutation = useCheckInTour();
  const updateStatusMutation = useUpdateTourStatus();
  const [syncMessage, _setSyncMessage] = useState<string | null>(null);
  const [statusMenuTourId, setStatusMenuTourId] = useState<number | null>(null);
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: needsReviewData, isLoading: needsReviewLoading, refetch: refetchNeedsReview } = useQuery({
    queryKey: ['tours-needs-review'],
    queryFn: () => fetchWithCredentials<NeedsReviewResponse>('/api/tours/needs-review'),
    enabled: showNeedsReview,
    staleTime: 2 * 60 * 1000,
  });

  const unmatchedMeetings = needsReviewData?.unmatchedMeetings ?? [];

  const linkMutation = useMutation({
    mutationFn: ({ hubspotMeetingId, tourId }: { hubspotMeetingId: string; tourId: number }) =>
      postWithCredentials('/api/tours/link-hubspot', { hubspotMeetingId, tourId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours-needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['tours'] });
      setLinkingId(null);
    },
    onError: () => { setLinkingId(null); },
  });

  const dismissMutation = useMutation({
    mutationFn: (hubspotMeetingId: string) =>
      postWithCredentials('/api/tours/dismiss-hubspot', { hubspotMeetingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours-needs-review'] });
      setDismissingId(null);
    },
    onError: () => { setDismissingId(null); },
  });

  const createMutation = useMutation({
    mutationFn: (hubspotMeetingId: string) =>
      postWithCredentials('/api/tours/create-from-hubspot', { hubspotMeetingId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours-needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['tours'] });
      setCreatingId(null);
    },
    onError: () => { setCreatingId(null); },
  });

  React.useEffect(() => {
    setPageReady(true);
  }, [setPageReady]);

  const handleCheckIn = async (tour: Tour) => {
    try {
      await checkInMutation.mutateAsync({ tourId: tour.id });
    } catch (err: unknown) {
      console.error('Check-in failed:', err);
    }
  };

  const handleStatusUpdate = async (tourId: number, newStatus: string) => {
    setStatusMenuTourId(null);
    try {
      await updateStatusMutation.mutateAsync({ tourId, status: newStatus });
    } catch (err: unknown) {
      console.error('Status update failed:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    return formatDateDisplayWithDay(datePart);
  };

  if (isLoading) {
    return <ToursTabSkeleton />;
  }

  const renderNeedsReviewSection = () => (
    <div className="mb-2">
      <button
        onClick={() => setShowNeedsReview(prev => !prev)}
        className="tactile-btn flex items-center justify-between w-full p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon name="warning" className="text-amber-600 dark:text-amber-400 text-lg" />
          <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">HubSpot Meetings Needing Review</span>
          {!needsReviewLoading && unmatchedMeetings.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {unmatchedMeetings.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showNeedsReview && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); refetchNeedsReview(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); refetchNeedsReview(); } }}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors cursor-pointer"
              aria-label="Refresh"
            >
              <Icon name="refresh" className="text-base" />
            </span>
          )}
          <Icon name="expand_more" className={`text-amber-600 dark:text-amber-400 transition-transform ${showNeedsReview ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {showNeedsReview && (
        <div className="mt-2 space-y-3">
          {needsReviewLoading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-amber-700 dark:text-amber-400">
              <Icon name="progress_activity" className="animate-spin text-base" />
              Loading HubSpot meetings...
            </div>
          ) : unmatchedMeetings.length === 0 ? (
            <div className="p-4 flex flex-col items-center text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-700/30">
              <Icon name="check_circle" className="text-2xl mb-1" />
              All HubSpot meetings are linked
            </div>
          ) : (
            unmatchedMeetings.map((meeting) => {
              const isLinking = linkingId === meeting.hubspotMeetingId;
              const isDismissing = dismissingId === meeting.hubspotMeetingId;
              const isCreating = creatingId === meeting.hubspotMeetingId;
              const busy = isLinking || isDismissing || isCreating;
              return (
                <div
                  key={meeting.hubspotMeetingId}
                  className="p-3 rounded-xl bg-white dark:bg-white/5 border border-amber-200 dark:border-amber-700/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-primary dark:text-white truncate">
                        {meeting.guestName || meeting.title}
                      </p>
                      {meeting.guestEmail && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{meeting.guestEmail}</p>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatDateDisplayWithDay(meeting.tourDate)} · {formatTime12Hour(meeting.startTime)}
                        {meeting.isCancelled && (
                          <span className="ml-1 text-red-500 font-medium">(Cancelled in HubSpot)</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {meeting.potentialMatches.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                        Potential matches ({meeting.potentialMatches.length})
                      </p>
                      <div className="space-y-1">
                        {meeting.potentialMatches.map((match) => (
                          <div key={match.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 dark:bg-white/5">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-primary dark:text-white truncate">
                                {match.guestName || match.guestEmail || `Tour #${match.id}`}
                              </p>
                              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                {formatTime12Hour(match.startTime)} · {match.status}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setLinkingId(meeting.hubspotMeetingId);
                                linkMutation.mutate({ hubspotMeetingId: meeting.hubspotMeetingId, tourId: match.id });
                              }}
                              disabled={busy}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-primary/10 dark:bg-white/10 text-primary dark:text-white hover:bg-primary/20 dark:hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              {isLinking ? (
                                <Icon name="progress_activity" className="animate-spin text-xs" />
                              ) : (
                                <Icon name="link" className="text-xs" />
                              )}
                              Link
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        setCreatingId(meeting.hubspotMeetingId);
                        createMutation.mutate(meeting.hubspotMeetingId);
                      }}
                      disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 dark:bg-white/10 text-primary dark:text-white hover:bg-primary/20 dark:hover:bg-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCreating ? (
                        <Icon name="progress_activity" className="animate-spin text-xs" />
                      ) : (
                        <Icon name="add" className="text-xs" />
                      )}
                      Create Tour
                    </button>
                    <button
                      onClick={() => {
                        setDismissingId(meeting.hubspotMeetingId);
                        dismissMutation.mutate(meeting.hubspotMeetingId);
                      }}
                      disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDismissing ? (
                        <Icon name="progress_activity" className="animate-spin text-xs" />
                      ) : (
                        <Icon name="do_not_disturb" className="text-xs" />
                      )}
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );

  return (
      <AnimatedPage className="space-y-6 pb-32 backdrop-blur-sm">
        <p className="text-sm text-primary/80 dark:text-white/80 animate-content-enter-delay-1">
          Synced from HubSpot Meetings
        </p>

      {syncMessage && (
        <div className="p-3 rounded-xl bg-accent/20 text-primary dark:text-accent text-sm text-center">
          {syncMessage}
        </div>
      )}

      {renderNeedsReviewSection()}

      {toursData.todayTours.length > 0 && (
        <div className="animate-content-enter-delay-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70 dark:text-white/70 mb-3 flex items-center gap-2" style={{ fontFamily: 'var(--font-label)' }}>
            <Icon name="today" className="text-lg" />
            Today's Tours ({toursData.todayTours.length})
          </h3>
          <div className="space-y-3">
            {toursData.todayTours.map((tour) => (
              <TourCard key={tour.id} tour={tour} isToday statusMenuTourId={statusMenuTourId} onStatusMenuToggle={setStatusMenuTourId} isUpdating={updateStatusMutation.isPending} isCheckingIn={checkInMutation.isPending} onCheckIn={handleCheckIn} onStatusUpdate={handleStatusUpdate} formatDate={formatDate} />
            ))}
          </div>
        </div>
      )}

      {toursData.todayTours.length === 0 && (
        <div className="flex flex-col items-center py-8 bg-white/40 dark:bg-white/5 rounded-xl animate-content-enter-delay-2">
          <Icon name="event_available" className="text-4xl text-primary/30 dark:text-white/70 mb-2" />
          <p className="text-primary/80 dark:text-white/80 text-sm">No tours scheduled for today</p>
        </div>
      )}

      {toursData.upcomingTours.length > 0 && (
        <div className="animate-content-enter-delay-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70 dark:text-white/70 mb-3 flex items-center gap-2" style={{ fontFamily: 'var(--font-label)' }}>
            <Icon name="upcoming" className="text-lg" />
            Upcoming Tours ({toursData.upcomingTours.length})
          </h3>
          <div className="space-y-3">
            {toursData.upcomingTours.map((tour) => (
              <TourCard key={tour.id} tour={tour} statusMenuTourId={statusMenuTourId} onStatusMenuToggle={setStatusMenuTourId} isUpdating={updateStatusMutation.isPending} isCheckingIn={checkInMutation.isPending} onCheckIn={handleCheckIn} onStatusUpdate={handleStatusUpdate} formatDate={formatDate} />
            ))}
          </div>
        </div>
      )}

      {toursData.todayTours.length === 0 && toursData.upcomingTours.length === 0 && toursData.pastTours.length === 0 && (
        <EmptyState
          icon="tour"
          title="No tours found"
          description="Tours will appear here after syncing from HubSpot"
          variant="compact"
        />
      )}

      {toursData.pastTours.length > 0 && (
        <div className="animate-content-enter-delay-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-primary/70 dark:text-white/70 mb-3 flex items-center gap-2">
            <Icon name="history" className="text-lg" />
            Past Tours ({toursData.pastTours.length})
          </h3>
          <div className="space-y-3">
            {toursData.pastTours.map((tour) => (
              <TourCard key={tour.id} tour={tour} isPast statusMenuTourId={statusMenuTourId} onStatusMenuToggle={setStatusMenuTourId} isUpdating={updateStatusMutation.isPending} isCheckingIn={checkInMutation.isPending} onCheckIn={handleCheckIn} onStatusUpdate={handleStatusUpdate} formatDate={formatDate} />
            ))}
          </div>
        </div>
      )}

      </AnimatedPage>
  );
};

export default ToursTab;
