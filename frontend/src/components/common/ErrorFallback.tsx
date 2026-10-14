import "../../styles/errorFallback.css";
import { ErrorDetailsPanel } from "./ErrorDetailsPanel";
import { hasDraft, listAllDrafts } from "../../utils/draftStorage";

/** タブの種類 → ブラウザの下書き (draftStorage) の種類。サーバの編集セッションで保つものは対応なし */
const DRAFT_KIND_BY_TAB: Record<string, string> = { "table": "table", "process-flow": "action", "business-flow": "businessFlow", "report": "report", "screen-flow": "flow" };

/** 編集中の内容が残っていることの案内 (再試行しても失われないことを伝える) */
export function DraftAssurance({ tabType, resourceId }: { tabType?: string; resourceId?: string }) {
  const kind = tabType ? DRAFT_KIND_BY_TAB[tabType] : undefined;
  const mine = kind && resourceId ? hasDraft(kind, resourceId) : false;
  const total = listAllDrafts().length;
  return (
    <p className="error-fallback-draft" data-testid="error-draft-assurance">
      <i className="bi bi-shield-check" />{" "}
      {mine
        ? "この設計の編集中の内容は、下書きとして残っています。「再試行」か、タブを開き直すと、続きから編集できます。"
        : "編集中の内容は、変更のたびに下書き (このブラウザと、サーバの編集セッション) へ保存しています。「再試行」か、タブを開き直すと、続きから編集できます。"}
      {total > 0 && ` (このブラウザに残っている下書き: ${total} 件。ダッシュボードの「未保存ドラフト」から開けます)`}
    </p>
  );
}

interface AppFallbackProps {
  error: Error;
  onReset: () => void;
}

/** アプリ全体がクラッシュしたときの最終フォールバック。 */
export function AppErrorFallback({ error, onReset }: AppFallbackProps) {
  const handleResetStorage = () => {
    if (!confirm("タブとアクティブ状態を初期化します。未保存の編集は失われる可能性があります。よろしいですか？")) return;
    try {
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
    } catch { /* ignore */ }
    location.href = "/";
  };

  return (
    <div className="app-error-fallback" role="alert">
      <div className="app-error-fallback-panel">
        <h1><i className="bi bi-exclamation-octagon-fill" /> アプリでエラーが発生しました</h1>
        <p>画面を復元できませんでした。タブ情報が壊れている可能性があります。</p>
        <DraftAssurance />
        <ErrorDetailsPanel message={error.message} stack={error.stack} includeServerLog />
        <div className="app-error-actions">
          <button className="btn btn-primary" onClick={onReset}>再試行</button>
          <button className="btn btn-warning" onClick={handleResetStorage}>
            タブ状態をリセットして開き直す
          </button>
        </div>
      </div>
    </div>
  );
}

interface TabFallbackProps {
  error: Error;
  tabLabel: string;
  /** タブの種類と、開いていた設計の ID (下書きが残っているかの案内に使う) */
  tabType?: string;
  resourceId?: string;
  onRetry: () => void;
  onClose: () => void;
}

/** 個別タブがクラッシュしたときのフォールバック。ヘッダー・TabBar は維持される。 */
export function TabErrorFallback({ error, tabLabel, tabType, resourceId, onRetry, onClose }: TabFallbackProps) {
  return (
    <div className="tab-error-fallback" role="alert">
      <div className="tab-error-fallback-panel">
        <h2>
          <i className="bi bi-exclamation-triangle-fill" /> 「{tabLabel}」を表示できませんでした
        </h2>
        <p>このタブの描画中にエラーが発生しました。他のタブは引き続き利用できます。</p>
        <DraftAssurance tabType={tabType} resourceId={resourceId} />
        <ErrorDetailsPanel
          message={error.message}
          stack={error.stack}
          context={{ tabLabel, tabType, resourceId }}
          includeServerLog
        />
        <div className="tab-error-actions">
          <button className="btn btn-primary" onClick={onRetry}>再試行</button>
          <button className="btn btn-outline-danger" onClick={onClose}>このタブを閉じる</button>
        </div>
      </div>
    </div>
  );
}
