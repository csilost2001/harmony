import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordError } from "../../utils/errorLog";

interface Props {
  /** ユーザー向けフォールバック UI。(error, reset) を受け取る */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** 捕捉時のコンテキスト情報（どのタブか等） */
  context?: Record<string, unknown>;
  /** 捕捉時に追加で呼ぶコールバック */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** このキーが変わったら自動 reset（タブ切替時に過去のエラーを引き摺らないため） */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError({
      source: "boundary",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      context: this.props.context,
    });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}
