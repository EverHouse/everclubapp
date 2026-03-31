import type { Request, Response } from 'express';

export interface MockSession {
  user: Record<string, unknown> | undefined;
  cookie?: { maxAge: number };
  webauthnChallenge?: string;
  save: (cb: (err: Error | null) => void) => void;
  regenerate: (cb: (err: Error | null) => void) => void;
  destroy: (cb: (err: Error | null) => void) => void;
}

export interface RequestWithSession extends Request {
  session: MockSession & Request['session'];
}

export interface DbError extends Error {
  code?: string;
}

export function createDbError(message: string, code: string): DbError {
  const error = new Error(message) as DbError;
  error.code = code;
  return error;
}

export type MockLogAndRespond = (
  _req: unknown,
  res: Pick<Response, 'status' | 'json'>,
  code: number,
  msg: string
) => void;
