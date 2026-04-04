import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { useTheme } from '../../../contexts/ThemeContext';
import { createPacificDate } from '../../../utils/dateUtils';
import { downloadICalFile } from '../../../utils/icalUtils';
import { RosterManager } from '../../../components/booking';
import { useToast } from '../../../hooks/useToast';
import { getIconForType, type ScheduleItem, type DashboardBookingItem, type DBBookingRequest, type DBBooking, type DBRSVP, type DBWellnessEnrollment } from './dashboardTypes';
import { PopInSection } from '../../../components/motion';
import Icon from '../../../components/icons/Icon';

interface HeroScheduleCardProps {
  item: ScheduleItem;
  isStaffOrAdminProfile: boolean;
  refetchAllData: () => void;
  walletPassAvailable: boolean;
  walletPassDownloading: number | null;
  handleDownloadBookingWalletPass: (id: number) => void;
  handleCancelBooking: (id: number, type: 'booking' | 'booking_request') => void;
  handleLeaveBooking: (id: number, name?: string | null) => void;
  handleCancelRSVP: (eventId: number) => void;
  handleCancelWellness: (classId: number) => void;
}

function formatTime12(time24: string): string {
  try {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
  } catch {
    return time24;
  }
}

function getElapsedDisplay(startDate: Date, now: Date): string {
  const diffMs = now.getTime() - startDate.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (hrs > 0) return `${hrs}h ${remainingMins}m elapsed`;
  return `${mins}m elapsed`;
}

function getCountdownDisplay(targetDate: Date, now: Date): string {
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'Starting now';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) return `Starts in ${hours}h ${mins}m`;
  return `Starts in ${mins}m`;
}

function getStartTime(item: ScheduleItem): string {
  const raw = item.raw;
  if ('start_time' in raw && raw.start_time) return raw.start_time as string;
  if ('time' in raw && raw.time) return raw.time as string;
  return '';
}

function getEndTime(item: ScheduleItem): string {
  const raw = item.raw;
  if ('end_time' in raw && raw.end_time) return raw.end_time as string;
  return '';
}

const HeroScheduleCard: React.FC<HeroScheduleCardProps> = ({
  item,
  isStaffOrAdminProfile,
  refetchAllData,
  walletPassAvailable,
  walletPassDownloading,
  handleDownloadBookingWalletPass,
  handleCancelBooking,
  handleLeaveBooking,
  handleCancelRSVP,
  handleCancelWellness,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const { showToast } = useToast();
  const [now, setNow] = useState(new Date());
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const isBookingType = item.type === 'booking' || item.type === 'booking_request';
  const isRsvp = item.type === 'rsvp';
  const isWellness = item.type === 'wellness';
  const isConferenceCalendar = item.type === 'conference_room_calendar';

  const startTime24 = getStartTime(item);
  const endTime24 = getEndTime(item);

  const bookingStatus = isBookingType
    ? ((item as unknown as DashboardBookingItem).status || '')
    : isConferenceCalendar
      ? ((item as unknown as DashboardBookingItem).status || (item.raw as unknown as Record<string, unknown>).status as string || '')
      : '';
  const isOwner = isBookingType ? !(item as unknown as DashboardBookingItem).isLinkedMember : true;
  const isLinkedMember = isBookingType ? (item as unknown as DashboardBookingItem).isLinkedMember || false : false;
  const primaryBookerName = isBookingType ? (item as unknown as DashboardBookingItem).primaryBookerName : null;
  const resourceType = item.resourceType;
  const isCancellationPending = bookingStatus === 'cancellation_pending';

  const startDate = useMemo(() => {
    if (!item.rawDate || !startTime24) return null;
    return createPacificDate(item.rawDate, startTime24);
  }, [item.rawDate, startTime24]);

  const endDate = useMemo(() => {
    if (!item.rawDate || !endTime24) return null;
    return createPacificDate(item.rawDate, endTime24);
  }, [item.rawDate, endTime24]);

  const isInProgress = useMemo(() => {
    if (!startDate) return false;
    if (isBookingType || isConferenceCalendar) {
      if (!endDate) return false;
      return startDate <= now && now < endDate && (bookingStatus === 'checked_in' || bookingStatus === 'attended');
    }
    if (endDate) return startDate <= now && now < endDate;
    return startDate <= now && (now.getTime() - startDate.getTime()) < 3 * 60 * 60 * 1000;
  }, [startDate, endDate, now, bookingStatus, isBookingType, isConferenceCalendar]);

  const isUpcomingSoon = useMemo(() => {
    if (!startDate) return false;
    const diffMs = startDate.getTime() - now.getTime();
    return diffMs > 0 && diffMs <= 2 * 60 * 60 * 1000;
  }, [startDate, now]);

  const progressPercent = useMemo(() => {
    if (!isInProgress || !startDate || !endDate) return 0;
    const total = endDate.getTime() - startDate.getTime();
    const elapsed = now.getTime() - startDate.getTime();
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  }, [isInProgress, startDate, endDate, now]);

  const isSimulator = resourceType === 'simulator';
  const isConferenceRoom = resourceType === 'conference_room';
  const showRoster = (isBookingType || isConferenceCalendar) && (isSimulator || isConferenceRoom) &&
    ['approved', 'confirmed', 'checked_in', 'attended'].includes(bookingStatus) && isOwner;

  const rawBooking = item.raw as DBBookingRequest | DBBooking;
  const bayName = isBookingType
    ? (('bay_name' in rawBooking ? rawBooking.bay_name : null) ||
       ('resource_name' in rawBooking ? rawBooking.resource_name : null) || item.title)
    : item.title;

  const isConfirmed = bookingStatus === 'approved' || bookingStatus === 'confirmed';
  const bookingHasStarted = item.rawDate && startTime24
    ? createPacificDate(item.rawDate, startTime24) <= new Date()
    : false;
  const isWalletEligible = walletPassAvailable && (isBookingType || isConferenceCalendar) &&
    ['approved', 'confirmed', 'attended', 'checked_in'].includes(bookingStatus);
  const showCancel = (isBookingType || isConferenceCalendar) && !isLinkedMember && !bookingHasStarted &&
    bookingStatus !== 'attended' && !isCancellationPending && isConfirmed;
  const showLeave = isBookingType && isLinkedMember && isConfirmed && !bookingHasStarted;

  const handleRefetch = useCallback(() => refetchAllData(), [refetchAllData]);

  const handleIcalDownload = useCallback(() => {
    if (isBookingType || isConferenceCalendar) {
      downloadICalFile({
        title: `${item.title} - Ever Club`,
        description: `Your ${isConferenceRoom ? 'conference room' : 'golf simulator'} booking at Ever Club`,
        location: 'Ever Club, 15771 Red Hill Ave, Ste 500, Tustin, CA 92780',
        startDate: item.rawDate,
        startTime: startTime24,
        endTime: endTime24
      }, `EverClub_${item.rawDate}_${item.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
    } else if (isRsvp) {
      const rsvpRaw = item.raw as DBRSVP;
      downloadICalFile({
        title: `${item.title} - Ever Club`,
        description: `Your event at Ever Club`,
        location: rsvpRaw.location || 'Ever Club, 15771 Red Hill Ave, Ste 500, Tustin, CA 92780',
        startDate: item.rawDate,
        startTime: rsvpRaw.start_time,
        endTime: rsvpRaw.end_time || ''
      }, `EverClub_${item.rawDate}_${item.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
    } else if (isWellness) {
      const wellnessRaw = item.raw as DBWellnessEnrollment;
      downloadICalFile({
        title: `${item.title} - Ever Club`,
        description: `Your wellness class at Ever Club`,
        location: 'Ever Club, 15771 Red Hill Ave, Ste 500, Tustin, CA 92780',
        startDate: item.rawDate,
        startTime: wellnessRaw.time,
        endTime: ''
      }, `EverClub_${item.rawDate}_${item.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
    }
  }, [item, isBookingType, isConferenceCalendar, isRsvp, isWellness, isConferenceRoom, startTime24, endTime24]);

  const handleCancel = useCallback(() => {
    if (isBookingType) {
      handleCancelBooking(Number(item.dbId), item.type as 'booking' | 'booking_request');
    } else if (isRsvp) {
      const rsvpRaw = item.raw as DBRSVP;
      handleCancelRSVP(rsvpRaw.event_id);
    } else if (isWellness) {
      const wellnessRaw = item.raw as DBWellnessEnrollment;
      handleCancelWellness(wellnessRaw.class_id);
    } else if (isConferenceCalendar) {
      handleCancelBooking(Number(item.dbId), 'booking');
    }
  }, [item, isBookingType, isRsvp, isWellness, isConferenceCalendar, handleCancelBooking, handleCancelRSVP, handleCancelWellness]);

  const gradientBg = isInProgress
    ? 'from-emerald-700 via-emerald-600 to-green-700'
    : isRsvp
      ? 'from-indigo-700 via-indigo-600 to-purple-700'
      : isWellness
        ? 'from-teal-700 via-teal-600 to-cyan-700'
        : 'from-primary via-primary/90 to-primary/80';

  const subtitle = useMemo(() => {
    if (isRsvp) {
      const rsvpRaw = item.raw as DBRSVP;
      return rsvpRaw.location || rsvpRaw.category || '';
    }
    if (isWellness) {
      const wellnessRaw = item.raw as DBWellnessEnrollment;
      const parts: string[] = [];
      if (wellnessRaw.instructor) parts.push(wellnessRaw.instructor);
      if (wellnessRaw.category) parts.push(wellnessRaw.category);
      return parts.join(' · ');
    }
    return '';
  }, [item, isRsvp, isWellness]);

  const cancelLabel = isRsvp ? 'Cancel RSVP' : isWellness ? 'Cancel' : 'Cancel Booking';

  return (
    <PopInSection className="mb-4">
      <div className={`rounded-2xl overflow-hidden shadow-xl bg-gradient-to-br ${gradientBg}`}>
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {isInProgress && (
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-400" />
                </span>
              )}
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70" style={{ fontFamily: 'var(--font-label)' }}>
                {isInProgress ? 'In Progress' : 'Coming Up'}
              </span>
            </div>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/15">
              <Icon name={getIconForType(resourceType)} className="text-2xl text-white" />
            </div>
          </div>

          <h3 className="text-2xl font-bold text-white mb-0.5" style={{ fontFamily: 'var(--font-headline)' }}>
            {bayName}
          </h3>

          {subtitle && (
            <p className="text-white/60 text-xs mb-1">{subtitle}</p>
          )}

          <p className="text-white/80 text-sm font-medium mb-3">
            {item.date} &bull; {formatTime12(startTime24)}{endTime24 ? ` – ${formatTime12(endTime24)}` : ''}
          </p>

          {isInProgress && startDate && endDate && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                <span>{getElapsedDisplay(startDate, now)}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/70 rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {isUpcomingSoon && !isInProgress && startDate && (
            <div className="flex items-center gap-1.5 mb-3 text-amber-200 text-xs">
              <Icon name="schedule" className="text-sm" />
              <span className="font-medium">{getCountdownDisplay(startDate, now)}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            {(isBookingType || isConferenceCalendar) && ['approved', 'confirmed', 'checked_in'].includes(bookingStatus) && (
              <HeroActionButton icon="qr_code" label={showQr ? 'Hide QR' : 'Check-in QR'} onClick={() => setShowQr(prev => !prev)} />
            )}

            {isWalletEligible && (
              <HeroActionButton
                icon={walletPassDownloading === Number(item.dbId) ? 'progress_activity' : 'wallet'}
                label="Add to Wallet"
                onClick={() => handleDownloadBookingWalletPass(Number(item.dbId))}
                disabled={walletPassDownloading === Number(item.dbId)}
              />
            )}

            {isConfirmed && (
              <HeroActionButton icon="calendar_add_on" label="Add to Calendar" onClick={handleIcalDownload} />
            )}

            {showCancel && (
              <HeroActionButton icon="close" label={cancelLabel} onClick={handleCancel} variant="danger" />
            )}

            {showLeave && (
              <HeroActionButton icon="logout" label="Leave" onClick={() => handleLeaveBooking(Number(item.dbId), primaryBookerName)} variant="danger" />
            )}
          </div>
        </div>

        {showQr && (
          <div className="px-5 pb-4">
            <div className="bg-white/10 rounded-xl p-4 flex flex-col items-center">
              <HeroQrCode bookingId={item.dbId} />
              <p className="text-white/50 text-[11px] mt-2">Show at front desk for check-in</p>
            </div>
          </div>
        )}

        {showRoster && (
          <div className="px-5 pb-4">
            <div className="bg-white/10 rounded-xl p-3">
              <RosterManager
                bookingId={item.dbId}
                declaredPlayerCount={(rawBooking as DBBookingRequest).declared_player_count || 1}
                isOwner={isOwner}
                isStaff={isStaffOrAdminProfile}
                onUpdate={handleRefetch}
                resourceType={isConferenceRoom ? 'conference_room' : 'simulator'}
              />
            </div>
          </div>
        )}
      </div>

    </PopInSection>
  );
};

const HeroActionButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}> = ({ icon, label, onClick, disabled, variant = 'default' }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-medium transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    } ${
      variant === 'danger'
        ? 'bg-white/10 hover:bg-red-500/30'
        : 'bg-white/15 hover:bg-white/25'
    }`}
  >
    <Icon name={icon} className="text-base" />
    {label}
  </button>
);

const HeroQrCode: React.FC<{ bookingId: string | number }> = ({ bookingId }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setReady(false);
    QRCode.toCanvas(canvas, `BOOKING:${bookingId}`, { width: 180, margin: 1 }, (err) => {
      if (!err) setReady(true);
    });
  }, [bookingId]);

  return (
    <div className="bg-white p-3 rounded-xl shadow-md inline-flex items-center justify-center">
      <canvas ref={canvasRef} style={{ display: ready ? 'block' : 'none', width: '120px', height: '120px' }} />
      {!ready && <div className="w-[120px] h-[120px] flex items-center justify-center text-gray-400"><Icon name="qr_code" className="text-4xl" /></div>}
    </div>
  );
};

export function findHeroItem(items: ScheduleItem[]): ScheduleItem | null {
  if (items.length === 0) return null;
  const now = new Date();

  for (const item of items) {
    const startTime = getStartTime(item);

    if (!item.rawDate || !startTime) continue;

    const startDate = createPacificDate(item.rawDate, startTime);
    const diffMs = startDate.getTime() - now.getTime();
    const isUpcoming = diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000;

    if (item.type === 'booking' || item.type === 'booking_request') {
      const bookingStatus = (item as unknown as DashboardBookingItem).status || '';
      if (!['approved', 'confirmed', 'checked_in', 'attended'].includes(bookingStatus)) continue;
      const endTimeStr = getEndTime(item);
      const endDate = endTimeStr && item.rawDate ? createPacificDate(item.rawDate, endTimeStr) : null;
      const isInProgress = startDate <= now && endDate != null && now < endDate && (bookingStatus === 'checked_in' || bookingStatus === 'attended');
      if (isUpcoming || isInProgress) return item;
    } else if (item.type === 'rsvp' || item.type === 'wellness') {
      const endTimeStr = getEndTime(item);
      if (endTimeStr) {
        const endDate = createPacificDate(item.rawDate, endTimeStr);
        const isInProgress = startDate <= now && now < endDate;
        if (isUpcoming || isInProgress) return item;
      } else {
        if (isUpcoming) return item;
      }
    } else if (item.type === 'conference_room_calendar') {
      const confStatus = (item as unknown as DashboardBookingItem).status || (item.raw as unknown as Record<string, unknown>).status as string || '';
      if (!['approved', 'confirmed', 'checked_in', 'attended'].includes(confStatus)) continue;
      const endTimeStr = getEndTime(item);
      const endDate = endTimeStr && item.rawDate ? createPacificDate(item.rawDate, endTimeStr) : null;
      const isInProgress = startDate <= now && endDate != null && now < endDate && (confStatus === 'checked_in' || confStatus === 'attended');
      if (isUpcoming || isInProgress) return item;
    }
  }
  return null;
}

export default React.memo(HeroScheduleCard);
