import { Pool, PoolClient, QueryResult } from 'pg';

export const isProduction = process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
});

pool.on('error', (err) => {
  console.error('[Database] Pool error:', err.message);
});

pool.on('connect', () => {
  console.log('[Database] New client connected');
});

const RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'connection terminated unexpectedly',
  'Connection terminated unexpectedly',
  'timeout expired',
  'sorry, too many clients already',
];

function isRetryableError(error: any): boolean {
  if (!error) return false;
  const message = error.message || '';
  const code = error.code || '';
  return RETRYABLE_ERRORS.some(e => message.includes(e) || code === e);
}

export function isConstraintError(error: any): { type: 'unique' | 'foreign_key' | null, detail?: string } {
  if (error?.code === '23505') return { type: 'unique', detail: error.detail };
  if (error?.code === '23503') return { type: 'foreign_key', detail: error.detail };
  return { type: null };
}

export async function queryWithRetry<T = any>(
  queryText: string,
  params?: any[],
  maxRetries: number = 3
): Promise<QueryResult<T>> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pool.query(queryText, params);
    } catch (error: any) {
      lastError = error;
      
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }
      
      const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
      if (!isProduction) {
        console.log(`[Database] Retrying query (attempt ${attempt}/${maxRetries}) after ${delay}ms...`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

export function getPoolStatus() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  };
}
