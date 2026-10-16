/**
 * 読み込み中の共通の表示 (UI 改善提案 第 5 弾 #96)。回るマークと「…を読み込んでいます」。
 * 数秒たっても終わらないときは、時間がかかっていることと、「再試行」のボタンを出す (サーバとの接続が切れている・遅いときに、待ち続けないように)。
 */
import { useEffect, useState } from "react";

const SLOW_MS = 6000;

export function LoadingBlock({ what, onRetry }: { what: string; onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="table-editor-loading loading-block" role="status" aria-live="polite" data-testid="loading-block">
      <i className="bi bi-hourglass-split" /> {what}を読み込んでいます…
      {slow && (
        <div className="loading-block-slow" data-testid="loading-slow">
          時間がかかっています。サーバとの接続を確認してください。
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry ?? (() => window.location.reload())} data-testid="loading-retry">再試行</button>
        </div>
      )}
    </div>
  );
}
