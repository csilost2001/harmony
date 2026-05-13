import type { EditLevel } from "../../hooks/useEditLevel";

interface EditLevelToggleProps {
  value: EditLevel;
  onChange: (level: EditLevel) => void;
  disabled?: boolean;
}

const LEVELS: { value: EditLevel; label: string; icon: string; title: string }[] = [
  {
    value: "rough",
    label: "ラフ",
    icon: "bi-sketch",
    title: "ラフ設計 — 目的・失敗時・メモのみ表示",
  },
  {
    value: "detail",
    label: "詳細",
    icon: "bi-list-columns-reverse",
    title: "詳細設計 — 入出力・DB/画面/外部参照まで表示",
  },
  {
    value: "implementation",
    label: "実装",
    icon: "bi-code-slash",
    title: "プログラム設計 — 全項目表示",
  },
];

export function EditLevelToggle({ value, onChange, disabled }: EditLevelToggleProps) {
  return (
    <div
      className="process-flow-edit-level-toggle"
      role="group"
      aria-label="編集レベル"
      title="編集レベル切替: ラフ / 詳細 / 実装"
    >
      {LEVELS.map((level) => (
        <button
          key={level.value}
          type="button"
          className={`process-flow-edit-level-btn${value === level.value ? " active" : ""}`}
          title={level.title}
          disabled={disabled}
          aria-pressed={value === level.value}
          onClick={() => onChange(level.value)}
        >
          <i className={`bi ${level.icon}`} />
          <span className="process-flow-edit-level-label">{level.label}</span>
        </button>
      ))}
    </div>
  );
}
