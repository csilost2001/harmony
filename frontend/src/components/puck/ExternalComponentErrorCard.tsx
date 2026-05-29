/**
 * ExternalComponentErrorCard.tsx — 外部 component 読込失敗時のエラーカード (#1409 P-1)。
 *
 * 外部 React Component の読込・検証に失敗した entry を Puck canvas 上に赤系カードで表示する。
 * errorKind 別の日本語メッセージ + 部品 label/id + detail 折り畳みを持つ。
 *
 * frontend/AGENTS.md の規約に従い、UI コンポーネントは src/components/puck/ に配置する
 * (ロジックは src/puck/externalComponents.ts)。
 */

import { useState } from "react";
import type { ExternalComponentErrorKind } from "../../puck/externalComponents";

const ERROR_KIND_MESSAGES: Record<ExternalComponentErrorKind, string> = {
  "load-error": "モジュール読込失敗",
  "missing-export": "export が見つかりません",
  "version-mismatch": "バージョン不一致",
  "manifest-invalid": "manifest 不正",
  "id-collision": "ID 衝突",
  "missing-dependency": "依存部品が未ロード",
};

export interface ExternalComponentErrorCardProps {
  errorKind: ExternalComponentErrorKind;
  /** 部品の表示名 */
  label?: string;
  /** 部品 id */
  id?: string;
  /** 詳細メッセージ (折り畳み表示) */
  detail?: string;
}

export function ExternalComponentErrorCard({
  errorKind,
  label,
  id,
  detail,
}: ExternalComponentErrorCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const headline = ERROR_KIND_MESSAGES[errorKind] ?? "外部コンポーネントエラー";

  return (
    <div
      data-testid="external-component-error-card"
      data-error-kind={errorKind}
      style={{
        border: "1px solid #dc3545",
        background: "#fff5f5",
        borderRadius: 6,
        padding: "12px 14px",
        color: "#842029",
        fontSize: 13,
        lineHeight: 1.5,
        margin: 4,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        <span aria-hidden="true" style={{ marginRight: 6 }}>
          ⚠
        </span>
        外部コンポーネント読込エラー: {headline}
      </div>
      <div style={{ fontSize: 12, color: "#6c2127" }}>
        {label ? `部品: ${label}` : null}
        {id ? ` (id: ${id})` : null}
      </div>
      {detail ? (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              background: "transparent",
              border: "1px solid #dc3545",
              color: "#842029",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {showDetail ? "詳細を隠す" : "詳細を表示"}
          </button>
          {showDetail ? (
            <pre
              style={{
                marginTop: 6,
                marginBottom: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "#fff",
                border: "1px solid #f1c0c4",
                borderRadius: 4,
                padding: 8,
                fontSize: 11,
                color: "#6c2127",
              }}
            >
              {detail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
