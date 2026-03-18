/**
 * Low-level fetch helpers for use inside React Query queryFn callbacks.
 * For imperative API calls (mutations, actions outside React Query), use
 * apiRequest() from src/lib/apiRequest.ts which adds retry logic and
 * structured error handling via ApiResult<T>.
 */
export class ApiError extends Error {
  status: number;
  errorData: Record<string, unknown>;
  constructor(message: string, status: number, errorData: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorData = errorData;
  }
}

export async function fetchWithCredentials<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || errorData.message || `Request failed with status ${response.status}`,
      response.status,
      errorData
    );
  }

  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');

  if (response.status === 204 || contentLength === '0' || !contentType?.includes('application/json')) {
    return undefined as T;
  }

  return response.json();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function postWithCredentials<T>(url: string, data: unknown): Promise<T> {
  return fetchWithCredentials<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteWithCredentials<T>(url: string): Promise<T> {
  return fetchWithCredentials<T>(url, {
    method: 'DELETE',
  });
}

export async function putWithCredentials<T>(url: string, data: unknown): Promise<T> {
  return fetchWithCredentials<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function patchWithCredentials<T>(url: string, data: unknown): Promise<T> {
  return fetchWithCredentials<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
