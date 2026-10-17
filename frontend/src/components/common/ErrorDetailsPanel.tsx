/**
 * エラーメッセージ・スタック・エラーログ履歴を表示し、クリップボードコピー／JSON DL を提供する。
 * AppErrorFallback / TabErrorFallback / ErrorDialog から共通利用。
 *
 * 目的: ユーザーが「どう伝えれば治るか」困ったときに、最小限の操作でログを共有できるようにする。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { clearErrorLog, getErrorLog, type ErrorLogEntry } from "../../utils/errorLog";
import { listAllDrafts } from "../../utils/draftStorage";
import { mcpBridge } from "../../mcp/mcpBridge";
import { buildErrorReportText } from "../../utils/errorReport";
import { getToastHistory } from "../../utils/toast";
import { getActiveTabId, getTabs } from "../../store/tabStore";
import { opsApi, type VersionInfo } from "../../utils/opsApi";

interface Props {
  /** 見出しの次に出るエラーメッセージ。error.message などを想定。 */
  message: string;
  /** エラースタック（error.stack）。あれば展開可能セクションに表示。 */
  stack?: string;
  /** 追加のコンテキスト情報。screenId, tabId などを想定。 */
  context?: Record<string, unknown>;
  /** 履歴ログ表示を省く場合 true。通常は false。 */
  hideHistory?: boolean;
  /** サーバのログの末尾 (最大 100 行) を、レポートに含める。つながっていなければ含めない */
  includeServerLog?: boolean;
}

/** クリップボードにテキストを書き出す。Clipboard API が使えない場合は textarea フォールバック。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough to legacy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function buildReport(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown> | undefined,
  history: ErrorLogEntry[],
  serverLog: string[] | null,
  drafts: Array<{ kind: string; id: string }>,
): string {
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      url: typeof location !== "undefined" ? location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      message,
      stack,
      context,
      history,
      // 編集中の内容の下書き (このブラウザに残っているもの。中身は含めない)
      localDrafts: drafts,
      // サーバのログの末尾 (書くときに、キー・トークンなどをマスク済み)。つながっていなければ無い
      ...(serverLog ? { serverLogTail: serverLog } : {}),
    },
    null,
    2,
  );
}

export function ErrorDetailsPanel({ message, stack, context, hideHistory, includeServerLog }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const history = useMemo(() => (hideHistory ? [] : getErrorLog()), [hideHistory]);

  // サーバのログの末尾 (つながっているときだけ。2 秒で諦める)。不具合の報告に添える
  const [serverLog, setServerLog] = useState<string[] | null>(null);
  useEffect(() => {
    if (!includeServerLog) return;
    let alive = true;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    Promise.race([mcpBridge.request("diagnostics.serverLogTail", { lines: 100 }), timeout])
      .then((res) => { if (alive && res && Array.isArray((res as { lines?: unknown }).lines)) setServerLog((res as { lines: string[] }).lines); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [includeServerLog]);
  const drafts = useMemo(() => listAllDrafts().map((d) => ({ kind: d.kind, id: d.id })), []);

  const report = useMemo(
    () => buildReport(message, stack, context, history, serverLog, drafts),
    [message, stack, context, history, serverLog, drafts],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyText(report);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  }, [report]);

  // 報告用の文 (版・コミット・URL・画面・直前の操作 5 件・エラーを、貼れる形に。続編 第 10 弾 #200)。版は、つながっているときだけ (2 秒で諦める)
  const [textCopyState, setTextCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const handleCopyText = useCallback(async () => {
    const version = await Promise.race([opsApi.version().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2000))]) as VersionInfo | null;
    const tab = getTabs().find((t) => t.id === getActiveTabId());
    const text = buildErrorReportText({
      message, stack, version: version ?? undefined, url: typeof location !== "undefined" ? location.href : undefined, screen: tab?.label,
      recentOperations: getToastHistory().map((t) => ({ at: t.at, text: t.text })), drafts,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
    const ok = await copyText(text);
    setTextCopyState(ok ? "copied" : "failed");
    setTimeout(() => setTextCopyState("idle"), 2000);
  }, [message, stack, drafts]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([report], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `designer-error-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const handleClearHistory = useCallback(() => {
    if (!confirm("エラーログ履歴を消去します。よろしいですか？")) return;
    clearErrorLog();
    setHistoryOpen(false);
  }, []);

  return (
    <div className="error-details">
      <pre className="error-details-message">{message}</pre>

      {stack && (
        <details
          className="error-details-block"
          open={stackOpen}
          onToggle={(e) => setStackOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>スタックトレース</summary>
          <pre className="error-details-pre">{stack}</pre>
        </details>
      )}

      {context && Object.keys(context).length > 0 && (
        <details className="error-details-block">
          <summary>コンテキスト</summary>
          <pre className="error-details-pre">{JSON.stringify(context, null, 2)}</pre>
        </details>
      )}

      {!hideHistory && (
        <details
          className="error-details-block"
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            エラーログ履歴（直近 {history.length} 件）
          </summary>
          {history.length === 0 ? (
            <p className="error-details-empty">履歴はありません。</p>
          ) : (
            <pre className="error-details-pre">{JSON.stringify(history, null, 2)}</pre>
          )}
        </details>
      )}

      <div className="error-details-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleCopy}
          title="レポート JSON をクリップボードにコピー"
          data-testid="error-copy-btn"
          data-copy-state={copyState}
        >
          <i className="bi bi-clipboard" />{" "}
          {copyState === "copied" ? "コピー済み" : copyState === "failed" ? "コピー失敗" : "状況をまとめてコピー"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void handleCopyText()}
          title="版・コミット・URL・開いていた画面・直前の操作 5 件・エラーを、ISSUE やチャットに貼れる文でコピー (設計の中身・サーバのログは含みません)"
          data-testid="error-copy-text-btn"
          data-copy-state={textCopyState}
        >
          <i className="bi bi-card-text" />{" "}
          {textCopyState === "copied" ? "コピー済み" : textCopyState === "failed" ? "コピー失敗" : "報告用の文をコピー"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleDownload}
          title="レポート JSON をファイル保存"
        >
          <i className="bi bi-download" /> レポートをダウンロード
        </button>
        {!hideHistory && history.length > 0 && (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={handleClearHistory}
            title="localStorage の履歴ログを消去"
          >
            履歴を消去
          </button>
        )}
      </div>
    </div>
  );
}
