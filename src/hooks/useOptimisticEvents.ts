import { useState, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';
import { fetchWithCredentials, postWithCredentials, deleteWithCredentials } from './queries/useFetch';

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
  _optimistic?: boolean;
  _pending?: 'creating' | 'updating' | 'deleting';
}

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
  _optimistic?: boolean;
  _pending?: 'adding' | 'removing';
}

interface OptimisticState {
  pendingEventIds: Set<number>;
  pendingParticipantIds: Set<number>;
  deletingEventIds: Set<number>;
  deletingParticipantIds: Set<number>;
}

interface UseOptimisticEventsOptions {
  onEventSaveSuccess?: (event: DBEvent, isNew: boolean) => void;
  onEventSaveError?: (error: Error) => void;
  onEventDeleteSuccess?: (eventId: number) => void;
  onEventDeleteError?: (eventId: number, error: Error) => void;
  onParticipantAddSuccess?: (participant: Participant) => void;
  onParticipantAddError?: (error: Error) => void;
  onParticipantRemoveSuccess?: (participantId: number) => void;
  onParticipantRemoveError?: (participantId: number, error: Error) => void;
}

export function useOptimisticEvents(options: UseOptimisticEventsOptions = {}) {
  const { showToast } = useToast();
  const [optimisticState, setOptimisticState] = useState<OptimisticState>({
    pendingEventIds: new Set(),
    pendingParticipantIds: new Set(),
    deletingEventIds: new Set(),
    deletingParticipantIds: new Set(),
  });
  
  const eventsSnapshotRef = useRef<DBEvent[]>([]);
  const participantsSnapshotRef = useRef<Participant[]>([]);

  const markEventPending = useCallback((eventId: number, pending: boolean) => {
    setOptimisticState(prev => {
      const newPendingIds = new Set(prev.pendingEventIds);
      if (pending) {
        newPendingIds.add(eventId);
      } else {
        newPendingIds.delete(eventId);
      }
      return { ...prev, pendingEventIds: newPendingIds };
    });
  }, []);

  const markEventDeleting = useCallback((eventId: number, deleting: boolean) => {
    setOptimisticState(prev => {
      const newDeletingIds = new Set(prev.deletingEventIds);
      if (deleting) {
        newDeletingIds.add(eventId);
      } else {
        newDeletingIds.delete(eventId);
      }
      return { ...prev, deletingEventIds: newDeletingIds };
    });
  }, []);

  const markParticipantPending = useCallback((participantId: number, pending: boolean) => {
    setOptimisticState(prev => {
      const newPendingIds = new Set(prev.pendingParticipantIds);
      if (pending) {
        newPendingIds.add(participantId);
      } else {
        newPendingIds.delete(participantId);
      }
      return { ...prev, pendingParticipantIds: newPendingIds };
    });
  }, []);

  const markParticipantDeleting = useCallback((participantId: number, deleting: boolean) => {
    setOptimisticState(prev => {
      const newDeletingIds = new Set(prev.deletingParticipantIds);
      if (deleting) {
        newDeletingIds.add(participantId);
      } else {
        newDeletingIds.delete(participantId);
      }
      return { ...prev, deletingParticipantIds: newDeletingIds };
    });
  }, []);

  const isEventPending = useCallback((eventId: number) => {
    return optimisticState.pendingEventIds.has(eventId);
  }, [optimisticState.pendingEventIds]);

  const isEventDeleting = useCallback((eventId: number) => {
    return optimisticState.deletingEventIds.has(eventId);
  }, [optimisticState.deletingEventIds]);

  const isParticipantPending = useCallback((participantId: number) => {
    return optimisticState.pendingParticipantIds.has(participantId);
  }, [optimisticState.pendingParticipantIds]);

  const isParticipantDeleting = useCallback((participantId: number) => {
    return optimisticState.deletingParticipantIds.has(participantId);
  }, [optimisticState.deletingParticipantIds]);

  const saveEventOptimistic = useCallback(async (
    payload: Record<string, unknown>,
    editId: number | null,
    onOptimisticUpdate?: (event: Partial<DBEvent>) => void,
    onRevert?: () => void
  ): Promise<DBEvent | null> => {
    const tempId = editId || Date.now();
    markEventPending(tempId, true);
    
    const optimisticEvent: Partial<DBEvent> = {
      ...payload,
      id: tempId,
      _optimistic: true,
      _pending: editId ? 'updating' : 'creating',
    } as Partial<DBEvent>;
    
    onOptimisticUpdate?.(optimisticEvent);
    
    try {
      const url = editId ? `/api/events/${editId}` : '/api/events';
      const method = editId ? 'PUT' : 'POST';
      const savedEvent = await fetchWithCredentials<DBEvent>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      showToast(editId ? 'Event updated successfully' : 'Event created successfully', 'success');
      options.onEventSaveSuccess?.(savedEvent, !editId);
      return savedEvent;
    } catch (err: any) {
      showToast(err.message || 'Failed to save event', 'error');
      options.onEventSaveError?.(err);
      onRevert?.();
      return null;
    } finally {
      markEventPending(tempId, false);
    }
  }, [markEventPending, showToast, options]);

  const deleteEventOptimistic = useCallback(async (
    eventId: number,
    onOptimisticDelete?: () => void,
    onRevert?: () => void
  ): Promise<boolean> => {
    markEventDeleting(eventId, true);
    onOptimisticDelete?.();
    
    try {
      await deleteWithCredentials(`/api/events/${eventId}`);
      showToast('Event archived successfully', 'success');
      options.onEventDeleteSuccess?.(eventId);
      return true;
    } catch (err: any) {
      showToast(err.message || 'Failed to archive event', 'error');
      options.onEventDeleteError?.(eventId, err);
      onRevert?.();
      return false;
    } finally {
      markEventDeleting(eventId, false);
    }
  }, [markEventDeleting, showToast, options]);

  const addParticipantOptimistic = useCallback(async (
    type: 'rsvp' | 'enrollment',
    eventOrClassId: number,
    email: string,
    onOptimisticAdd?: (participant: Partial<Participant>) => void,
    onRevert?: () => void
  ): Promise<Participant | null> => {
    const tempId = Date.now();
    markParticipantPending(tempId, true);
    
    const optimisticParticipant: Partial<Participant> = {
      id: tempId,
      userEmail: email,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      firstName: null,
      lastName: null,
      phone: null,
      _optimistic: true,
      _pending: 'adding',
    };
    
    onOptimisticAdd?.(optimisticParticipant);
    
    try {
      const url = type === 'rsvp' 
        ? `/api/events/${eventOrClassId}/rsvps/manual`
        : `/api/wellness-classes/${eventOrClassId}/enrollments/manual`;
      const savedParticipant = await postWithCredentials<Participant>(url, { email });
      
      showToast(`${type === 'rsvp' ? 'RSVP' : 'Enrollment'} added successfully`, 'success');
      options.onParticipantAddSuccess?.(savedParticipant);
      return savedParticipant;
    } catch (err: any) {
      showToast(err.message || `Failed to add ${type === 'rsvp' ? 'RSVP' : 'enrollment'}`, 'error');
      options.onParticipantAddError?.(err);
      onRevert?.();
      return null;
    } finally {
      markParticipantPending(tempId, false);
    }
  }, [markParticipantPending, showToast, options]);

  const removeRsvpOptimistic = useCallback(async (
    eventId: number,
    rsvpId: number,
    onOptimisticRemove?: () => void,
    onRevert?: () => void
  ): Promise<boolean> => {
    markParticipantDeleting(rsvpId, true);
    onOptimisticRemove?.();
    
    try {
      await deleteWithCredentials(`/api/events/${eventId}/rsvps/${rsvpId}`);
      showToast('RSVP removed successfully', 'success');
      options.onParticipantRemoveSuccess?.(rsvpId);
      return true;
    } catch (err: any) {
      showToast(err.message || 'Failed to remove RSVP', 'error');
      options.onParticipantRemoveError?.(rsvpId, err);
      onRevert?.();
      return false;
    } finally {
      markParticipantDeleting(rsvpId, false);
    }
  }, [markParticipantDeleting, showToast, options]);

  const removeEnrollmentOptimistic = useCallback(async (
    classId: number,
    userEmail: string,
    participantId: number,
    onOptimisticRemove?: () => void,
    onRevert?: () => void
  ): Promise<boolean> => {
    markParticipantDeleting(participantId, true);
    onOptimisticRemove?.();
    
    try {
      await deleteWithCredentials(`/api/wellness-enrollments/${classId}/${encodeURIComponent(userEmail)}`);
      showToast('Enrollment removed successfully', 'success');
      options.onParticipantRemoveSuccess?.(participantId);
      return true;
    } catch (err: any) {
      showToast(err.message || 'Failed to remove enrollment', 'error');
      options.onParticipantRemoveError?.(participantId, err);
      onRevert?.();
      return false;
    } finally {
      markParticipantDeleting(participantId, false);
    }
  }, [markParticipantDeleting, showToast, options]);

  return {
    optimisticState,
    isEventPending,
    isEventDeleting,
    isParticipantPending,
    isParticipantDeleting,
    markEventPending,
    markEventDeleting,
    markParticipantPending,
    markParticipantDeleting,
    saveEventOptimistic,
    deleteEventOptimistic,
    addParticipantOptimistic,
    removeRsvpOptimistic,
    removeEnrollmentOptimistic,
    eventsSnapshotRef,
    participantsSnapshotRef,
  };
}

export default useOptimisticEvents;
