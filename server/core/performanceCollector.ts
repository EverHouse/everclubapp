const PERF_ENABLED = process.env.PERF_INSTRUMENTATION_ENABLED !== 'false';

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

const API_SLOW_THRESHOLD_MS = clampInt(process.env.PERF_API_SLOW_MS, 500, 1, 60000);
const QUERY_SLOW_THRESHOLD_MS = clampInt(process.env.PERF_QUERY_SLOW_MS, 200, 1, 60000);
const RING_BUFFER_SIZE = clampInt(process.env.PERF_BUFFER_SIZE, 1000, 10, 50000);

export interface EndpointTiming {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  timestamp: number;
}

export interface QueryTiming {
  queryPattern: string;
  durationMs: number;
  timestamp: number;
}

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

const endpointBuffer = new RingBuffer<EndpointTiming>(RING_BUFFER_SIZE);
const queryBuffer = new RingBuffer<QueryTiming>(RING_BUFFER_SIZE);

export function isPerformanceEnabled(): boolean {
  return PERF_ENABLED;
}

export function getApiSlowThreshold(): number {
  return API_SLOW_THRESHOLD_MS;
}

export function getQuerySlowThreshold(): number {
  return QUERY_SLOW_THRESHOLD_MS;
}

export function recordEndpoint(timing: EndpointTiming): void {
  if (!PERF_ENABLED) return;
  endpointBuffer.push(timing);
}

export function recordQuery(timing: QueryTiming): void {
  if (!PERF_ENABLED) return;
  queryBuffer.push(timing);
}

function normalizeRoute(path: string): string {
  return path
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid');
}

export interface AggregatedEndpoint {
  route: string;
  method: string;
  count: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

export interface AggregatedQuery {
  pattern: string;
  count: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function getTopSlowEndpoints(limit = 10, sinceMs?: number): AggregatedEndpoint[] {
  const cutoff = sinceMs ?? Date.now() - 3600_000;
  const entries = endpointBuffer.getAll().filter(e => e.timestamp >= cutoff);

  const grouped = new Map<string, EndpointTiming[]>();
  for (const entry of entries) {
    const key = `${entry.method} ${normalizeRoute(entry.path)}`;
    const arr = grouped.get(key) || [];
    arr.push(entry);
    grouped.set(key, arr);
  }

  const aggregated: AggregatedEndpoint[] = [];
  for (const [key, timings] of grouped) {
    const [method, ...routeParts] = key.split(' ');
    const route = routeParts.join(' ');
    const durations = timings.map(t => t.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((a, b) => a + b, 0);
    aggregated.push({
      route,
      method,
      count: durations.length,
      avgMs: Math.round(total / durations.length),
      maxMs: durations[durations.length - 1],
      p95Ms: percentile(durations, 95),
    });
  }

  return aggregated.sort((a, b) => b.p95Ms - a.p95Ms).slice(0, limit);
}

export function getTopSlowQueries(limit = 10, sinceMs?: number): AggregatedQuery[] {
  const cutoff = sinceMs ?? Date.now() - 3600_000;
  const entries = queryBuffer.getAll().filter(e => e.timestamp >= cutoff);

  const grouped = new Map<string, QueryTiming[]>();
  for (const entry of entries) {
    const arr = grouped.get(entry.queryPattern) || [];
    arr.push(entry);
    grouped.set(entry.queryPattern, arr);
  }

  const aggregated: AggregatedQuery[] = [];
  for (const [pattern, timings] of grouped) {
    const durations = timings.map(t => t.durationMs).sort((a, b) => a - b);
    const total = durations.reduce((a, b) => a + b, 0);
    aggregated.push({
      pattern,
      count: durations.length,
      avgMs: Math.round(total / durations.length),
      maxMs: durations[durations.length - 1],
      p95Ms: percentile(durations, 95),
    });
  }

  return aggregated.sort((a, b) => b.p95Ms - a.p95Ms).slice(0, limit);
}

export function getPerformanceSummary(sinceMs?: number) {
  const cutoff = sinceMs ?? Date.now() - 3600_000;
  const endpoints = endpointBuffer.getAll().filter(e => e.timestamp >= cutoff);
  const queries = queryBuffer.getAll().filter(e => e.timestamp >= cutoff);

  return {
    enabled: PERF_ENABLED,
    config: {
      apiSlowThresholdMs: API_SLOW_THRESHOLD_MS,
      querySlowThresholdMs: QUERY_SLOW_THRESHOLD_MS,
      bufferSize: RING_BUFFER_SIZE,
    },
    endpoints: {
      totalRecorded: endpoints.length,
      slowCount: endpoints.filter(e => e.durationMs >= API_SLOW_THRESHOLD_MS).length,
    },
    queries: {
      totalRecorded: queries.length,
      slowCount: queries.filter(q => q.durationMs >= QUERY_SLOW_THRESHOLD_MS).length,
    },
    topSlowEndpoints: getTopSlowEndpoints(10, cutoff),
    topSlowQueries: getTopSlowQueries(10, cutoff),
  };
}

export function clearPerformanceData(): void {
  endpointBuffer.clear();
  queryBuffer.clear();
}
