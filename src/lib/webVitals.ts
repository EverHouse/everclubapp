import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

const isDev = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.endsWith('.replit.dev')
);

function logMetric(metric: Metric) {
  const label = `[Web Vitals] ${metric.name}`;
  const value = metric.name === 'CLS' ? metric.value.toFixed(4) : `${Math.round(metric.value)}ms`;
  const rating = metric.rating;
  const color = rating === 'good' ? '#0cce6b' : rating === 'needs-improvement' ? '#ffa400' : '#ff4e42';

  if (isDev) {
    console.log(
      `%c${label}: ${value} (${rating})`,
      `color: ${color}; font-weight: bold;`
    );
  }
}

function sendMetric(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
  });

  const blob = new Blob([body], { type: 'application/json' });

  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/web-vitals', blob);
  }
}

export function initWebVitals() {
  const handler = isDev
    ? logMetric
    : (metric: Metric) => {
        logMetric(metric);
        sendMetric(metric);
      };

  onCLS(handler);
  onFCP(handler);
  onINP(handler);
  onLCP(handler);
  onTTFB(handler);
}
