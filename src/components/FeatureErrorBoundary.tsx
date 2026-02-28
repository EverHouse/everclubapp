import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ui/ErrorFallback';

interface Props {
  children: ReactNode;
  featureName: string;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showRetry?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

class FeatureErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[FeatureErrorBoundary - ${this.props.featureName}] Error:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const showRetry = this.props.showRetry !== false;

      return (
        <ErrorFallback
          variant="card"
          title={`${this.props.featureName} unavailable`}
          description="Something went wrong loading this section."
          onRetry={showRetry ? this.handleRetry : undefined}
          showSupport={this.state.retryCount >= 1}
        />
      );
    }

    return this.props.children;
  }
}

export default FeatureErrorBoundary;
