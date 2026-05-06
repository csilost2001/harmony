import type { Maturity } from "../../types/action";

interface Props {
  /** 未指定は "draft" 既定として扱う (docs/spec/process-flow-maturity.md §3) */
  maturity?: Maturity;
  /** 省略時のスタイル調整用: ステップカード内 inline / リスト行 standalone */
  size?: "sm" | "md";
  /**
   * 指定すると成熟度を編集可能に。クリックで draft → provisional → committed → draft を循環。
   * 未指定時は表示のみ (#184)。
   */
  onChange?: (next: Maturity) => void;
}

/**
 * 成熟度バッジ (#184、docs/spec/process-flow-maturity.md §6.1)
 * - draft (🟡): 下書き
 * - provisional (🟠): 暫定
 * - committed (🟢): 確定
 *
 * onChange 指定時はクリックで循環切替 (#188)。
 */
const STYLE_MAP: Record<Maturity, { color: string; label: string; title: string }> = {
  draft: { color: "#f59e0b", label: "●", title: "下書き (draft)" },
  provisional: { color: "#f97316", label: "●", title: "暫定 (provisional)" },
  committed: { color: "#22c55e", label: "●", title: "確定 (committed)" },
};

const CYCLE: Record<Maturity, Maturity> = {
  draft: "provisional",
  provisional: "committed",
  committed: "draft",
};

export function MaturityBadge({ maturity, size = "sm", onChange }: Props) {
  const m: Maturity = maturity ?? "draft";
  const style = STYLE_MAP[m];
  const fontSize = size === "sm" ? 10 : 12;
  const editable = !!onChange;
  const title = editable
    ? `${style.title} — クリックで切替`
    : style.title;

  const handleClick = (e: React.MouseEvent) => {
    if (!onChange) return;
    e.stopPropagation();
    onChange(CYCLE[m]);
  };

  return (
    <span
      className={`maturity-badge${editable ? " editable" : ""}`}
      title={title}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onClick={editable ? handleClick : undefined}
      onKeyDown={editable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(CYCLE[m]);
        }
      } : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 4px",
        color: style.color,
        fontSize,
        lineHeight: 1,
        flexShrink: 0,
        cursor: editable ? "pointer" : undefined,
      }}
      aria-label={`成熟度: ${style.title}${editable ? " (クリックで切替)" : ""}`}
    >
      <span style={{ fontSize: size === "sm" ? 8 : 10 }}>{style.label}</span>
    </span>
  );
}
