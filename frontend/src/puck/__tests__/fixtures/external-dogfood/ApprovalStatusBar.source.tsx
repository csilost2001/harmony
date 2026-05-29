// ApprovalStatusBar.source.tsx — 出典ソース (参照用、#1413 P-5 dogfood fixture)。
//
// この .tsx は `node scripts/scaffold/puck-component.mjs approval-status-bar` で生成した
// 雛形を業務的に編集した出典ソース。同ディレクトリの `approval-status-bar.mjs` は
// このソースを `npm run build` (vite lib build、react/@measured/puck external) した成果物。
// fixture を hermetic に保つため build 成果物 (.mjs) と manifest.json と共に commit している。
// テスト (dogfoodExternalComponents.test.tsx) は .mjs を実 import して検証する。
//
// ApprovalStatusBar.tsx — 外部 Puck Component サンプル (承認ステータス帯、RFC #1405 P-5 dogfood)。
//
// 業務部品: 申請の承認状態を色付き帯で示すヘッダ。タイトル + ステータスバッジ + 任意の本文 slot。
// props は manifest.json の props 宣言と対応させる。
// React は host と共有されるため、必ず "react" から import する (import map で解決)。
import * as React from "react";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalStatusBarProps {
  /** 承認状態 (manifest enum prop と対応) */
  status?: ApprovalStatus;
  /** 帯に表示する見出し */
  title?: string;
  /**
   * named slot (editable region) の render-prop。manifest の slots 宣言と対応する。
   * host (Harmony) が Puck の slot field を render-prop に変換して注入するため、
   * 外部部品側で DropZone を import する必要はない。呼び出すと、設計者がその領域に
   * Puck で配置した部品が描画される (#1411 P-3)。
   */
  content?: (props?: Record<string, unknown>) => React.ReactNode;
}

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
};

const STATUS_COLORS: Record<ApprovalStatus, { bg: string; fg: string; border: string }> = {
  pending: { bg: "#fff8e1", fg: "#7a5b00", border: "#f0c040" },
  approved: { bg: "#e8f5e9", fg: "#1b5e20", border: "#4caf50" },
  rejected: { bg: "#ffebee", fg: "#b71c1c", border: "#e53935" },
};

export default function ApprovalStatusBar({
  status = "pending",
  title = "承認ステータス",
  content,
}: ApprovalStatusBarProps) {
  // React hooks を 1 つ使い、host React と同一インスタンスであることを実証する
  // (二重 React なら "Invalid hook call" で落ちる)。
  const [expanded, setExpanded] = React.useState(true);
  const palette = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  const statusLabel = STATUS_LABELS[status] ?? status;

  return (
    <div
      data-external-component="ApprovalStatusBar"
      data-status={status}
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 12px",
          background: palette.bg,
          color: palette.fg,
        }}
      >
        <strong>{title}</strong>
        <span
          data-testid="approval-status-badge"
          style={{
            border: `1px solid ${palette.border}`,
            borderRadius: 999,
            padding: "2px 10px",
            fontSize: 12,
            fontWeight: 600,
            background: "#fff",
          }}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: palette.fg,
            fontSize: 12,
          }}
        >
          {expanded ? "折りたたむ" : "展開する"}
        </button>
      </div>
      {/* editable region: host 注入 slot。設計者が Puck で内部に部品を配置できる。 */}
      {expanded && content ? <div style={{ padding: 12 }}>{content()}</div> : null}
    </div>
  );
}
