import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ui/ErrorFallback';
import Icon from './icons/Icon';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  manualRetryCount: number;
  autoRetryCount: number;
  countdown: number | null;
  chunkRetryCountdown: number | null;
}

const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_DELAYS = [3, 5];

const RELOAD_COUNT_KEY = 'error_reload_count';
const RELOAD_TIMESTAMP_KEY = 'error_reload_timestamp';
const MAX_AUTO_RELOADS = 3;
const RELOAD_WINDOW_MS = 300000;

function safeSessionStorage(op: () => void): void {
  try { op(); } catch { /* storage unavailable */ }
}

function getReloadCount(): number {
  try {
    const timestamp = sessionStorage.getItem(RELOAD_TIMESTAMP_KEY);
    const count = sessionStorage.getItem(RELOAD_COUNT_KEY);
    
    if (!timestamp || !count) return 0;
    
    const elapsed = Date.now() - parseInt(timestamp, 10);
    if (elapsed > RELOAD_WINDOW_MS) {
      sessionStorage.removeItem(RELOAD_COUNT_KEY);
      sessionStorage.removeItem(RELOAD_TIMESTAMP_KEY);
      return 0;
    }
    
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

function incrementReloadCount(): number {
  const currentCount = getReloadCount();
  const newCount = currentCount + 1;
  safeSessionStorage(() => {
    sessionStorage.setItem(RELOAD_COUNT_KEY, newCount.toString());
    sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, Date.now().toString());
  });
  return newCount;
}

function clearReloadCount(): void {
  safeSessionStorage(() => {
    sessionStorage.removeItem(RELOAD_COUNT_KEY);
    sessionStorage.removeItem(RELOAD_TIMESTAMP_KEY);
  });
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('importing a module script failed') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module') ||
    message.includes('is not a valid javascript mime type') ||
    message.includes('unable to preload') ||
    (message.includes('failed to fetch') && message.includes('.js'))
  );
}

class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryCount: 0, manualRetryCount: 0, autoRetryCount: 0, countdown: null, chunkRetryCountdown: null };

  private retryTimerRef: ReturnType<typeof setTimeout> | null = null;
  private countdownTimerRef: ReturnType<typeof setInterval> | null = null;
  private chunkRetryTimerRef: ReturnType<typeof setTimeout> | null = null;
  private chunkCountdownRef: ReturnType<typeof setInterval> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PageErrorBoundary${this.props.pageName ? ` - ${this.props.pageName}` : ''}] Error:`, error, errorInfo);
    console.error(`[PageErrorBoundary] Error message: ${error?.message || 'no message'}`, `Stack: ${error?.stack?.substring(0, 500) || 'no stack'}`);
    
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          page: this.props.pageName || 'unknown',
          error: error.message,
          stack: error.stack?.substring(0, 2000),
          componentStack: errorInfo.componentStack?.substring(0, 2000)
        })
      }).catch((err: unknown) => console.warn('[PageErrorBoundary] Failed to report client error:', err));
    } catch (err: unknown) {
      console.warn('[PageErrorBoundary] Failed to send error report:', err);
    }
    
    if (isChunkLoadError(error)) {
      const reloadCount = getReloadCount();
      
      if (reloadCount < MAX_AUTO_RELOADS) {
        const delayMs = reloadCount === 0 ? 1000 : reloadCount === 1 ? 3000 : 5000;
        // eslint-disable-next-line no-console
        console.log(`[PageErrorBoundary] Detected stale chunk error, clearing caches and reloading in ${delayMs}ms (${reloadCount + 1}/${MAX_AUTO_RELOADS})...`);
        incrementReloadCount();
        this.clearCachesAndReload(delayMs);
        return;
      } else {
        // eslint-disable-next-line no-console
        console.log('[PageErrorBoundary] Max auto-reloads reached, showing error UI — will auto-retry in 15s');
        this.scheduleChunkRetry();
      }
    }

    if (this.state.autoRetryCount < MAX_AUTO_RETRIES && !isChunkLoadError(error)) {
      this.startAutoRetryCountdown();
    }
  }

  componentWillUnmount() {
    this.clearTimers();
  }

  private clearTimers() {
    if (this.retryTimerRef) {
      clearTimeout(this.retryTimerRef);
      this.retryTimerRef = null;
    }
    if (this.countdownTimerRef) {
      clearInterval(this.countdownTimerRef);
      this.countdownTimerRef = null;
    }
    if (this.chunkRetryTimerRef) {
      clearTimeout(this.chunkRetryTimerRef);
      this.chunkRetryTimerRef = null;
    }
    if (this.chunkCountdownRef) {
      clearInterval(this.chunkCountdownRef);
      this.chunkCountdownRef = null;
    }
  }

  private scheduleChunkRetry() {
    if (this.chunkRetryTimerRef) {
      clearTimeout(this.chunkRetryTimerRef);
      this.chunkRetryTimerRef = null;
    }
    if (this.chunkCountdownRef) {
      clearInterval(this.chunkCountdownRef);
      this.chunkCountdownRef = null;
    }
    const CHUNK_RETRY_DELAY = 15;
    this.setState({ chunkRetryCountdown: CHUNK_RETRY_DELAY });

    this.chunkCountdownRef = setInterval(() => {
      this.setState(prev => {
        const next = (prev.chunkRetryCountdown ?? 1) - 1;
        if (next <= 0) return { chunkRetryCountdown: null };
        return { chunkRetryCountdown: next };
      });
    }, 1000);

    this.chunkRetryTimerRef = setTimeout(() => {
      if (this.chunkCountdownRef) {
        clearInterval(this.chunkCountdownRef);
        this.chunkCountdownRef = null;
      }
      clearReloadCount();
      this.clearCachesAndReload(2000);
    }, CHUNK_RETRY_DELAY * 1000);
  }

  private startAutoRetryCountdown() {
    this.clearTimers();

    const delaySeconds = AUTO_RETRY_DELAYS[this.state.autoRetryCount] ?? 5;
    // eslint-disable-next-line no-console
    console.log(`[PageErrorBoundary${this.props.pageName ? ` - ${this.props.pageName}` : ''}] Auto-retry ${this.state.autoRetryCount + 1}/${MAX_AUTO_RETRIES} in ${delaySeconds}s...`);

    this.setState({ countdown: delaySeconds });

    this.countdownTimerRef = setInterval(() => {
      this.setState(prev => {
        const next = (prev.countdown ?? 1) - 1;
        if (next <= 0) {
          return { countdown: null };
        }
        return { countdown: next };
      });
    }, 1000);

    this.retryTimerRef = setTimeout(() => {
      this.clearTimers();
      this.setState(prev => ({
        hasError: false,
        error: null,
        countdown: null,
        autoRetryCount: prev.autoRetryCount + 1,
        retryCount: prev.retryCount + 1
      }));
    }, delaySeconds * 1000);
  }

  handleRetry = () => {
    this.clearTimers();
    if (this.state.manualRetryCount >= 1) {
      this.clearCachesAndReload();
      return;
    }
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
      manualRetryCount: prev.manualRetryCount + 1,
      autoRetryCount: 0,
      countdown: null
    }));
  };

  private cacheBustReload() {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now().toString());
    window.location.replace(url.toString());
  }

  handleHardReload = () => {
    clearReloadCount();
    this.cacheBustReload();
  };

  private clearCachesAndReload(delayMs = 0) {
    const doClear = async () => {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
        }
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        }
      } catch (err: unknown) {
        console.error('[PageErrorBoundary] Failed to clear caches:', err);
      }
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      this.cacheBustReload();
    };
    doClear();
  }

  handleClearCacheAndReload = () => {
    clearReloadCount();
    this.clearCachesAndReload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isChunkError = isChunkLoadError(this.state.error);
      const errorMessage = this.state.error?.message?.toLowerCase() || '';
      const isNetworkError = errorMessage.includes('fetch') ||
                              errorMessage.includes('network') ||
                              errorMessage.includes('load failed');
      const reloadCount = getReloadCount();
      const hitReloadLimit = reloadCount >= MAX_AUTO_RELOADS;
      const isAutoRetrying = this.state.countdown !== null && this.state.autoRetryCount < MAX_AUTO_RETRIES;

      if (isAutoRetrying && !isChunkError) {
        return (
          <div className="flex items-center justify-center min-h-[50vh] p-6">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-400 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-2 text-primary dark:text-white">
                {isNetworkError ? 'Reconnecting...' : 'Retrying...'}
              </h2>
              <p className="text-gray-600 dark:text-white/60 text-sm mb-4">
                Retrying in {this.state.countdown}s... (attempt {this.state.autoRetryCount + 1}/{MAX_AUTO_RETRIES})
              </p>
              <button
                onClick={this.handleRetry}
                className="px-5 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white/80 rounded-xl font-medium text-sm hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
              >
                Retry Now
              </button>
            </div>
          </div>
        );
      }

      if (isChunkError && hitReloadLimit) {
        return (
          <div className="flex items-center justify-center min-h-[50vh] p-6">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Icon name="update" className="text-2xl text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold mb-2 text-primary dark:text-white">
                App Update Required
              </h2>
              <p className="text-gray-600 dark:text-white/60 text-sm mb-4">
                A new version is available but couldn't load automatically.
                {this.state.chunkRetryCountdown != null
                  ? ` Retrying automatically in ${this.state.chunkRetryCountdown}s...`
                  : ' Try clearing the cache or contact support if the issue persists.'}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={this.handleClearCacheAndReload}
                  className="px-5 py-2.5 bg-accent text-brand-green rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
                >
                  Clear Cache & Refresh
                </button>
                <a
                  href="sms:9495455855"
                  className="px-5 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-white/80 rounded-xl font-medium text-sm hover:bg-gray-200 dark:hover:bg-white/20 transition-colors text-center"
                >
                  Contact Support
                </a>
              </div>
            </div>
          </div>
        );
      }

      if (isChunkError && !hitReloadLimit) {
        return (
          <div className="flex items-center justify-center min-h-[50vh] p-6">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Icon name="update" className="text-2xl text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold mb-2 text-primary dark:text-white">
                App Updated
              </h2>
              <p className="text-gray-600 dark:text-white/60 text-sm mb-4">
                A new version is available. Please refresh to continue.
              </p>
              <button
                onClick={this.handleHardReload}
                className="px-5 py-2.5 bg-accent text-brand-green rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
              >
                Refresh Now
              </button>
            </div>
          </div>
        );
      }

      return (
        <ErrorFallback
          variant="page"
          icon={isNetworkError ? 'wifi_off' : 'error'}
          title={isNetworkError ? 'Connection Issue' : 'Unable to load'}
          description={
            isNetworkError
              ? 'Please check your connection and try again.'
              : 'Something went wrong loading this section.'
          }
          onRetry={this.handleRetry}
          retryLabel={this.state.manualRetryCount >= 1 ? 'Clear Cache & Refresh' : 'Try Again'}
          showSupport
        />
      );
    }

    return <React.Fragment key={this.state.retryCount}>{this.props.children}</React.Fragment>;
  }
}

export default PageErrorBoundary;
