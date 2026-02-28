import { db } from '../db';
import { sql } from 'drizzle-orm';

interface JobQueueStatsRow {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface FailedJobRow {
  id: number;
  job_type: string;
  last_error: string | null;
  created_at: Date | string;
  retry_count: number;
  max_retries: number;
}

interface CompletedJobRow {
  id: number;
  job_type: string;
  processed_at: Date | string;
}

interface OldestPendingRow {
  oldest: Date | string | null;
}

interface JobQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface FailedJob {
  id: number;
  jobType: string;
  lastError: string | null;
  createdAt: string;
  retryCount: number;
  maxRetries: number;
}

interface JobQueueMonitorData {
  stats: JobQueueStats;
  recentFailed: FailedJob[];
  recentCompleted: { id: number; jobType: string; processedAt: string }[];
  oldestPending: string | null;
}

export async function getJobQueueMonitorData(): Promise<JobQueueMonitorData> {
  const statsResult = await db.execute(sql`
    SELECT 
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int as pending,
      COALESCE(SUM(CASE WHEN status = 'pending' AND locked_at IS NOT NULL THEN 1 ELSE 0 END), 0)::int as processing,
      COALESCE(SUM(CASE WHEN status = 'completed' AND processed_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::int as completed,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)::int as failed
    FROM job_queue
  `);

  const statsRow = statsResult.rows[0] as unknown as JobQueueStatsRow;
  const stats: JobQueueStats = {
    pending: Number(statsRow?.pending || 0),
    processing: Number(statsRow?.processing || 0),
    completed: Number(statsRow?.completed || 0),
    failed: Number(statsRow?.failed || 0),
  };

  const failedResult = await db.execute(sql`
    SELECT id, job_type, last_error, created_at, retry_count, max_retries
    FROM job_queue
    WHERE status = 'failed'
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const recentFailed: FailedJob[] = failedResult.rows.map((r) => {
    const row = r as unknown as FailedJobRow;
    return {
      id: Number(row.id),
      jobType: String(row.job_type),
      lastError: String(row.last_error || ''),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
    };
  });

  const completedResult = await db.execute(sql`
    SELECT id, job_type, processed_at
    FROM job_queue
    WHERE status = 'completed' AND processed_at > NOW() - INTERVAL '24 hours'
    ORDER BY processed_at DESC
    LIMIT 10
  `);

  const recentCompleted = completedResult.rows.map((r) => {
    const row = r as unknown as CompletedJobRow;
    return {
      id: Number(row.id),
      jobType: String(row.job_type),
      processedAt: row.processed_at instanceof Date ? row.processed_at.toISOString() : String(row.processed_at),
    };
  });

  const oldestResult = await db.execute(sql`
    SELECT MIN(created_at) as oldest FROM job_queue WHERE status = 'pending'
  `);
  const oldestPending = (oldestResult.rows[0] as unknown as OldestPendingRow)?.oldest ? String((oldestResult.rows[0] as unknown as OldestPendingRow).oldest) : null;

  return { stats, recentFailed, recentCompleted, oldestPending };
}
