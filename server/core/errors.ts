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
