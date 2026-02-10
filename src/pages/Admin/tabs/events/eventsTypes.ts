export interface Participant {
    id: number;
    userEmail: string;
    status: string;
    source?: string | null;
    attendeeName?: string | null;
    ticketClass?: string | null;
    checkedIn?: boolean | null;
    matchedUserId?: string | null;
    guestCount?: number | null;
    orderDate?: string | null;
    createdAt: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
}

export interface DBEvent {
    id: number;
    title: string;
    description: string;
    event_date: string;
    start_time: string;
    end_time: string;
    location: string;
    category: string;
    image_url: string | null;
    max_attendees: number | null;
    eventbrite_id: string | null;
    eventbrite_url: string | null;
    external_url?: string | null;
    visibility?: string;
    block_bookings?: boolean;
    block_simulators?: boolean;
    block_conference_room?: boolean;
}

export interface WellnessClass {
  id: number;
  title: string;
  time: string;
  instructor: string;
  duration: string;
  category: string;
  spots: string;
  status: string;
  description: string | null;
  date: string;
  is_active: boolean;
  image_url?: string | null;
  external_url?: string | null;
  visibility?: string;
  block_bookings?: boolean;
  block_simulators?: boolean;
  block_conference_room?: boolean;
  capacity?: number | null;
  waitlist_enabled?: boolean;
  enrolled_count?: number;
  waitlist_count?: number;
  needs_review?: boolean;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  conflict_detected?: boolean;
}

export interface WellnessFormData extends Partial<WellnessClass> {
  imageFile?: File | null;
  endTime?: string;
}

export interface Resource {
  id: number;
  name: string;
  type: string;
}

export const CATEGORY_TABS = [
    { id: 'all', label: 'All', icon: 'calendar_month' },
    { id: 'Social', label: 'Social', icon: 'celebration' },
    { id: 'Golf', label: 'Golf', icon: 'golf_course' },
    { id: 'Tournaments', label: 'Tournaments', icon: 'emoji_events' },
    { id: 'Dining', label: 'Dining', icon: 'restaurant' },
    { id: 'Networking', label: 'Networking', icon: 'handshake' },
    { id: 'Workshops', label: 'Workshops', icon: 'school' },
    { id: 'Family', label: 'Family', icon: 'family_restroom' },
    { id: 'Entertainment', label: 'Entertainment', icon: 'music_note' },
    { id: 'Charity', label: 'Charity', icon: 'volunteer_activism' },
];

export const WELLNESS_CATEGORY_TABS = [
    { id: 'all', label: 'All', icon: 'calendar_month' },
    { id: 'Classes', label: 'Classes', icon: 'fitness_center' },
    { id: 'MedSpa', label: 'MedSpa', icon: 'spa' },
    { id: 'Recovery', label: 'Recovery', icon: 'ac_unit' },
    { id: 'Therapy', label: 'Therapy', icon: 'healing' },
    { id: 'Nutrition', label: 'Nutrition', icon: 'nutrition' },
    { id: 'Personal Training', label: 'Training', icon: 'sports' },
    { id: 'Mindfulness', label: 'Mindfulness', icon: 'self_improvement' },
    { id: 'Outdoors', label: 'Outdoors', icon: 'hiking' },
    { id: 'General', label: 'General', icon: 'category' },
];

export interface ParticipantDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    participants: Participant[];
    isLoading: boolean;
    type: 'rsvp' | 'enrollment';
    eventId?: number;
    classId?: number;
    onRefresh?: () => void;
    eventbriteId?: string | null;
}

export interface NeedsReviewEvent {
    id: number;
    title: string;
    description: string | null;
    event_date: string;
    start_time: string;
    end_time: string | null;
    location: string | null;
    category: string | null;
    source: string | null;
    visibility: string | null;
    needs_review: boolean;
    conflict_detected?: boolean;
    block_simulators?: boolean;
    block_conference_room?: boolean;
}

export const INITIAL_DISPLAY_COUNT = 20;
