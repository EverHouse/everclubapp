import { beforeAll, afterAll } from 'vitest';

export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

export interface TestSession {
  cookie: string;
  email?: string;
}

export async function assertServerAvailable(): Promise<void> {
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000) 
      });
      
      if (response.ok) {
        console.log(`[E2E Setup] API server available at ${BASE_URL}`);
        return;
      }
      
      lastError = new Error(`API server returned status ${response.status}`);
    } catch (err) {
      lastError = err as Error;
    }
    
    if (i < maxRetries - 1) {
      console.log(`[E2E Setup] Retry ${i + 1}/${maxRetries} - waiting 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  throw new Error(
    `CRITICAL: API server is not available at ${BASE_URL}. ` +
    `E2E tests cannot run without a functioning backend. ` +
    `Last error: ${lastError?.message || 'Unknown error'}`
  );
}

export async function login(
  email: string, 
  role: 'member' | 'staff' | 'admin', 
  tier?: string
): Promise<TestSession> {
  const response = await fetch(`${BASE_URL}/api/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, tier }),
    signal: AbortSignal.timeout(5000)
  });
  
  if (!response.ok) {
    throw new Error(`Login failed for ${email}: ${response.status} ${response.statusText}`);
  }
  
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error(`No session cookie returned for ${email}`);
  }
  
  return { cookie: setCookie, email };
}

export async function fetchWithSession(
  url: string, 
  session: TestSession, 
  options: RequestInit = {},
  timeoutMs: number = 5000
): Promise<Response> {
  return fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      ...options.headers,
      'Cookie': session.cookie,
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
}
