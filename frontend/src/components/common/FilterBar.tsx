import type { ReactElement } from "react";

interface Props {
  isActive: boolean;
  totalCount: number;
  visibleCount: number;
  /** 例: "カテゴリ: 画面のみ" */
  label?: string;
  onClear: () => void;
}

/**
 * フィルタ状態表示バー。仕様 §4.4。
 * isActive=false のとき null を返す。
 */
export function FilterBar({ isActive, totalCount, visibleCount, label, onClear }: Props): ReactElement | null {
  if (!isActive) return null;
  return (
    <div className="filter-bar" role="status" aria-live="polite">
      <span className="filter-bar-text">
        {label && <span className="filter-bar-label">{label} — </span>}
        <span className="filter-bar-count">{visibleCount} 件 / 全 {totalCount} 件</span>
      </span>
      <button
        type="button"
        className="btn btn-sm btn-link filter-bar-clear"
        onClick={onClear}
      >
        <i className="bi bi-x-circle" /> フィルタクリア
      </button>
    </div>
  );
}
