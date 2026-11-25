import { Component, type ReactNode } from "react";
import { EmptyState, Button } from "./ui";

/** Contains a render error to one area (a page or the details panel) instead of blanking the app. */
type Props = { children: ReactNode; resetKey?: string; wrap?: (fallback: ReactNode) => ReactNode };

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const fallback = (
      <EmptyState icon="alert" title="Something went wrong" text={this.state.error.message}>
        <Button label="Try again" onClick={() => this.setState({ error: null })} />
      </EmptyState>
    );
    return this.props.wrap ? this.props.wrap(fallback) : fallback;
  }
}
