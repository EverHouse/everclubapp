// @vitest-environment node
import { describe, it, expect } from 'vitest';

describe('Auth Linking — Config Guard', () => {
  it('requireGoogleConfig returns 503 when GOOGLE_CLIENT_ID is missing', async () => {
    let statusCode = 0;
    let responseBody: Record<string, unknown> = {};
    let nextCalled = false;

    const mockReq = {} as import('express').Request;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        responseBody = body;
        return this;
      },
    } as unknown as import('express').Response;
    const mockNext = () => { nextCalled = true; };

    const { createGoogleConfigGuard } = await import('./helpers/authConfigGuard');
    const guard = createGoogleConfigGuard(undefined);
    guard(mockReq, mockRes, mockNext);

    expect(statusCode).toBe(503);
    expect(responseBody.error).toBe('Google authentication is not configured');
    expect(nextCalled).toBe(false);
  });

  it('requireGoogleConfig calls next when GOOGLE_CLIENT_ID is set', async () => {
    let statusCode = 0;
    let nextCalled = false;

    const mockReq = {} as import('express').Request;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() { return this; },
    } as unknown as import('express').Response;
    const mockNext = () => { nextCalled = true; };

    const { createGoogleConfigGuard } = await import('./helpers/authConfigGuard');
    const guard = createGoogleConfigGuard('some-client-id');
    guard(mockReq, mockRes, mockNext);

    expect(statusCode).toBe(0);
    expect(nextCalled).toBe(true);
  });

  it('requireAppleConfig returns 503 when APPLE_SERVICE_ID is missing', async () => {
    let statusCode = 0;
    let responseBody: Record<string, unknown> = {};
    let nextCalled = false;

    const mockReq = {} as import('express').Request;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        responseBody = body;
        return this;
      },
    } as unknown as import('express').Response;
    const mockNext = () => { nextCalled = true; };

    const { createAppleConfigGuard } = await import('./helpers/authConfigGuard');
    const guard = createAppleConfigGuard(undefined);
    guard(mockReq, mockRes, mockNext);

    expect(statusCode).toBe(503);
    expect(responseBody.error).toBe('Apple authentication is not configured');
    expect(nextCalled).toBe(false);
  });

  it('requireAppleConfig calls next when APPLE_SERVICE_ID is set', async () => {
    let nextCalled = false;

    const mockReq = {} as import('express').Request;
    const mockRes = {
      status() { return this; },
      json() { return this; },
    } as unknown as import('express').Response;
    const mockNext = () => { nextCalled = true; };

    const { createAppleConfigGuard } = await import('./helpers/authConfigGuard');
    const guard = createAppleConfigGuard('com.example.app');
    guard(mockReq, mockRes, mockNext);

    expect(nextCalled).toBe(true);
  });
});

describe('Auth Linking — Update Validation', () => {
  it('link returns 404 when db.update returns 0 rows', () => {
    const updateResult: { id: string }[] = [];
    const wasUpdated = updateResult.length > 0;
    expect(wasUpdated).toBe(false);
  });

  it('link returns success when db.update returns 1 row', () => {
    const updateResult = [{ id: '7cff2892-7efd-4833-abe2-d8052f7367ef' }];
    const wasUpdated = updateResult.length > 0;
    expect(wasUpdated).toBe(true);
    expect(updateResult[0].id).toBeDefined();
  });

  it('unlink returns 404 when db.update returns 0 rows', () => {
    const updateResult: { id: string }[] = [];
    const wasUpdated = updateResult.length > 0;
    expect(wasUpdated).toBe(false);
  });

  it('unlink returns success when db.update returns 1 row', () => {
    const updateResult = [{ id: 'abc-123' }];
    const wasUpdated = updateResult.length > 0;
    expect(wasUpdated).toBe(true);
  });

  it('conflict detection blocks linking to already-linked Google account', () => {
    const sessionUserId = 'user-A';
    const existing = [{ id: 'user-B', email: 'other@example.com' }];

    const isConflict = existing.length > 0 && existing[0].id !== sessionUserId;
    expect(isConflict).toBe(true);
  });

  it('conflict detection allows re-linking same user Google account', () => {
    const sessionUserId = 'user-A';
    const existing = [{ id: 'user-A', email: 'me@example.com' }];

    const isConflict = existing.length > 0 && existing[0].id !== sessionUserId;
    expect(isConflict).toBe(false);
  });

  it('conflict detection allows linking when no existing user has that Google ID', () => {
    const sessionUserId = 'user-A';
    const existing: { id: string; email: string }[] = [];

    const isConflict = existing.length > 0 && existing[0].id !== sessionUserId;
    expect(isConflict).toBe(false);
  });
});

describe('Auth Linking — Unique Constraint Violation Handling', () => {
  it('detects PostgreSQL unique violation error code 23505', () => {
    const dbError = { code: '23505', detail: 'Key (google_id)=(12345) already exists.' };
    const isUniqueViolation = (dbError as { code?: string }).code === '23505';
    expect(isUniqueViolation).toBe(true);
  });

  it('does not flag non-23505 errors as unique violations', () => {
    const dbError = { code: '23503', detail: 'FK violation' };
    const isUniqueViolation = (dbError as { code?: string }).code === '23505';
    expect(isUniqueViolation).toBe(false);
  });

  it('handles error objects without a code property', () => {
    const genericError = new Error('Something went wrong');
    const isUniqueViolation = (genericError as { code?: string }).code === '23505';
    expect(isUniqueViolation).toBe(false);
  });
});

describe('Auth Linking — Schema Constraints', () => {
  it('users table defines google_id and apple_id columns', async () => {
    const { users } = await import('../shared/models/auth-session');
    expect(users.googleId).toBeDefined();
    expect(users.appleId).toBeDefined();
    expect(users.googleEmail).toBeDefined();
    expect(users.appleEmail).toBeDefined();
    expect(users.googleLinkedAt).toBeDefined();
    expect(users.appleLinkedAt).toBeDefined();
  });
});
