type BookingEventCallback = () => void;

const BATCH_WINDOW_MS = 150;

class BookingEventEmitter {
  private listeners: Set<BookingEventCallback> = new Set();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(callback: BookingEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(): void {
    if (this.flushTimer !== null) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.listeners.forEach(callback => {
        try {
          callback();
        } catch (error: unknown) {
          console.error('[BookingEvents] Error in listener:', error);
        }
      });
    }, BATCH_WINDOW_MS);
  }
}

export const bookingEvents = new BookingEventEmitter();
