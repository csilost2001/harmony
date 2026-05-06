import type { ReactElement } from "react";
import type { ListSort } from "../../hooks/useListSort";

interface Props<T> {
  sort: ListSort<T>;
  /** columnKey → ヘッダ文字列への辞書 (表示用ラベル解決) */
  columnLabels: Record<string, string>;
}

/**
 * ソート状態表示バー。docs/spec/list-common.md §4.5 / §3.9。
 * sort.sortKeys.length === 0 の時は null を返す。
 *
 * ソート中は「並び替え Read-only モード」 (§3.9) になるため、
 * 並び替え・貼り付け・新規作成等が無効化されていることをユーザーに明示する。
 */
export function SortBar<T>({ sort, columnLabels }: Props<T>): ReactElement | null {
  if (sort.sortKeys.length === 0) return null;

  return (
    <div className="sort-bar" role="status" aria-live="polite">
      <div className="sort-bar-main">
        <i className="bi bi-sort-down sort-bar-icon" aria-hidden />
        <span className="sort-bar-label">ソート中:</span>
        <span className="sort-bar-keys">
          {sort.sortKeys.map((key, idx) => (
            <span key={key.columnKey} className="sort-bar-key">
              {idx > 0 && <span className="sort-bar-sep">→</span>}
              <span className="sort-bar-key-name">{columnLabels[key.columnKey] ?? key.columnKey}</span>
              <i
                className={`bi ${key.direction === "asc" ? "bi-caret-up-fill" : "bi-caret-down-fill"} sort-bar-dir`}
                aria-label={key.direction === "asc" ? "昇順" : "降順"}
              />
            </span>
          ))}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-link sort-bar-clear"
          onClick={sort.clearSort}
        >
          <i className="bi bi-x-circle" /> ソート解除
        </button>
      </div>
      <div className="sort-bar-note">
        並び替え・新規作成・貼り付けは解除後に可能
      </div>
    </div>
  );
}
