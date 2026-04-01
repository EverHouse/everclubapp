import { Pool } from 'pg';
import crypto from 'crypto';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

export type BroadcastTarget =
  | { type: 'all' }
  | { type: 'staff' }
  | { type: 'user'; email: string }
  | { type: 'user_and_staff'; email: string; excludeUserFromStaff?: boolean };

export interface PubSubMessage {
  instanceId: string;
  target: BroadcastTarget;
  payload: string;
}

export type MessageHandler = (message: PubSubMessage) => void;

export interface PubSubAdapter {
  publishToRemote(message: PubSubMessage): void;
  onRemoteMessage(handler: MessageHandler): void;
  shutdown(): Promise<void>;
}

const instanceId = crypto.randomUUID();

export function getInstanceId(): string {
  return instanceId;
}

export class LocalPubSubAdapter implements PubSubAdapter {
  publishToRemote(_message: PubSubMessage): void {
  }

  onRemoteMessage(_handler: MessageHandler): void {
  }

  async shutdown(): Promise<void> {
  }
}

const PG_CHANNEL = 'ws_broadcast';
const PG_NOTIFY_MAX_PAYLOAD = 7500;

export class PgPubSubAdapter implements PubSubAdapter {
  private handler: MessageHandler | null = null;
  private listenClient: import('pg').PoolClient | null = null;
  private pool: Pool;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownRequested = false;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private connecting = false;

  async connect(): Promise<void> {
    if (this.shutdownRequested || this.connecting || this.connected) return;
    this.connecting = true;

    let client: import('pg').PoolClient | null = null;
    try {
      client = await this.pool.connect();

      client.on('notification', (msg) => {
        if (msg.channel !== PG_CHANNEL || !msg.payload) return;

        try {
          const parsed: PubSubMessage = JSON.parse(msg.payload);
          if (parsed.instanceId === instanceId) return;

          if (this.handler) {
            this.handler(parsed);
          }
        } catch (err) {
          logger.warn('[PubSub] Failed to parse notification payload', {
            extra: { error: getErrorMessage(err) },
          });
        }
      });

      client.on('error', (err) => {
        logger.error('[PubSub] LISTEN client error', {
          extra: { error: getErrorMessage(err) },
        });
        this.handleDisconnect();
      });

      client.on('end', () => {
        logger.warn('[PubSub] LISTEN client connection ended');
        this.handleDisconnect();
      });

      await client.query(`LISTEN ${PG_CHANNEL}`);
      this.listenClient = client;
      this.connected = true;
      this.connecting = false;
      logger.info(`[PubSub] PostgreSQL LISTEN/NOTIFY connected (instance: ${instanceId.slice(0, 8)})`);
    } catch (err) {
      this.connecting = false;
      if (client) {
        try { client.release(true); } catch { }
      }
      logger.error('[PubSub] Failed to establish LISTEN connection', {
        extra: { error: getErrorMessage(err) },
      });
      this.scheduleReconnect();
    }
  }

  private handleDisconnect(): void {
    this.connected = false;
    if (this.listenClient) {
      try {
        this.listenClient.release(true);
      } catch {
      }
      this.listenClient = null;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.shutdownRequested || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shutdownRequested) {
        logger.info('[PubSub] Attempting to reconnect LISTEN client...');
        await this.connect();
      }
    }, 5000);
  }

  publishToRemote(message: PubSubMessage): void {
    const serialized = JSON.stringify(message);
    if (serialized.length > PG_NOTIFY_MAX_PAYLOAD) {
      logger.warn('[PubSub] Message too large for NOTIFY, skipping cross-instance broadcast', {
        extra: { size: serialized.length, limit: PG_NOTIFY_MAX_PAYLOAD },
      });
      return;
    }

    this.pool
      .query(`SELECT pg_notify($1, $2)`, [PG_CHANNEL, serialized])
      .catch((err) => {
        logger.warn('[PubSub] Failed to publish NOTIFY', {
          extra: { error: getErrorMessage(err) },
        });
      });
  }

  onRemoteMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.listenClient) {
      try {
        await this.listenClient.query(`UNLISTEN ${PG_CHANNEL}`);
      } catch {
      }
      try {
        this.listenClient.release(true);
      } catch {
      }
      this.listenClient = null;
    }

    this.connected = false;
    this.handler = null;
    logger.info('[PubSub] Adapter shut down');
  }
}

let activeAdapter: PubSubAdapter | null = null;

export function getAdapter(): PubSubAdapter {
  if (!activeAdapter) {
    activeAdapter = new LocalPubSubAdapter();
  }
  return activeAdapter;
}

export async function initPubSub(pool: Pool): Promise<PubSubAdapter> {
  const mode = process.env.WS_PUBSUB_MODE?.toLowerCase();

  if (mode === 'pg' || mode === 'postgres') {
    const adapter = new PgPubSubAdapter(pool);
    await adapter.connect();
    activeAdapter = adapter;
    logger.info('[PubSub] Initialized in PostgreSQL LISTEN/NOTIFY mode');
  } else {
    activeAdapter = new LocalPubSubAdapter();
    logger.info('[PubSub] Initialized in local mode (single instance)');
  }

  return activeAdapter;
}

export async function shutdownPubSub(): Promise<void> {
  if (activeAdapter) {
    await activeAdapter.shutdown();
    activeAdapter = null;
  }
}
