import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

export type ErrorBoundaryProps = {
  /** What failed, for the message: "The chart", "The alarm list". */
  name: string;
  children: ReactNode;
  /** Called once for each error, for example to send it to error tracking. */
  onError?: (error: unknown, info: ErrorInfo) => void;
};

type State = { error: unknown };

/**
 * Keeps an error in one part of the page in that part. Without a boundary,
 * React removes the whole page when a component throws during render. The
 * live data continues in the other parts, and "Try again" renders the part
 * again. Its styles are in ErrorBoundary.css, like DataTable's.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.props.onError) this.props.onError(error, info);
    else console.error(`${this.props.name} failed`, error);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>{this.props.name} cannot be shown because of an error.</p>
        <button type="button" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
