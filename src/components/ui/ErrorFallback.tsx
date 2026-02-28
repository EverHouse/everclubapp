import { haptic } from '../../utils/haptics';

interface ErrorFallbackProps {
  variant: 'page' | 'card' | 'inline';
  title?: string;
  description?: string;
  icon?: string;
  onRetry?: () => void;
  retryLabel?: string;
  showSupport?: boolean;
  className?: string;
}

function ErrorFallback({
  variant,
  title,
  description,
  icon,
  onRetry,
  retryLabel,
  showSupport = true,
  className = '',
}: ErrorFallbackProps) {
  const handleRetry = () => {
    haptic.medium();
    onRetry?.();
  };

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/5 dark:bg-red-500/10 border border-red-500/10 dark:border-red-500/15 ${className}`}>
        <span className="material-symbols-outlined text-base text-red-400">
          {icon || 'error_outline'}
        </span>
        <span className="text-xs text-gray-700 dark:text-white/70 flex-1">
          {title || 'Something went wrong'}
        </span>
        {onRetry && (
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            {retryLabel || 'Retry'}
          </button>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`flex items-center justify-center p-6 min-h-[120px] rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.12] ${className}`}>
        <div className="text-center max-w-xs">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-lg text-red-400">
              {icon || 'error_outline'}
            </span>
          </div>
          <h3 className="text-sm font-semibold mb-1 text-gray-800 dark:text-white">
            {title || 'Something went wrong'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-white/60 mb-3">
            {description || 'This section couldn\u2019t load.'}
          </p>
          <div className="flex flex-col gap-2 items-center">
            {onRetry && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-accent/10 dark:bg-accent/20 text-accent hover:bg-accent/20 dark:hover:bg-accent/30 transition-colors"
              >
                <span className="material-symbols-outlined text-sm align-middle mr-1">refresh</span>
                {retryLabel || 'Try Again'}
              </button>
            )}
            {showSupport && (
              <a
                href="sms:9495455855"
                className="text-xs text-gray-500 dark:text-white/50 hover:text-gray-700 dark:hover:text-white/70 transition-colors"
              >
                Contact Support
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center min-h-screen bg-bone dark:bg-[#141414] text-primary dark:text-white p-6 ${className}`}>
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/10 dark:bg-red-500/20 backdrop-blur-xl border border-red-500/10 dark:border-red-500/15 flex items-center justify-center">
          <span className="material-symbols-outlined text-3xl text-red-400">
            {icon || 'error'}
          </span>
        </div>
        <h1 className="text-xl font-semibold mb-2">
          {title || 'Something went wrong'}
        </h1>
        <p className="text-gray-600 dark:text-white/60 mb-6">
          {description || 'The app encountered an unexpected error. Please try again.'}
        </p>
        <div className="flex flex-col gap-3">
          {onRetry && (
            <button
              onClick={handleRetry}
              className="px-6 py-3 bg-accent text-brand-green font-semibold rounded-full hover:opacity-90 transition-opacity"
            >
              {retryLabel || 'Try Again'}
            </button>
          )}
          {showSupport && (
            <a
              href="sms:9495455855"
              className="px-6 py-3 text-gray-500 dark:text-white/60 hover:text-gray-700 dark:hover:text-white transition-colors text-sm"
            >
              Contact Support — (949) 545-5855
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export { ErrorFallback };
export type { ErrorFallbackProps };
