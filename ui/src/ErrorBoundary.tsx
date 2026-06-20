// Top-level + per-subtree error boundary. React 18/19 unmounts the entire
// root subtree on an uncaught render error, which would blank the whole
// app. Wrapping risky subtrees (drawer, lazy editor) keeps a crash local.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[kanso] ErrorBoundary caught:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="kanso-error-fallback" role="alert">
        <h2 className="kanso-error-fallback-title">Something went wrong</h2>
        <p className="kanso-error-fallback-message">{error.message || String(error)}</p>
        <div className="kanso-error-fallback-actions">
          <button type="button" className="kanso-btn" onClick={this.reset}>
            Dismiss
          </button>
          <button type="button" className="kanso-btn kanso-btn--primary" onClick={this.reload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
