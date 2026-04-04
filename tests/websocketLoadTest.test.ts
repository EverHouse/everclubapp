// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import crypto from 'crypto';

const TEST_SESSION_SECRET = 'test-load-secret-key-for-ws';
const TEST_EMAIL = 'loadtest@example.com';
const TEST_STAFF_EMAIL = 'staff-loadtest@example.com';
const WS_TOKEN_TTL_MS = 60_000;
const MAX_CONNECTIONS_PER_USER = 10;

function createWsAuthToken(email: string, role: string): string {
  const payload = JSON.stringify({
    email: email.toLowerCase(),
    role,
    exp: Date.now() + WS_TOKEN_TTL_MS,
  });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const mockPoolQuery = vi.fn();
vi.mock('../server/core/db', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  },
}));

vi.mock('../server/core/pubsub', () => ({
  getAdapter: () => ({
    publishToRemote: vi.fn(),
    onRemoteMessage: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
  getInstanceId: () => 'test-instance-id',
  initPubSub: vi.fn().mockResolvedValue(undefined),
  shutdownPubSub: vi.fn().mockResolvedValue(undefined),
}));

import { initWebSocketServer, closeWebSocketServer, broadcastToAllMembers } from '../server/core/websocket';

let server: http.Server;
let port: number;
let wss: WebSocketServer | null = null;

function wsUrl(): string {
  return `ws://127.0.0.1:${port}/ws`;
}

function connectWithToken(email: string, role = 'member'): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const ws = new WebSocket(wsUrl());
    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

    ws.on('open', () => {
      const token = createWsAuthToken(email, role);
      ws.send(JSON.stringify({ type: 'auth', wsToken: token }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (msg.type === 'auth_success') {
        clearTimeout(timeout);
        resolve({ ws, messages });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

function connectRaw(): WebSocket {
  return new WebSocket(wsUrl());
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Close timeout')), timeoutMs);
    if (ws.readyState === WebSocket.CLOSED) {
      clearTimeout(timeout);
      resolve({ code: 0, reason: 'already closed' });
      return;
    }
    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason?.toString() || '' });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.NODE_ENV = 'test';
});

afterAll(() => {
  delete process.env.SESSION_SECRET;
});

describe('WebSocket Load Tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });

    server = http.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
    wss = (await initWebSocketServer(server)) as unknown as WebSocketServer;
  });

  afterEach(async () => {
    await closeWebSocketServer();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('Connection Bomb Test', () => {
    it('allows up to 10 connections per user and terminates connections beyond the limit', async () => {
      const connectedSockets: WebSocket[] = [];
      const results: { index: number; status: 'connected' | 'rejected' }[] = [];

      for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i++) {
        const { ws } = await connectWithToken(TEST_EMAIL);
        connectedSockets.push(ws);
        results.push({ index: i, status: 'connected' });
      }

      expect(results.filter(r => r.status === 'connected')).toHaveLength(MAX_CONNECTIONS_PER_USER);

      const overLimitCount = 5;
      const rejectionPromises: Promise<{ index: number; receivedAuthSuccess: boolean; closed: boolean }>[] = [];

      for (let i = 0; i < overLimitCount; i++) {
        const idx = MAX_CONNECTIONS_PER_USER + i;
        rejectionPromises.push(new Promise((resolve) => {
          const ws = connectRaw();
          let receivedAuthSuccess = false;

          ws.on('open', () => {
            const token = createWsAuthToken(TEST_EMAIL, 'member');
            ws.send(JSON.stringify({ type: 'auth', wsToken: token }));
          });

          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'auth_success') {
              receivedAuthSuccess = true;
            }
          });

          const timeout = setTimeout(() => {
            resolve({ index: idx, receivedAuthSuccess, closed: ws.readyState !== WebSocket.OPEN });
          }, 3000);

          ws.on('close', () => {
            clearTimeout(timeout);
            resolve({ index: idx, receivedAuthSuccess, closed: true });
          });

          ws.on('error', () => {
            clearTimeout(timeout);
            resolve({ index: idx, receivedAuthSuccess, closed: true });
          });
        }));
      }

      const rejectedResults = await Promise.all(rejectionPromises);

      expect(rejectedResults).toHaveLength(overLimitCount);
      for (const result of rejectedResults) {
        expect(result.closed).toBe(true);
        expect(result.receivedAuthSuccess).toBe(false);
      }

      for (const ws of connectedSockets) {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }
    }, 30000);

    it('allows connections from different users independently', async () => {
      const user1Sockets: WebSocket[] = [];
      const user2Sockets: WebSocket[] = [];

      for (let i = 0; i < 5; i++) {
        const { ws: ws1 } = await connectWithToken('user1@example.com');
        user1Sockets.push(ws1);
        const { ws: ws2 } = await connectWithToken('user2@example.com');
        user2Sockets.push(ws2);
      }

      expect(user1Sockets).toHaveLength(5);
      expect(user2Sockets).toHaveLength(5);
      expect(user1Sockets.every(ws => ws.readyState === WebSocket.OPEN)).toBe(true);
      expect(user2Sockets.every(ws => ws.readyState === WebSocket.OPEN)).toBe(true);

      for (const ws of [...user1Sockets, ...user2Sockets]) {
        ws.close();
      }
    }, 30000);
  });

  describe('Slow Consumer Backpressure Test', () => {
    it('terminates a connection when server-side bufferedAmount exceeds 50KB', async () => {
      const serverSideWsPromise = new Promise<WebSocket>((resolve) => {
        wss!.once('connection', (serverWs: WebSocket) => {
          resolve(serverWs);
        });
      });

      const { ws: clientWs } = await connectWithToken(TEST_EMAIL);
      const serverWs = await serverSideWsPromise;

      Object.defineProperty(serverWs, 'bufferedAmount', {
        get: () => 60 * 1024,
        configurable: true,
      });

      const closePromise = waitForClose(clientWs, 5000);

      broadcastToAllMembers({
        type: 'announcement_update',
        title: 'Backpressure Test',
        message: 'trigger',
      });

      await sleep(200);

      let terminated = false;
      try {
        await closePromise;
        terminated = true;
      } catch {
        terminated = clientWs.readyState !== WebSocket.OPEN;
      }

      expect(terminated).toBe(true);

      const { logger } = await import('../server/core/logger');
      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const backpressureLog = warnCalls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('buffer exceeded')
      );
      expect(backpressureLog).toBeDefined();
    }, 10000);

    it('allows sends when bufferedAmount is below the 50KB threshold', async () => {
      const serverSideWsPromise = new Promise<WebSocket>((resolve) => {
        wss!.once('connection', (serverWs: WebSocket) => {
          resolve(serverWs);
        });
      });

      const { ws: clientWs, messages } = await connectWithToken('healthy-consumer@example.com');
      await serverSideWsPromise;

      broadcastToAllMembers({
        type: 'test_message',
        title: 'Normal Send',
        message: 'should arrive',
      });

      await sleep(500);

      const received = messages.find(
        (m: unknown) => (m as { type: string }).type === 'test_message'
      );
      expect(received).toBeDefined();
      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
    }, 10000);
  });

  describe('Staff Register Spam Test', () => {
    it('only executes one database query regardless of how many staff_register messages are sent', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [{ role: 'staff' }],
      });

      const { ws } = await connectWithToken(TEST_STAFF_EMAIL, 'member');

      const staffRegisterMsg = JSON.stringify({ type: 'staff_register' });
      const messageCount = 100;

      for (let i = 0; i < messageCount; i++) {
        ws.send(staffRegisterMsg);
      }

      await sleep(2000);

      const staffQueryCalls = mockPoolQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('role') && call[0].includes('users')
      );

      expect(staffQueryCalls.length).toBe(1);

      ws.close();
    }, 10000);

    it('marks hasAttemptedStaffUpgrade so subsequent messages are no-ops', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [],
      });

      const { ws } = await connectWithToken(TEST_STAFF_EMAIL, 'member');

      ws.send(JSON.stringify({ type: 'staff_register' }));
      await sleep(500);

      mockPoolQuery.mockClear();

      for (let i = 0; i < 50; i++) {
        ws.send(JSON.stringify({ type: 'staff_register' }));
      }

      await sleep(1000);

      const staffQueryCalls = mockPoolQuery.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('users')
      );
      expect(staffQueryCalls).toHaveLength(0);

      ws.close();
    }, 10000);
  });
});
