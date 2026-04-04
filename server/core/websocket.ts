import { WebSocketServer, WebSocket } from 'ws';
import { getErrorMessage } from '../utils/errorUtils';
import { Server, IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import crypto from 'crypto';
import { logger } from './logger';
import { pool as sharedPool } from './db';
import { getAdapter, getInstanceId, initPubSub, shutdownPubSub } from './pubsub';
import type { BroadcastTarget } from './pubsub';

interface ClientConnection {
  ws: WebSocket;
  userEmail: string;
  isAlive: boolean;
  isStaff: boolean;
  sessionId?: string;
  tokenExp?: number;
}

export interface NotificationDeliveryResult {
  success: boolean;
  connectionCount: number;
  sentCount: number;
  hasActiveSocket: boolean;
}

export interface NotificationContext {
  action?: string;
  bookingId?: number;
  eventId?: number;
  classId?: number;
  resourceType?: string;
  triggerSource?: string;
}

export interface BookingEvent {
  eventType: string;
  bookingId: number;
  memberEmail: string;
  memberName?: string;
  resourceId?: number;
  resourceName?: string;
  resourceType?: string;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  playerCount?: number;
  status: string;
  actionBy?: 'member' | 'staff';
  timestamp: string;
}

const clients: Map<string, ClientConnection[]> = new Map();
const staffEmails: Set<string> = new Set();

let wss: WebSocketServer | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
let sessionRevalidationIntervalId: ReturnType<typeof setInterval> | null = null;

function getSessionPool() {
  return sharedPool;
}

function parseSessionId(cookieHeader: string | undefined, sessionSecret: string): string | null {
  if (!cookieHeader) return null;
  
  try {
    const cookies = parseCookie(cookieHeader);
    const cookieName = process.env.SESSION_COOKIE_NAME || 'connect.sid';
    const signedCookie = cookies[cookieName];
    
    if (!signedCookie) return null;
    
    if (signedCookie.startsWith('s:')) {
      const raw = signedCookie.slice(2);
      const result = unsign(raw, sessionSecret);
      if (result === false) {
        logger.warn('[WebSocket] Cookie signature verification failed — possible tampering');
        return null;
      }
      return result;
    }
    
    return signedCookie;
  } catch (err: unknown) {
    logger.error('[WebSocket] Error parsing session cookie:', { extra: { error: getErrorMessage(err) } });
    return null;
  }
}

interface SessionData {
  user?: {
    email: string;
    role: string;
    tier?: string;
    tierId?: number;
    firstName?: string;
    lastName?: string;
    isTestUser?: boolean;
  };
}

async function verifySessionFromDatabase(sessionId: string, retries = 3): Promise<SessionData | null> {
  const sessionPool = getSessionPool();
  if (!sessionPool) return null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    let client: import('pg').PoolClient | null = null;
    try {
      client = await sessionPool.connect();
      await client.query('SET statement_timeout = 10000');
      const result = await client.query(
        'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
        [sessionId]
      );
      client.release();
      client = null;
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const sessionData = result.rows[0].sess as SessionData;
      return sessionData;
    } catch (err: unknown) {
      if (client) {
        try { client.release(true); } catch (releaseErr: unknown) {
          logger.debug('[WebSocket] Error releasing client during session verify', { extra: { error: getErrorMessage(releaseErr) } });
        }
        client = null;
      }
      const msg = getErrorMessage(err);
      const isTransient = msg.includes('timeout') || msg.includes('Connection terminated') || msg.includes('ECONNRESET') || msg.includes('statement timeout') || msg.includes('Cannot use a pool');
      if (isTransient && attempt < retries) {
        const baseMs = 500 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 200);
        const backoffMs = baseMs + jitter;
        logger.warn(`[WebSocket] Session verify retry ${attempt}/${retries} (backoff ${backoffMs}ms): ${msg}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      logger.error('[WebSocket] Error verifying session:', { extra: { error: msg, attempt } });
      return null;
    }
  }
  return null;
}

async function getVerifiedUserFromRequest(req: IncomingMessage): Promise<{
  email: string;
  role: string;
  isStaff: boolean;
  sessionId: string;
} | null> {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
    if (isProduction) {
      logger.error('[WebSocket] SESSION_SECRET not configured in production - rejecting connection');
      return null;
    }
    logger.warn('[WebSocket] SESSION_SECRET not configured - session verification disabled (dev only)');
    return null;
  }
  
  const sessionId = parseSessionId(req.headers.cookie, sessionSecret);
  if (!sessionId) {
    return null;
  }
  
  const sessionData = await verifySessionFromDatabase(sessionId);
  if (!sessionData?.user?.email) {
    return null;
  }
  
  const user = sessionData.user;
  const isStaff = user.role === 'staff' || user.role === 'admin';
  
  return {
    email: user.email.toLowerCase(),
    role: user.role,
    isStaff,
    sessionId
  };
}

const WS_TOKEN_TTL_MS = 60_000;

export function createWsAuthToken(email: string, role: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not configured');

  const payload = JSON.stringify({
    email: email.toLowerCase(),
    role,
    exp: Date.now() + WS_TOKEN_TTL_MS,
  });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyWsAuthToken(token: string): { email: string; role: string; isStaff: boolean; exp: number } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return null;

  const dotIdx = token.indexOf('.');
  if (dotIdx < 1) return null;

  const payloadB64 = token.substring(0, dotIdx);
  const sig = token.substring(dotIdx + 1);

  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.email || !payload.exp || payload.exp < Date.now()) {
      return null;
    }
    const role = payload.role || 'member';
    return {
      email: payload.email.toLowerCase(),
      role,
      isStaff: role === 'staff' || role === 'admin',
      exp: payload.exp,
    };
  } catch { /* intentional: invalid/expired token — return null to reject auth */
    return null;
  }
}

const MAX_AUTH_ATTEMPTS = 3;
const AUTH_TIMEOUT_MS = 10000;

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Allow Replit domains
    if (hostname.endsWith('.replit.app') || 
        hostname.endsWith('.replit.dev') || 
        hostname.endsWith('.repl.co')) {
      return true;
    }
    
    // Allow localhost for development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
    
    // Allow production domains
    if (hostname === 'everclub.app' || 
        hostname.endsWith('.everclub.app')) {
      return true;
    }
    
    // Allow domains from ALLOWED_ORIGINS env var
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
    if (allowedOrigins.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed))) {
      return true;
    }
    
    return false;
  } catch (err) {
    logger.debug('Origin validation failed', { extra: { error: getErrorMessage(err) } });
    return false;
  }
}

export async function closeWebSocketServer(): Promise<void> {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  if (sessionRevalidationIntervalId) {
    clearInterval(sessionRevalidationIntervalId);
    sessionRevalidationIntervalId = null;
  }

  await shutdownPubSub();

  if (wss) {
    clients.forEach((connections, _email) => {
      connections.forEach(conn => {
        try {
          conn.ws.close(1001, 'Server shutting down');
        } catch (closeErr: unknown) {
          logger.debug('[WebSocket] Error closing connection during shutdown', { extra: { error: getErrorMessage(closeErr) } });
        }
      });
    });
    clients.clear();
    staffEmails.clear();
    
    wss.close((err) => {
      if (err) {
        logger.error('[WebSocket] Error closing server:', { extra: { error: getErrorMessage(err) } });
      } else {
        logger.info('[WebSocket] Server closed gracefully');
      }
    });
    wss = null;
  }

}

export async function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
  
  wss.on('error', (error) => {
    logger.error('[WebSocket] Server error:', { extra: { error: getErrorMessage(error) } });
  });

  wss.on('connection', async (ws, req) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      logger.warn('[WebSocket] Connection rejected - invalid origin', { 
        extra: { event: 'websocket.rejected', origin, reason: 'invalid_origin' } 
      });
      ws.close(4003, 'Forbidden origin');
      return;
    }
    
    const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
    if (isProduction && !process.env.SESSION_SECRET) {
      logger.error('[WebSocket] SESSION_SECRET not configured in production - rejecting connection immediately');
      ws.close(4008, 'Server misconfigured');
      return;
    }

    ws.on('error', (error) => {
      logger.error('[WebSocket] Client connection error:', { extra: { error: getErrorMessage(error) } });
    });
    let userEmail: string | null = null;
    let isAuthenticated = false;
    let sessionId: string | undefined;
    let authAttempts = 0;

    const verifiedUser = await getVerifiedUserFromRequest(req);
    
    if (verifiedUser) {
      userEmail = verifiedUser.email;
      isAuthenticated = true;
      sessionId = verifiedUser.sessionId;
      
      const connection: ClientConnection = { 
        ws, 
        userEmail, 
        isAlive: true, 
        isStaff: verifiedUser.isStaff,
        sessionId
      };
      
      const existing = clients.get(userEmail) || [];
      const pruned = existing.filter(c => c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING);
      if (!pruned.some(c => c.ws === ws)) {
        pruned.push(connection);
      }
      clients.set(userEmail, pruned);
      
      if (verifiedUser.isStaff) {
        staffEmails.add(userEmail);
      }
      
      ws.send(JSON.stringify({ 
        type: 'auth_success',
        email: userEmail,
        verified: true
      }));
      
      logger.info(`[WebSocket] Session-verified connection: ${userEmail} (staff: ${verifiedUser.isStaff})`, {
        userEmail,
        extra: { event: 'websocket.authenticated', role: verifiedUser.role, isStaff: verifiedUser.isStaff, method: 'session_cookie' }
      });
    } else {
      const authTimeout = setTimeout(() => {
        if (!isAuthenticated) {
          logger.debug(`[WebSocket] Connection closed - no valid session within timeout`, {
            extra: { event: 'websocket.auth_timeout', reason: 'no_valid_session_within_timeout' }
          });
          ws.close(4010, 'Authentication required');
        }
      }, AUTH_TIMEOUT_MS);
      
      ws.once('close', () => clearTimeout(authTimeout));
    }

    ws.on('message', async (data) => {
      if (!isAuthenticated) {
        const rawSize = Buffer.isBuffer(data) ? data.length : (typeof data === 'string' ? Buffer.byteLength(data) : (ArrayBuffer.isView(data) ? data.byteLength : (Array.isArray(data) ? data.reduce((sum: number, b: Buffer) => sum + b.length, 0) : 0)));
        if (rawSize > 4096) {
          logger.warn('[WebSocket] Oversized message from unauthenticated client — closing', {
            extra: { event: 'websocket.oversized_payload', size: rawSize }
          });
          ws.close(4009, 'Payload too large');
          return;
        }
        try {
          const message = JSON.parse(data.toString());
          
          if (message.type === 'auth') {
            authAttempts++;
            
            if (authAttempts > MAX_AUTH_ATTEMPTS) {
              logger.debug(`[WebSocket] Connection closed - max auth attempts exceeded`, {
                extra: { event: 'websocket.auth_blocked', attempts: authAttempts, reason: 'max_attempts_exceeded' }
              });
              ws.close(4003, 'Too many authentication attempts');
              return;
            }
            
            let verifiedUser: { email: string; role: string; isStaff: boolean; sessionId?: string } | null = null;
            let authMethod = 'session_cookie';

            const fromRequest = await getVerifiedUserFromRequest(req);
            if (fromRequest) {
              verifiedUser = fromRequest;
            }

            if (!verifiedUser && message.wsToken) {
              try {
                const tokenUser = verifyWsAuthToken(message.wsToken);
                if (tokenUser) {
                  verifiedUser = tokenUser;
                  authMethod = 'ws_token';
                  logger.info(`[WebSocket] Token-verified auth for ${tokenUser.email} (no cookie — mobile client)`, {
                    userEmail: tokenUser.email,
                    extra: { event: 'websocket.token_auth', role: tokenUser.role, isStaff: tokenUser.isStaff }
                  });
                }
              } catch (tokenErr) {
                logger.warn('[WebSocket] Token verification threw — treating as auth failure', { extra: { error: getErrorMessage(tokenErr) } });
              }
            }

            if (verifiedUser) {
              userEmail = verifiedUser.email;
              isAuthenticated = true;
              sessionId = verifiedUser.sessionId;
              
              const connection: ClientConnection = { 
                ws, 
                userEmail, 
                isAlive: true, 
                isStaff: verifiedUser.isStaff,
                sessionId,
                tokenExp: 'exp' in verifiedUser ? (verifiedUser as { exp: number }).exp : undefined,
              };
              
              const existing = clients.get(userEmail) || [];
              const pruned = existing.filter(c => c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING);
              if (!pruned.some(c => c.ws === ws)) {
                pruned.push(connection);
              }
              clients.set(userEmail, pruned);
              
              if (verifiedUser.isStaff) {
                staffEmails.add(userEmail);
              }
              
              ws.send(JSON.stringify({ 
                type: 'auth_success',
                email: userEmail,
                verified: true
              }));
              
              logger.info(`[WebSocket] Authenticated: ${userEmail}`, {
                extra: { userEmail, event: 'websocket.authenticated', role: verifiedUser.role, isStaff: verifiedUser.isStaff, method: authMethod, attempts: authAttempts }
              });
            } else {
              const attemptsRemaining = MAX_AUTH_ATTEMPTS - authAttempts;
              const backoffMs = Math.min(5000 * Math.pow(2, authAttempts - 1), 300000);
              ws.send(JSON.stringify({ 
                type: 'auth_error',
                message: 'Invalid or expired session',
                attemptsRemaining,
                shouldReauth: attemptsRemaining <= 0,
                retryAfterMs: backoffMs,
              }));
              
              if (authAttempts <= 1) {
                logger.warn(`[WebSocket] Auth rejected - session verification failed (attempt ${authAttempts}/${MAX_AUTH_ATTEMPTS})`, {
                  extra: { event: 'websocket.auth_failed', clientEmail: message.email, reason: 'session_verification_failed', attempts: authAttempts }
                });
              }
              
              if (authAttempts >= MAX_AUTH_ATTEMPTS) {
                ws.close(4001, 'Session expired - please re-login');
              }
            }
          } else {
            ws.send(JSON.stringify({ 
              type: 'error',
              message: 'Not authenticated'
            }));
          }
        } catch (e: unknown) {
          logger.error('[WebSocket] Error parsing message from unauthenticated client:', { extra: { error: getErrorMessage(e) } });
        }
        return;
      }
      
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'auth') {
          ws.send(JSON.stringify({ 
            type: 'auth_success',
            email: userEmail,
            verified: true
          }));
          return;
        }
        
        if (message.type === 'staff_register' && userEmail && isAuthenticated) {
          const connections = clients.get(userEmail) || [];
          
          let isStaffUser = false;
          const verifiedStaff = await getVerifiedUserFromRequest(req);
          if (verifiedStaff?.isStaff) {
            isStaffUser = true;
          } else {
            const pool = getSessionPool();
            if (pool) {
              const staffCheck = await pool.query(
                `SELECT role FROM users WHERE LOWER(email) = LOWER($1) AND role IN ('staff', 'admin') LIMIT 1`,
                [userEmail]
              );
              if (staffCheck.rows.length > 0) {
                isStaffUser = true;
              }
            }
          }
          if (isStaffUser) {
            connections.forEach(conn => {
              if (conn.ws === ws) {
                conn.isStaff = true;
              }
            });
            staffEmails.add(userEmail);
            logger.info(`[WebSocket] Staff verified and registered: ${userEmail}`);
          } else {
            logger.warn(`[WebSocket] Staff register rejected - user is not staff`, {
              extra: { userEmail, event: 'websocket.staff_register_rejected', reason: 'not_staff_role' }
            });
          }
        }
        
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e: unknown) {
        logger.error('[WebSocket] Error parsing message:', { extra: { error: getErrorMessage(e) } });
      }
    });

    ws.on('close', () => {
      if (userEmail) {
        const connections = clients.get(userEmail) || [];
        const filtered = connections.filter(c => c.ws !== ws);
        if (filtered.length > 0) {
          clients.set(userEmail, filtered);
          if (!filtered.some(c => c.isStaff)) {
            staffEmails.delete(userEmail);
          }
        } else {
          clients.delete(userEmail);
          staffEmails.delete(userEmail);
        }
        logger.info(`[WebSocket] Client disconnected: ${userEmail}`);
      }
    });

    ws.on('ping', (data) => {
      try {
        ws.pong(data);
      } catch (err: unknown) {
        logger.debug('[WebSocket] Failed to send pong response', { extra: { error: getErrorMessage(err) } });
      }
    });

    ws.on('pong', () => {
      if (userEmail) {
        const connections = clients.get(userEmail) || [];
        const conn = connections.find(c => c.ws === ws);
        if (conn) conn.isAlive = true;
      }
    });
  });

  heartbeatIntervalId = setInterval(() => {
    clients.forEach((connections, email) => {
      const alive: ClientConnection[] = [];
      connections.forEach((conn) => {
        if (!conn.isAlive) {
          conn.ws.terminate();
          return;
        }
        conn.isAlive = false;
        conn.ws.ping();
        alive.push(conn);
      });
      if (alive.length === 0) {
        clients.delete(email);
        staffEmails.delete(email);
      } else {
        clients.set(email, alive);
      }
    });
  }, 20000);

  sessionRevalidationIntervalId = setInterval(async () => {
    const pool = getSessionPool();
    if (!pool) return;

    const snapshot = Array.from(clients.entries());
    for (const [email, connections] of snapshot) {
      for (const conn of connections) {
        if (conn.tokenExp && conn.tokenExp < Date.now()) {
          logger.info(`[WebSocket] Token expired for ${email} — terminating connection`);
          conn.ws.terminate();
          const current = clients.get(email);
          if (current) {
            const filtered = current.filter(c => c !== conn);
            if (filtered.length === 0) { clients.delete(email); staffEmails.delete(email); }
            else { clients.set(email, filtered); }
          }
          continue;
        }
        if (!conn.sessionId) {
          continue;
        }
        try {
          const result = await pool.query(
            'SELECT 1 FROM sessions WHERE sid = $1 AND expire > NOW()',
            [conn.sessionId]
          );
          if (result.rows.length === 0) {
            logger.info(`[WebSocket] Session expired/revoked for ${email} — terminating connection`);
            conn.ws.terminate();
            const current = clients.get(email);
            if (current) {
              const filtered = current.filter(c => c !== conn);
              if (filtered.length === 0) { clients.delete(email); staffEmails.delete(email); }
              else { clients.set(email, filtered); }
            }
          } else if (conn.ws.readyState !== WebSocket.OPEN) {
            const current = clients.get(email);
            if (current) {
              const filtered = current.filter(c => c !== conn);
              if (filtered.length === 0) { clients.delete(email); staffEmails.delete(email); }
              else { clients.set(email, filtered); }
            }
          }
        } catch (revalidateErr) {
          logger.debug(`[WebSocket] Session revalidation DB error for ${email} — keeping connection`, { extra: { error: getErrorMessage(revalidateErr) } });
        }
      }
    }
  }, 5 * 60 * 1000);

  wss.on('close', () => {
    if (heartbeatIntervalId) { clearInterval(heartbeatIntervalId); heartbeatIntervalId = null; }
    if (sessionRevalidationIntervalId) { clearInterval(sessionRevalidationIntervalId); sessionRevalidationIntervalId = null; }
  });

  await initPubSub(sharedPool);
  getAdapter().onRemoteMessage((message) => {
    deliverToLocalConnections(message.target, message.payload);
  });

  logger.info('[WebSocket] Server initialized on /ws with session-based authentication');
  return wss;
}

function deliverToLocalConnections(target: BroadcastTarget, payload: string): number {
  let sent = 0;

  switch (target.type) {
    case 'all':
      clients.forEach((connections) => {
        connections.forEach((conn) => {
          if (conn.ws.readyState === WebSocket.OPEN) {
            try {
              conn.ws.send(payload);
              sent++;
            } catch (err: unknown) {
              logger.warn('[WebSocket] Error in local delivery (all)', { extra: { error: getErrorMessage(err) } });
            }
          }
        });
      });
      break;

    case 'staff':
      clients.forEach((connections) => {
        connections.forEach((conn) => {
          if (conn.isStaff && conn.ws.readyState === WebSocket.OPEN) {
            try {
              conn.ws.send(payload);
              sent++;
            } catch (err: unknown) {
              logger.warn('[WebSocket] Error in local delivery (staff)', { extra: { error: getErrorMessage(err) } });
            }
          }
        });
      });
      break;

    case 'user': {
      const userConns = clients.get(target.email.toLowerCase()) || [];
      userConns.forEach((conn) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          try {
            conn.ws.send(payload);
            sent++;
          } catch (err: unknown) {
            logger.warn('[WebSocket] Error in local delivery (user)', { extra: { error: getErrorMessage(err) } });
          }
        }
      });
      break;
    }

    case 'user_and_staff': {
      const emailLower = target.email.toLowerCase();
      const sentSockets = new Set<WebSocket>();
      const memberConns = clients.get(emailLower) || [];
      memberConns.forEach((conn) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          try {
            conn.ws.send(payload);
            sentSockets.add(conn.ws);
            sent++;
          } catch (err: unknown) {
            logger.warn('[WebSocket] Error in local delivery (user_and_staff:user)', { extra: { error: getErrorMessage(err) } });
          }
        }
      });
      clients.forEach((connections) => {
        connections.forEach((conn) => {
          if (conn.isStaff && conn.ws.readyState === WebSocket.OPEN && !sentSockets.has(conn.ws) && (!target.excludeUserFromStaff || conn.userEmail !== emailLower)) {
            try {
              conn.ws.send(payload);
              sentSockets.add(conn.ws);
              sent++;
            } catch (err: unknown) {
              logger.warn('[WebSocket] Error in local delivery (user_and_staff:staff)', { extra: { error: getErrorMessage(err) } });
            }
          }
        });
      });
      break;
    }
  }

  return sent;
}

function publishBroadcast(target: BroadcastTarget, payload: string): void {
  getAdapter().publishToRemote({
    instanceId: getInstanceId(),
    target,
    payload,
  });
}

export function getClientStatus(userEmail: string): { connected: boolean; connectionCount: number; activeCount: number } {
  const email = userEmail.toLowerCase();
  const connections = clients.get(email) || [];
  const activeCount = connections.filter(c => c.ws.readyState === WebSocket.OPEN).length;
  return {
    connected: connections.length > 0,
    connectionCount: connections.length,
    activeCount
  };
}

/**
 * Send a notification to a specific user's WebSocket connections.
 *
 * In distributed mode (WS_PUBSUB_MODE=pg), the notification is also published
 * to other server instances via PostgreSQL NOTIFY. The returned delivery result
 * reflects local-instance delivery only — remote instances deliver asynchronously
 * and their results are not captured in the return value.
 */
export function sendNotificationToUser(
  userEmail: string, 
  notification: {
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
  },
  context?: NotificationContext
): NotificationDeliveryResult {
  const email = userEmail.toLowerCase();
  const connections = clients.get(email) || [];
  const hasActiveSocket = connections.some(c => c.ws.readyState === WebSocket.OPEN);
  
  if (connections.length === 0) {
    logger.info(`[WebSocket] No connection for ${email} - notification not delivered`, {
      extra: {
        userEmail: email, bookingId: context?.bookingId,
        event: 'notification.delivery', status: 'no_connection', notificationType: notification.type,
        action: context?.action, resourceType: context?.resourceType, triggerSource: context?.triggerSource,
        hasActiveSocket: false, connectionCount: 0, sentCount: 0
      }
    });
    
    publishBroadcast({ type: 'user', email }, JSON.stringify({ ...notification }));
    return { success: false, connectionCount: 0, sentCount: 0, hasActiveSocket: false };
  }

  const payload = JSON.stringify({
    ...notification
  });

  const sent = deliverToLocalConnections({ type: 'user', email }, payload);
  publishBroadcast({ type: 'user', email }, payload);

  const result: NotificationDeliveryResult = {
    success: sent > 0,
    connectionCount: connections.length,
    sentCount: sent,
    hasActiveSocket
  };

  if (sent > 0) {
    logger.info(`[WebSocket] Sent notification to ${email} (${sent}/${connections.length} connections)`, {
      userEmail: email,
      bookingId: context?.bookingId,
      extra: {
        event: 'notification.delivery', status: 'success', notificationType: notification.type,
        action: context?.action, resourceType: context?.resourceType, triggerSource: context?.triggerSource,
        hasActiveSocket, connectionCount: connections.length, sentCount: sent
      }
    });
  } else {
    logger.warn(`[WebSocket] No active connections for ${email} - notification not delivered`, {
      extra: {
        userEmail: email, bookingId: context?.bookingId,
        event: 'notification.delivery', status: 'no_active_connections', notificationType: notification.type,
        action: context?.action, hasActiveSocket, connectionCount: connections.length, sentCount: 0
      }
    });
  }

  return result;
}

export function broadcastToAllMembers(notification: {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  const payload = JSON.stringify({
    ...notification
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  logger.info(`[WebSocket] Broadcast notification to ${sent} connections`);
  return sent;
}

export function broadcastToStaff(notification: {
  type: string;
  title?: string;
  message?: string;
  action?: string;
  eventId?: number;
  classId?: number;
  tourId?: number;
  memberEmail?: string;
  data?: unknown;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}) {
  const payload = JSON.stringify({
    ...notification
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast to staff: ${sent} connections`, {
      extra: { type: notification.type }
    });
  } else {
    let totalConnections = 0;
    let staffConnections = 0;
    let openConnections = 0;
    clients.forEach((connections) => {
      connections.forEach(conn => {
        totalConnections++;
        if (conn.isStaff) staffConnections++;
        if (conn.ws.readyState === WebSocket.OPEN) openConnections++;
      });
    });
    logger.debug(`[WebSocket] Broadcast to staff: 0 sent (total=${totalConnections}, staff=${staffConnections}, open=${openConnections})`, {
      extra: { type: notification.type }
    });
  }
  return sent;
}

export function broadcastBookingEvent(event: BookingEvent) {
  const payload = JSON.stringify({
    type: 'booking_event',
    ...event
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast booking event ${event.eventType} to ${sent} staff connections`);
  } else {
    let totalConnections = 0;
    let staffConnectionCount = 0;
    clients.forEach((connections) => {
      connections.forEach(conn => {
        totalConnections++;
        if (conn.isStaff) staffConnectionCount++;
      });
    });
    logger.info(`[WebSocket] No staff connections for booking event ${event.eventType} (total: ${totalConnections}, staff: ${staffConnectionCount}, staffEmails: ${Array.from(staffEmails).join(', ')})`);
  }
  return sent;
}

export function broadcastAnnouncementUpdate(action: 'created' | 'updated' | 'deleted', announcement?: Record<string, unknown>) {
  const payload = JSON.stringify({
    type: 'announcement_update',
    action,
    announcement
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  logger.info(`[WebSocket] Broadcast announcement ${action} to ${sent} connections`);
  return sent;
}

export function broadcastAvailabilityUpdate(data: {
  resourceId?: number;
  resourceType?: string;
  date?: string;
  action: 'booked' | 'cancelled' | 'updated';
}) {
  const payload = JSON.stringify({
    type: 'availability_update',
    ...data
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast availability ${data.action} to ${sent} connections`);
  }
  return sent;
}

export function broadcastWaitlistUpdate(data: {
  classId?: number;
  eventId?: number;
  action: 'spot_opened' | 'enrolled' | 'removed';
  spotsAvailable?: number;
}) {
  const payload = JSON.stringify({
    type: 'waitlist_update',
    ...data
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast waitlist ${data.action} to ${sent} connections`);
  }
  return sent;
}

export function broadcastDirectorySyncUpdate(data: {
  status: 'running' | 'completed' | 'failed';
  jobId?: string;
  progress?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  lastSyncTime?: string | null;
}) {
  const payload = JSON.stringify({
    type: 'directory_sync_update',
    ...data
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast directory sync ${data.status} to ${sent} staff connections`);
  }
  return sent;
}

export function broadcastDirectoryUpdate(action: 'synced' | 'updated' | 'created') {
  const payload = JSON.stringify({
    type: 'directory_update',
    action
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast directory ${action} to ${sent} staff connections`);
  }
  return sent;
}

export function broadcastCafeMenuUpdate(action: 'created' | 'updated' | 'deleted') {
  const payload = JSON.stringify({
    type: 'cafe_menu_update',
    action
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast cafe menu ${action} to ${sent} connections`);
  }
  return sent;
}

export function broadcastClosureUpdate(action: 'created' | 'updated' | 'deleted' | 'synced', closureId?: number) {
  const payload = JSON.stringify({
    type: 'closure_update',
    action,
    closureId
  });

  const target: BroadcastTarget = { type: 'all' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast closure ${action} to ${sent} connections`);
  }
  return sent;
}

export function broadcastMemberDataUpdated(changedEmails: string[] = []) {
  const payload = JSON.stringify({
    type: 'member_data_updated',
    changedEmails
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0 && changedEmails.length > 0) {
    logger.info(`[WebSocket] Broadcast member data updated (${changedEmails.length} members) to ${sent} staff connections`);
  }
  return sent;
}

export function broadcastMemberStatsUpdated(memberEmail: string, data: { guestPasses?: number; lifetimeVisits?: number }) {
  const payload = JSON.stringify({
    type: 'member_stats_updated',
    memberEmail,
    ...data
  });

  const target: BroadcastTarget = { type: 'user_and_staff', email: memberEmail };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast member stats updated for ${memberEmail} to ${sent} connections`);
  }
  return sent;
}

export function broadcastTierUpdate(data: {
  action: 'assigned' | 'updated' | 'removed';
  memberEmail: string;
  tier?: string;
  previousTier?: string | null;
  assignedBy?: string;
}) {
  const payload = JSON.stringify({
    type: 'tier_update',
    ...data
  });

  const memberEmail = data.memberEmail.toLowerCase();
  const target: BroadcastTarget = { type: 'user_and_staff', email: memberEmail };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast tier ${data.action} for ${memberEmail} to ${sent} connections`);
  }
  return sent;
}

export function broadcastDataIntegrityUpdate(action: 'check_complete' | 'issue_resolved' | 'data_changed', details?: { source?: string; affectedChecks?: string[] }) {
  const payload = JSON.stringify({
    type: 'data_integrity_update',
    action,
    ...details
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast data integrity ${action} to ${sent} staff connections`);
  }
  return sent;
}

export function broadcastBillingUpdate(data: {
  action: 'subscription_created' | 'subscription_cancelled' | 'subscription_updated' | 
          'payment_succeeded' | 'payment_failed' | 'invoice_paid' | 'invoice_failed' |
          'booking_payment_updated' | 'payment_refunded' | 'balance_updated' |
          'invoice_created' | 'invoice_finalized' | 'invoice_voided' |
          'payment_confirmed';
  customerId?: string | null;
  memberEmail?: string | null;
  memberName?: string | null;
  amount?: number;
  planName?: string;
  status?: string;
  bookingId?: number;
  sessionId?: number;
  amountCents?: number;
  newBalance?: number;
}) {
  const payload = JSON.stringify({
    type: 'billing_update',
    ...data
  });

  let sent: number;
  if (data.memberEmail) {
    const target: BroadcastTarget = { type: 'user_and_staff', email: data.memberEmail };
    sent = deliverToLocalConnections(target, payload);
    publishBroadcast(target, payload);
  } else {
    const target: BroadcastTarget = { type: 'staff' };
    sent = deliverToLocalConnections(target, payload);
    publishBroadcast(target, payload);
  }

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast billing ${data.action} to ${sent} connections (member: ${data.memberEmail || 'none'})`);
  }
  return sent;
}

export function broadcastDayPassUpdate(data: {
  action: 'day_pass_purchased' | 'day_pass_redeemed' | 'day_pass_refunded';
  passId: string;
  purchaserEmail?: string;
  purchaserName?: string;
  productType?: string;
  remainingUses?: number;
  quantity?: number;
  purchasedAt?: string;
}) {
  const payload = JSON.stringify({
    type: 'day_pass_update',
    ...data
  });

  const target: BroadcastTarget = { type: 'staff' };
  const sent = deliverToLocalConnections(target, payload);
  publishBroadcast(target, payload);

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast day pass ${data.action} to ${sent} staff connections`);
  }
  return sent;
}

const bookingBroadcastTimers = new Map<string, NodeJS.Timeout>();

export function broadcastBookingRosterUpdate(data: {
  bookingId: number;
  sessionId?: number;
  action: 'roster_updated' | 'player_count_changed' | 'participant_added' | 'participant_removed';
  memberEmail?: string;
  resourceType?: string;
  totalFeeCents?: number;
  participantCount?: number;
}) {
  const key = `roster_${data.bookingId}_${data.action}`;
  const existing = bookingBroadcastTimers.get(key);
  if (existing) clearTimeout(existing);

  bookingBroadcastTimers.set(key, setTimeout(() => {
    bookingBroadcastTimers.delete(key);
    const payload = JSON.stringify({
      type: 'booking_roster_update',
      ...data,
      timestamp: new Date().toISOString()
    });

    let sent: number;
    if (data.memberEmail) {
      const target: BroadcastTarget = { type: 'user_and_staff', email: data.memberEmail, excludeUserFromStaff: true };
      sent = deliverToLocalConnections(target, payload);
      publishBroadcast(target, payload);
    } else {
      const target: BroadcastTarget = { type: 'staff' };
      sent = deliverToLocalConnections(target, payload);
      publishBroadcast(target, payload);
    }

    if (sent > 0) {
      logger.info(`[WebSocket] Broadcast booking roster ${data.action} for booking #${data.bookingId} to ${sent} connections`);
    }
  }, 300));
}

export function broadcastBookingInvoiceUpdate(data: {
  bookingId: number;
  sessionId?: number;
  action: 'invoice_created' | 'invoice_updated' | 'invoice_finalized' | 'invoice_paid' | 'invoice_voided' | 'invoice_deleted' | 'payment_confirmed' | 'payment_requires_action' | 'fees_waived' | 'payment_voided' | 'payment_reset' | 'balance_partial_applied';
  memberEmail?: string;
  invoiceId?: string;
  totalCents?: number;
  paidInFull?: boolean;
  status?: string;
}) {
  const payload = JSON.stringify({
    type: 'booking_invoice_update',
    ...data,
    timestamp: new Date().toISOString()
  });

  let sent: number;
  if (data.memberEmail) {
    const target: BroadcastTarget = { type: 'user_and_staff', email: data.memberEmail, excludeUserFromStaff: true };
    sent = deliverToLocalConnections(target, payload);
    publishBroadcast(target, payload);
  } else {
    const target: BroadcastTarget = { type: 'staff' };
    sent = deliverToLocalConnections(target, payload);
    publishBroadcast(target, payload);
  }

  if (sent > 0) {
    logger.info(`[WebSocket] Broadcast booking invoice ${data.action} for booking #${data.bookingId} to ${sent} connections`);
  }
  return sent;
}

export function getConnectedUsers(): string[] {
  return Array.from(clients.keys());
}

export function getConnectedStaff(): string[] {
  return Array.from(staffEmails);
}

export function isUserConnected(email: string): boolean {
  const connections = clients.get(email.toLowerCase());
  return !!connections && connections.some(c => c.ws.readyState === WebSocket.OPEN);
}
