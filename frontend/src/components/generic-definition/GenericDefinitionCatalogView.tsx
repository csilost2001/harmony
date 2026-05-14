import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  GENERIC_DEFINITION_KINDS,
  GENERIC_DEFINITION_KIND_LABELS,
  type GenericDefinitionKind,
} from "../../types/v3";
import { listGenericDefinitions } from "../../store/genericDefinitionStore";
import { makeTabId } from "../../store/tabStore";

const TAB_ID = makeTabId("generic-definition-catalog", "main");

const KIND_ICONS: Record<GenericDefinitionKind, string> = {
  "data-contract": "bi-file-earmark-code",
  "domain-type": "bi-diagram-2",
  "exception-type": "bi-exclamation-triangle",
  "application-rule": "bi-shield-check",
  "ui-behavior": "bi-hand-index",
  "runtime-policy": "bi-clock-history",
  "component-definition": "bi-box",
  "ui-fragment": "bi-puzzle",
};

const KIND_DESCRIPTIONS: Record<GenericDefinitionKind, string> = {
  "data-contract": "DTO / フォーム / ViewModel など層間契約を定義します",
  "domain-type": "エンティティ / モデルなどドメイン型を定義します",
  "exception-type": "業務例外の種別・階層・セマンティクスを定義します",
  "application-rule": "認証認可 / ログ / 監査など横断ルールを定義します",
  "ui-behavior": "画面横断の UI 振る舞いを定義します",
  "runtime-policy": "リトライ / タイムアウト / サーキットブレーカー等の横断ポリシーを定義します",
  "component-definition": "サービス / マッパー / バリデータなどの責務を定義します",
  "ui-fragment": "再利用可能な UI 断片を定義します",
};

export function GenericDefinitionCatalogView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [counts, setCounts] = useState<Partial<Record<GenericDefinitionKind, number>>>({});

  useEffect(() => {
    const target = document.querySelector(`[data-tab-id="${TAB_ID}"]`);
    if (target) target.setAttribute("data-label", "汎用定義カタログ");
  }, []);

  useEffect(() => {
    const fetchCounts = async () => {
      const entries = await Promise.all(
        GENERIC_DEFINITION_KINDS.map(async (kind) => {
          try {
            const items = await listGenericDefinitions(kind);
            return [kind, items.length] as [GenericDefinitionKind, number];
          } catch {
            return [kind, 0] as [GenericDefinitionKind, number];
          }
        }),
      );
      setCounts(Object.fromEntries(entries));
    };
    fetchCounts().catch(() => undefined);
  }, []);

  return (
    <div style={{ padding: "24px" }}>
      <h2 style={{ marginBottom: "8px", fontSize: "1.3rem" }}>汎用定義カタログ</h2>
      <p style={{ color: "#666", marginBottom: "24px", fontSize: "0.9rem" }}>
        Generic Definition Catalog — データ契約・ドメイン型・例外型など 8 種類の汎用設計定義を管理します。
      </p>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "16px",
      }}>
        {GENERIC_DEFINITION_KINDS.map((kind) => {
          const count = counts[kind] ?? 0;
          return (
            <div
              key={kind}
              onClick={() => navigate(wsPath(`/generic-definition/${kind}`))}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                cursor: "pointer",
                backgroundColor: "#fff",
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <i className={`bi ${KIND_ICONS[kind]}`} style={{ fontSize: "1.3rem", color: "#0d6efd" }} />
                <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  {GENERIC_DEFINITION_KIND_LABELS[kind]}
                </span>
                <span style={{
                  fontSize: "0.75rem",
                  background: "#e8f4fd",
                  color: "#0d6efd",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  marginLeft: "auto",
                }}>
                  {count} 件
                </span>
              </div>
              <p style={{ fontSize: "0.82rem", color: "#555", margin: 0 }}>
                {KIND_DESCRIPTIONS[kind]}
              </p>
              <p style={{ fontSize: "0.78rem", color: "#888", margin: "4px 0 0", fontFamily: "monospace" }}>
                {kind}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
