import type { Candidate } from "../../utils/reference-completer/types";

interface CompletionPopupProps {
  candidates: Candidate[];
  activeIndex: number;
  onPick: (c: Candidate) => void;
  ariaLabel?: string;
}

/** 参照補完の候補一覧。選んでいる候補には、詳しい説明 (detail) と、操作の案内を出す。 */
export function CompletionPopup({ candidates, activeIndex, onPick, ariaLabel = "補完候補" }: CompletionPopupProps) {
  const active = candidates[activeIndex];
  return (
    <ul
      role="listbox"
      aria-label={ariaLabel}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 9999,
        background: "var(--hm-surface)",
        border: "1px solid var(--hm-border-strong)",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        margin: "2px 0 0",
        padding: "4px 0",
        minWidth: "16em",
        maxHeight: "16em",
        overflowY: "auto",
        listStyle: "none",
      }}
    >
      {candidates.map((c, i) => (
        <li
          key={`${c.value}-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(c);
          }}
          style={{
            padding: "4px 12px",
            cursor: "pointer",
            background: i === activeIndex ? "var(--hm-accent-solid)" : "transparent",
            color: i === activeIndex ? "var(--hm-on-solid)" : "var(--hm-fg)",
            borderRadius: i === activeIndex ? 3 : 0,
            margin: "0 4px",
          }}
        >
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.82rem" }}>
            {c.label ?? c.value}
          </span>
          {c.hint && <span style={{ marginLeft: 8, fontSize: "0.75rem", opacity: 0.65 }}>{c.hint}</span>}
        </li>
      ))}
      <li
        aria-hidden="true"
        style={{
          margin: "4px 8px 0",
          paddingTop: 4,
          borderTop: "1px solid var(--hm-border)",
          fontSize: "0.72rem",
          color: "var(--hm-fg-muted)",
          position: "sticky",
          bottom: 0,
          background: "var(--hm-surface)",
        }}
      >
        {active?.detail && (
          <div data-testid="completion-detail" style={{ marginBottom: 2, color: "var(--hm-fg)", whiteSpace: "pre-wrap" }}>
            {active.detail}
          </div>
        )}
        ↑↓ 選ぶ ・ Tab / Enter 確定 ・ Esc 閉じる
      </li>
    </ul>
  );
}

/** 補完のある入力欄に付ける、操作の案内 (title 属性用)。 */
export const COMPLETION_TITLE =
  "@ を入力すると、参照の候補が出ます。Ctrl+Space で候補を開き、↑↓ で選び、Tab / Enter で確定、Esc で閉じます。参照の上で Ctrl+クリック (または F12) をすると、その定義を開きます。";
