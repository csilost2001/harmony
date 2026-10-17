/**
 * 読み込み中の共通の表示 (UI 改善提案 第 5 弾 #96)。回るマークと「…を読み込んでいます」。
 * 数秒たっても終わらないときは、時間がかかっていることと、「再試行」のボタンを出す (サーバとの接続が切れている・遅いときに、待ち続けないように)。
 */
import { useEffect, useState } from "react";

const SLOW_MS = 6000;
/** 骨組みを出すまでの猶予 (一瞬で終わる読み込みで、骨組みがちらつかないように。続編 第 10 弾 #193) */
export const SKELETON_DELAY_MS = 200;

/** 読み込み中の骨組み (行の形の、うっすらした帯)。読み上げには含めない。レイアウトのガタつきを抑える */
export function Skeleton({ lines = 5 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton-line" style={{ width: `${92 - ((i * 13) % 40)}%` }} />)}
    </div>
  );
}

export function LoadingBlock({ what, onRetry }: { what: string; onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    const k = setTimeout(() => setShowSkeleton(true), SKELETON_DELAY_MS);
    return () => { clearTimeout(t); clearTimeout(k); };
  }, []);
  return (
    <div className="table-editor-loading loading-block" role="status" aria-live="polite" data-testid="loading-block">
      <i className="bi bi-hourglass-split" /> {what}を読み込んでいます…
      {showSkeleton && <Skeleton />}
      {slow && (
        <div className="loading-block-slow" data-testid="loading-slow">
          時間がかかっています。サーバとの接続を確認してください。
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry ?? (() => window.location.reload())} data-testid="loading-retry">再試行</button>
        </div>
      )}
    </div>
  );
}
