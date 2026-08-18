import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportBrowserError } from './browserReporting';

/*
 * The one thing React needs a class for.
 *
 * There was no error boundary anywhere in this project — not one class
 * component in the whole tree — which means any render error anywhere unmounts
 * the entire app and leaves a blank rectangle. On the studio that is a white
 * screen the owner has to reload. On the widget it is a blank space on somebody
 * else's website where the booking form used to be, with nothing to say what
 * happened or what to do.
 *
 * A boundary cannot catch everything: errors in event handlers, in async work,
 * and during the initial mount call outside React all escape it. Those are what
 * window.onerror and unhandledrejection are for, installed alongside.
 */
interface Props {
  children: ReactNode;
  surface: string;
  /** What to show instead. Kept as a prop so each surface can speak its own language. */
  fallback: (retry: () => void) => ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged whether or not reporting is configured. A stack in the console is
    // still how most of these get diagnosed.
    console.error(`Chime ${this.props.surface} failed to render`, error, info.componentStack);
    reportBrowserError(error, { surface: this.props.surface, kind: 'render' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback(() => this.setState({ failed: false }));
  }
}
