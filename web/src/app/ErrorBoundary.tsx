import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort UI guard. Without it, any render-time exception blanks the whole
 * page to a white screen with the error only in the console — indistinguishable
 * from a crash for a normal player. This catches it and shows a plain,
 * actionable fallback (reload / return home) instead. It deliberately does not
 * report anywhere: no third-party service is configured (see
 * docs/operational-readiness.md for the future Sentry option).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only — the one place developers already look, and safe to keep.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleHome = (): void => {
    // Full navigation clears any corrupt in-memory state along with the hash.
    window.location.assign(`${window.location.pathname}#/`);
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="appErrorFallback" role="alert" aria-live="assertive">
        <div className="appErrorCard">
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error. Your online match is saved on the server and can be resumed after reloading.</p>
          <div className="appErrorActions">
            <button type="button" className="appErrorPrimary" onClick={this.handleReload}>
              Reload
            </button>
            <button type="button" className="appErrorGhost" onClick={this.handleHome}>
              Return home
            </button>
          </div>
        </div>
      </main>
    );
  }
}
