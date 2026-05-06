import type { ReactElement } from "react";

export type ViewMode = "card" | "table";

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** data-storage-key 属性に反映。ホスト側は usePersistentState で永続化する想定 */
  storageKey?: string;
}

/**
 * カード ⇔ 表のアイコントグル。仕様 §4.3。
 * コントロールド。永続化は `usePersistentState` を利用してホスト側で行う。
 */
export function ViewModeToggle({ mode, onChange, storageKey }: Props): ReactElement {
  return (
    <div
      className="btn-group btn-group-sm view-mode-toggle"
      role="group"
      aria-label="表示モード切替"
      data-storage-key={storageKey}
    >
      <button
        type="button"
        className={`btn btn-outline-secondary${mode === "card" ? " active" : ""}`}
        aria-pressed={mode === "card"}
        aria-label="カード表示"
        title="カード表示"
        onClick={() => onChange("card")}
      >
        <i className="bi bi-grid-3x3-gap" />
      </button>
      <button
        type="button"
        className={`btn btn-outline-secondary${mode === "table" ? " active" : ""}`}
        aria-pressed={mode === "table"}
        aria-label="表表示"
        title="表表示"
        onClick={() => onChange("table")}
      >
        <i className="bi bi-list-task" />
      </button>
    </div>
  );
}
