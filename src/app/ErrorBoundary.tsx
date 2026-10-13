import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Shown in place of the subtree once a render inside it has thrown. */
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * The shell's backstop. React unmounts the whole tree when a render throws and
 * nothing catches it, which on this app means a blank white page with nothing
 * on it to act on - the worst possible outcome of any defect. A corrupt stored
 * date reaching a parser, an unexpected Dexie rejection rethrown by
 * useLiveQuery: each of those is a render-time throw, and each one deserves a
 * sentence the user can act on instead.
 *
 * It must not swallow the error silently: componentDidCatch logs it with the
 * component stack, so a defect that lands here is still diagnosable from the
 * console rather than disappearing behind a friendly panel.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('ErrorBoundary caught a render error', error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
