import "../../styles/errorFallback.css";
import { ErrorDetailsPanel } from "./ErrorDetailsPanel";

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
        <ErrorDetailsPanel message={error.message} stack={error.stack} />
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
  onRetry: () => void;
  onClose: () => void;
}

/** 個別タブがクラッシュしたときのフォールバック。ヘッダー・TabBar は維持される。 */
export function TabErrorFallback({ error, tabLabel, onRetry, onClose }: TabFallbackProps) {
  return (
    <div className="tab-error-fallback" role="alert">
      <div className="tab-error-fallback-panel">
        <h2>
          <i className="bi bi-exclamation-triangle-fill" /> 「{tabLabel}」を表示できませんでした
        </h2>
        <p>このタブの描画中にエラーが発生しました。他のタブは引き続き利用できます。</p>
        <ErrorDetailsPanel
          message={error.message}
          stack={error.stack}
          context={{ tabLabel }}
        />
        <div className="tab-error-actions">
          <button className="btn btn-primary" onClick={onRetry}>再試行</button>
          <button className="btn btn-outline-danger" onClick={onClose}>このタブを閉じる</button>
        </div>
      </div>
    </div>
  );
}
