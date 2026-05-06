/**
 * クライアントエラーログ。
 * ErrorBoundary / window.onerror / unhandledrejection から呼ばれ、
 * 直近 N 件を localStorage に保存する。
 *
 * 目的: 「起動すら出来ない」事象の事後診断用。UI は /? debug 等から閲覧する想定。
 */
const ERROR_LOG_KEY = "designer-error-log";
const MAX_ENTRIES = 20;

export interface ErrorLogEntry {
  ts: string;
  source: "boundary" | "window" | "unhandledrejection" | "manual";
  message: string;
  stack?: string;
  url?: string;
  componentStack?: string;
  context?: Record<string, unknown>;
}

function readAll(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(ERROR_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ErrorLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordError(entry: Omit<ErrorLogEntry, "ts" | "url"> & Partial<Pick<ErrorLogEntry, "ts" | "url">>): void {
  const full: ErrorLogEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    url: entry.url ?? (typeof location !== "undefined" ? location.href : undefined),
    source: entry.source,
    message: entry.message,
    stack: entry.stack,
    componentStack: entry.componentStack,
    context: entry.context,
  };
  try {
    const next = [full, ...readAll()].slice(0, MAX_ENTRIES);
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 全滅時は諦める */
  }
  // 開発中に気付けるよう console にも流す
  console.error(`[errorLog/${full.source}]`, full.message, full.stack ?? "");
}

export function getErrorLog(): ErrorLogEntry[] {
  return readAll();
}

export function clearErrorLog(): void {
  try { localStorage.removeItem(ERROR_LOG_KEY); } catch { /* ignore */ }
}

/** main.tsx から一度だけ呼ぶ。window 全体のエラーを拾って log に追加する。 */
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (ev) => {
    recordError({
      source: "window",
      message: ev.message || "unknown error",
      stack: ev.error?.stack,
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    const message =
      reason instanceof Error ? reason.message :
      typeof reason === "string" ? reason :
      JSON.stringify(reason);
    recordError({
      source: "unhandledrejection",
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}
