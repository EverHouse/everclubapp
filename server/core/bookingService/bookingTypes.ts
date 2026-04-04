export class BookingValidationError extends Error {
  constructor(public statusCode: number, public errorBody: Record<string, unknown>) {
    super(typeof errorBody.error === 'string' ? errorBody.error : 'Booking validation error');
    this.name = 'BookingValidationError';
  }
}

export interface SanitizedParticipant {
  email: string;
  type: 'member' | 'guest';
  userId?: string;
  name?: string;
  isGuestPassParticipant?: boolean;
}
