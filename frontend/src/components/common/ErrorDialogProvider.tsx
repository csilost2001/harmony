/**
 * アプリ内どこからでも `useErrorDialog().showError(...)` でエラーモーダルを出せるようにする
 * Context Provider。alert() の代わりに使う。
 *
 * 制約: ErrorBoundary の fallback は Provider の外側に描画されるケースがあるので、
 * AppErrorFallback / TabErrorFallback は Context ではなく ErrorDetailsPanel を直接使う。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ErrorDialog } from "./ErrorDialog";
import { recordError } from "../../utils/errorLog";

export interface ShowErrorOptions {
  /** タイトル（例: "保存に失敗しました"）。 */
  title: string;
  /** 本文メッセージ。error.message を想定。 */
  message?: string;
  /** Error オブジェクトがあれば渡す（message/stack を自動抽出）。 */
  error?: unknown;
  /** 追加のコンテキスト（tabId, screenId など）。 */
  context?: Record<string, unknown>;
  /** errorLog に記録する際の source。省略時 "manual"。 */
  logSource?: "boundary" | "window" | "unhandledrejection" | "manual";
  /** errorLog への記録をスキップしたい場合 true。 */
  skipLogRecord?: boolean;
}

interface ErrorDialogContextValue {
  showError: (opts: ShowErrorOptions) => void;
}

const ErrorDialogContext = createContext<ErrorDialogContextValue | null>(null);

interface DialogState {
  title: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export function ErrorDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const showError = useCallback((opts: ShowErrorOptions) => {
    const err = opts.error;
    const message =
      opts.message ??
      (err instanceof Error ? err.message : err != null ? String(err) : "不明なエラー");
    const stack = err instanceof Error ? err.stack : undefined;

    if (!opts.skipLogRecord) {
      recordError({
        source: opts.logSource ?? "manual",
        message: `${opts.title}: ${message}`,
        stack,
        context: opts.context,
      });
    }

    setState({ title: opts.title, message, stack, context: opts.context });
  }, []);

  const value = useMemo<ErrorDialogContextValue>(() => ({ showError }), [showError]);

  return (
    <ErrorDialogContext.Provider value={value}>
      {children}
      <ErrorDialog
        open={state !== null}
        title={state?.title ?? ""}
        message={state?.message ?? ""}
        stack={state?.stack}
        context={state?.context}
        onClose={() => setState(null)}
      />
    </ErrorDialogContext.Provider>
  );
}

/**
 * Provider 配下から呼ぶ。Provider 外で呼んだ場合は console.error にフォールバックする
 * （ErrorBoundary fallback 内など、表示できない状況でも最低限ログは残る）。
 */
export function useErrorDialog(): ErrorDialogContextValue {
  const ctx = useContext(ErrorDialogContext);
  if (ctx) return ctx;
  return {
    showError: (opts) => {
      const err = opts.error;
      const message =
        opts.message ??
        (err instanceof Error ? err.message : err != null ? String(err) : "不明なエラー");
      // eslint-disable-next-line no-console
      console.error(`[useErrorDialog outside provider] ${opts.title}: ${message}`, err);
    },
  };
}
