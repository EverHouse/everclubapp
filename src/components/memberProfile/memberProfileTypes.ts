import type { MemberProfile } from '../../types/data';

export interface MemberProfileDrawerProps {
  isOpen: boolean;
  member: MemberProfile | null;
  isAdmin: boolean;
  onClose: () => void;
  onViewAs: (member: MemberProfile) => void;
  onMemberDeleted?: () => void;
  visitorMode?: boolean;
}

export interface MemberHistory {
  bookingHistory: any[];
  bookingRequestsHistory: any[];
  eventRsvpHistory: any[];
  wellnessHistory: any[];
  guestPassInfo: any | null;
  guestCheckInsHistory: any[];
  visitHistory: any[];
  pastBookingsCount?: number;
  pastEventsCount?: number;
  pastWellnessCount?: number;
  attendedVisitsCount?: number;
}

export interface GuestVisit {
  id: number;
  bookingId: number;
  guestName: string | null;
  guestEmail: string | null;
  visitDate: string;
  startTime: string;
  resourceName: string | null;
}

export interface MemberNote {
  id: number;
  memberEmail: string;
  content: string;
  createdBy: string;
  createdByName: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationLog {
  id: number;
  memberEmail: string;
  type: string;
  direction: string;
  subject: string;
  body: string;
  status: string;
  occurredAt: string;
  loggedBy: string;
  loggedByName: string;
  createdAt: string;
}

export type TabType = 'overview' | 'billing' | 'activity' | 'notes' | 'communications';

export const stripHtml = (html: string) => html?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';

export const formatDatePacific = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  try {
    const normalizedDate = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
    const d = new Date(normalizedDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  } catch {
    return dateStr;
  }
};

export const formatDateTimePacific = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
  } catch {
    return dateStr;
  }
};

export const formatTime12Hour = (timeStr: string): string => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.substring(0, 5).split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
};
