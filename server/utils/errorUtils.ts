export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return undefined;
}

export function getErrorStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode: unknown }).statusCode);
  }
  if (error && typeof error === 'object' && 'status' in error) {
    return Number((error as { status: unknown }).status);
  }
  return undefined;
}

export function isStripeError(error: unknown): error is { type: string; message: string; code?: string; statusCode?: number } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'type' in error &&
    typeof (error as { type: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('Stripe')
  );
}

export function getFullErrorDetails(error: unknown): { message: string; code?: string; statusCode?: number; stack?: string } {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const statusCode = getErrorStatusCode(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return { message, code, statusCode, stack };
}

export function getErrorDetail(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'detail' in error) {
    return String((error as { detail: unknown }).detail);
  }
  return undefined;
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) return error.stack;
  if (error && typeof error === 'object' && 'stack' in error) {
    return String((error as { stack: unknown }).stack);
  }
  return undefined;
}

export function getErrorProperty(error: unknown, key: string): unknown {
  if (error && typeof error === 'object' && key in error) {
    return (error as Record<string, unknown>)[key];
  }
  return undefined;
}
