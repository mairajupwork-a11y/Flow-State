import { Component, type ReactNode } from 'react';
import { ErrorState } from './ui';

/** Last line of defence: a render error shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot" style={{ padding: 16 }}>
        <ErrorState error={new Error('Something went wrong on this page. Reloading usually fixes it.')} retry={() => location.assign('/')} />
      </div>
    );
  }
}
