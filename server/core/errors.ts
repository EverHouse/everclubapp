export class AppError extends Error {
  public readonly statusCode: number;
  public readonly error: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    error: string,
    extras?: Record<string, unknown>
  ) {
    super(error);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.error = error;
    if (extras) {
      this.details = extras;
      for (const [key, value] of Object.entries(extras)) {
        if (key !== 'statusCode' && key !== 'error' && key !== 'details') {
          (this as Record<string, unknown>)[key] = value;
        }
      }
    }
    Error.captureStackTrace(this, this.constructor);
  }
}

export const STALE_BOOKING_MESSAGE = 'This booking was updated by someone else. Please refresh and try again.';

export class StaleBookingVersionError extends AppError {
  constructor() {
    super(409, STALE_BOOKING_MESSAGE);
    this.name = 'StaleBookingVersionError';
  }
}

export function assertBookingVersion(
  expectedVersion: number | undefined,
  currentVersion: number | null | undefined
): void {
  if (expectedVersion !== undefined && expectedVersion !== (currentVersion ?? 1)) {
    throw new StaleBookingVersionError();
  }
}

export class GuestPassHoldError extends Error {
  constructor(message: string, public readonly passesAvailable?: number) {
    super(message);
    this.name = 'GuestPassHoldError';
    Error.captureStackTrace(this, this.constructor);
  }
}
