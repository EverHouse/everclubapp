import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() || '';
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module') ||
    (message.includes('failed to fetch') && message.includes('.js'))
  );
}

class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[PageErrorBoundary${this.props.pageName ? ` - ${this.props.pageName}` : ''}] Error:`, error, errorInfo);
    
    if (isChunkLoadError(error)) {
      console.log('[PageErrorBoundary] Detected stale chunk error, reloading page...');
      sessionStorage.setItem('chunk_reload_attempted', Date.now().toString());
      window.location.reload();
    }
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1
    }));
  };

  handleHardReload = () => {
    sessionStorage.setItem('chunk_reload_attempted', Date.now().toString());
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isChunkError = isChunkLoadError(this.state.error);
      const isNetworkError = this.state.error?.message?.toLowerCase().includes('fetch') ||
                              this.state.error?.message?.toLowerCase().includes('network') ||
                              this.state.error?.message?.toLowerCase().includes('load failed');
      const canRetry = this.state.retryCount < 3;

      if (isChunkError) {
        const lastReloadAttempt = sessionStorage.getItem('chunk_reload_attempted');
        const recentlyReloaded = lastReloadAttempt && (Date.now() - parseInt(lastReloadAttempt)) < 30000;
        
        if (recentlyReloaded) {
          return (
            <div className="flex items-center justify-center min-h-[50vh] p-6">
              <div className="text-center max-w-sm">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl text-amber-400">
                    update
                  </span>
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
      }

      return (
        <div className="flex items-center justify-center min-h-[50vh] p-6">
          <div className="text-center max-w-sm">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-red-400">
                {isNetworkError ? 'wifi_off' : 'error'}
              </span>
            </div>
            <h2 className="text-lg font-semibold mb-2 text-primary dark:text-white">
              {isNetworkError ? 'Connection Issue' : 'Unable to load'}
            </h2>
            <p className="text-gray-600 dark:text-white/60 text-sm mb-4">
              {isNetworkError 
                ? 'Please check your connection and try again.'
                : 'Something went wrong loading this section.'}
            </p>
            {canRetry && (
              <button
                onClick={this.handleRetry}
                className="px-5 py-2.5 bg-accent text-brand-green rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryCount}>{this.props.children}</React.Fragment>;
  }
}

export default PageErrorBoundary;
