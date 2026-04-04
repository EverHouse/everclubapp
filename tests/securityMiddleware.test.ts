// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { securityMiddleware, getCspPlaceholder } from '../server/middleware/security';

function createMockReqRes(path = '/', method = 'GET') {
  const req = {
    path,
    method,
    headers: {} as Record<string, string | string[] | undefined>,
  } as any;

  const headers = new Map<string, string>();
  const sentBodies: unknown[] = [];
  const endedChunks: unknown[] = [];

  const res = {
    locals: {} as Record<string, unknown>,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    getHeader: vi.fn((name: string) => headers.get(name.toLowerCase())),
    removeHeader: vi.fn((name: string) => {
      headers.delete(name.toLowerCase());
    }),
    send: vi.fn(function (this: any, body?: unknown) {
      sentBodies.push(body);
      return this;
    }),
    end: vi.fn(function (this: any, chunk?: unknown, ...args: unknown[]) {
      endedChunks.push(chunk);
      return this;
    }),
    _headers: headers,
    _sentBodies: sentBodies,
    _endedChunks: endedChunks,
  } as any;

  const next = vi.fn();

  return { req, res, next };
}

describe('CSP nonce injection regression', () => {
  it('replaces CSP placeholder with a unique nonce in HTML responses via res.send', () => {
    const { req, res, next } = createMockReqRes('/app', 'GET');

    securityMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();

    const nonce = res.locals.cspNonce as string;
    expect(nonce).toBeDefined();
    expect(nonce.length).toBeGreaterThan(0);

    const placeholder = getCspPlaceholder();
    const html = `<!DOCTYPE html><html><head><script nonce="${placeholder}">alert(1)</script></head></html>`;

    res._headers.set('content-type', 'text/html; charset=utf-8');
    res.getHeader.mockImplementation((name: string) => res._headers.get(name.toLowerCase()));

    res.send(html);

    const sentBody = res._sentBodies[0] as string;
    expect(sentBody).not.toContain(placeholder);
    expect(sentBody).toContain(`nonce="${nonce}"`);
  });

  it('removes Content-Length header after nonce injection via res.send', () => {
    const { req, res, next } = createMockReqRes('/app', 'GET');

    securityMiddleware(req, res, next);

    const placeholder = getCspPlaceholder();
    const html = `<!DOCTYPE html><html><head><script nonce="${placeholder}">x</script></head></html>`;

    res._headers.set('content-type', 'text/html; charset=utf-8');
    res._headers.set('content-length', String(html.length));
    res.getHeader.mockImplementation((name: string) => res._headers.get(name.toLowerCase()));

    res.send(html);

    expect(res.removeHeader).toHaveBeenCalledWith('Content-Length');
  });

  it('generates a unique nonce per response', () => {
    const nonces: string[] = [];

    for (let i = 0; i < 5; i++) {
      const { req, res, next } = createMockReqRes('/page', 'GET');
      securityMiddleware(req, res, next);
      nonces.push(res.locals.cspNonce as string);
    }

    const uniqueNonces = new Set(nonces);
    expect(uniqueNonces.size).toBe(5);
  });

  it('does not inject nonce for non-HTML responses', () => {
    const { req, res, next } = createMockReqRes('/api/data', 'GET');

    securityMiddleware(req, res, next);

    const jsonBody = '{"key": "value"}';

    res._headers.set('content-type', 'application/json');
    res.getHeader.mockImplementation((name: string) => res._headers.get(name.toLowerCase()));

    res.send(jsonBody);

    const sentBody = res._sentBodies[0] as string;
    expect(sentBody).toBe(jsonBody);
    expect(res.removeHeader).not.toHaveBeenCalledWith('Content-Length');
  });

  it('replaces placeholder in res.end with Buffer input', () => {
    const { req, res, next } = createMockReqRes('/page', 'GET');

    securityMiddleware(req, res, next);

    const nonce = res.locals.cspNonce as string;
    const placeholder = getCspPlaceholder();
    const html = `<!DOCTYPE html><html><head><style nonce="${placeholder}">body{}</style></head></html>`;

    res._headers.set('content-type', 'text/html');
    res.getHeader.mockImplementation((name: string) => res._headers.get(name.toLowerCase()));

    const buf = Buffer.from(html, 'utf8');
    res.end(buf);

    const sentChunk = res._endedChunks[0];
    expect(Buffer.isBuffer(sentChunk)).toBe(true);
    const result = (sentChunk as Buffer).toString('utf8');
    expect(result).toContain(`nonce="${nonce}"`);
    expect(result).not.toContain(placeholder);
  });

  it('does not set nonce for static assets', () => {
    const { req, res, next } = createMockReqRes('/assets/bundle-abc123.js', 'GET');

    securityMiddleware(req, res, next);

    expect(res.locals.cspNonce).toBeUndefined();
  });
});
