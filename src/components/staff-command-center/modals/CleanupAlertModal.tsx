import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { playSound } from '../../../utils/sounds';
import Icon from '../../icons/Icon';

interface CleanupAlertData {
  bookingId: number;
  resourceName: string;
  resourceType: string;
  memberName: string;
  endTime: string;
  hasNextBooking: boolean;
  nextBookingMember: string | null;
  nextBookingStartTime: string | null;
}

interface CleanupAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: CleanupAlertData | null;
}

function formatTime(time: string): string {
  try {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return time;
  }
}

const CleanupAlertModal: React.FC<CleanupAlertModalProps> = ({
  isOpen,
  onClose,
  data,
}) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastBookingIdRef = useRef<number | null>(null);

  const bookingId = data?.bookingId ?? null;

  useEffect(() => {
    if (isOpen) {
      const isNewAlert = bookingId !== lastBookingIdRef.current;
      lastBookingIdRef.current = bookingId;

      if (isNewAlert) {
        playSound('cleanupAlert');
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onClose();
      }, 7000);
    } else {
      lastBookingIdRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isOpen, onClose, bookingId]);

  if (!isOpen || !data) return null;

  const isConferenceRoom = data.resourceType === 'conference' || data.resourceType === 'conference_room';

  const modal = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 'calc(var(--z-modal) + 10)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute',
          top: '-50px',
          left: '-50px',
          right: '-50px',
          bottom: '-50px',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
        }}
        aria-hidden="true"
      />
      <div
        className="relative w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300"
        style={{ position: 'relative', zIndex: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 text-center bg-gradient-to-br from-amber-700 via-amber-600 to-orange-700">
          <div className="flex justify-end mb-2">
            <button
              onClick={onClose}
              className="tactile-btn w-7 h-7 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors text-white"
              aria-label="Close"
            >
              <Icon name="close" className="text-sm" />
            </button>
          </div>

          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
            <Icon name={isConferenceRoom ? 'meeting_room' : 'sports_golf'} className="text-3xl text-white" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">{data.resourceName}</h2>
          <p className="text-white/80 text-sm font-medium mb-3">Session Ending Soon</p>

          <div className="bg-white/15 rounded-lg p-3 mb-3">
            <div className="flex items-center justify-center gap-2 text-white text-sm">
              <Icon name="person" className="text-base" />
              <span className="font-medium">{data.memberName}</span>
            </div>
            <div className="flex items-center justify-center gap-2 text-white/80 text-xs mt-1">
              <Icon name="schedule" className="text-sm" />
              <span>Ends at {formatTime(data.endTime)} — 10 minutes remaining</span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-white text-xs bg-white/10 rounded-lg p-3 mb-3 text-left">
            <Icon name="cleaning_services" className="text-base text-amber-200 flex-shrink-0" />
            <span>
              {isConferenceRoom
                ? 'Please clean up and reset the conference room — clear items, wipe surfaces, and reset A/V equipment.'
                : 'Please clean up and reset the bay — collect equipment, wipe surfaces, and reset the screen.'}
            </span>
          </div>

          {data.hasNextBooking && (
            <div className="flex items-center justify-center gap-2 text-amber-100 text-xs bg-white/10 rounded-lg p-2">
              <Icon name="arrow_forward" className="text-sm" />
              <span>
                Next: <strong>{data.nextBookingMember}</strong>
                {data.nextBookingStartTime && ` at ${formatTime(data.nextBookingStartTime)}`}
              </span>
            </div>
          )}

          {!data.hasNextBooking && (
            <div className="flex items-center justify-center gap-2 text-white/60 text-xs">
              <Icon name="check_circle" className="text-sm" />
              <span>No upcoming booking</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default CleanupAlertModal;
