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
  "validation-rule": "bi-check2-square",
  "ui-behavior": "bi-hand-index",
  "runtime-policy": "bi-clock-history",
  "component-definition": "bi-box",
  constants: "bi-hash",
  message: "bi-chat-text",
  "domain-event": "bi-broadcast",
  "log-event": "bi-journal-text",
  "log-config": "bi-sliders",
  dialog: "bi-chat-square",
  "message-area": "bi-chat-left-text",
  options: "bi-list-ul",
  global: "bi-globe2",
  "state-machine": "bi-diagram-3",
  "seed-data": "bi-database-add",
  requirement: "bi-speedometer2",
  "job-definition": "bi-clock-history",
};

const KIND_DESCRIPTIONS: Record<GenericDefinitionKind, string> = {
  "data-contract": "DTO / フォーム / ViewModel など層間契約を定義します",
  "domain-type": "エンティティ / モデルなどドメイン型を定義します",
  "exception-type": "業務例外の種別・階層・セマンティクスを定義します",
  "application-rule": "認証認可 / ログ / 監査など横断ルールを定義します",
  "validation-rule": "業務検証ルール (条件 + メッセージ + 重大度) を定義します",
  "ui-behavior": "画面横断の UI 振る舞いを定義します",
  "runtime-policy": "リトライ / タイムアウト / サーキットブレーカー等の横断ポリシーを定義します",
  "component-definition": "サービス / マッパー / バリデータなどの責務を定義します",
  constants: "ドメイン定数集 (税率 / 最大件数など) を定義します。参照: @const.<キー>",
  message: "メッセージカタログ (多言語対応の文言) を定義します。参照: @msg.<キー>",
  "domain-event": "業務イベント (発生条件 / 内容 / 発行元) を定義します。参照: @event.<トピック>",
  "log-event": "構造化ログのイベントを定義します。参照: @logEvent.<キー>",
  "log-config": "ログ設定 (レベル / 出力先 / 書式) を定義します。参照: @logConfig.<キー>",
  dialog: "画面から呼び出すダイアログを定義します。参照: @dialog.<名前>",
  "message-area": "画面内のメッセージ表示エリアを定義します。参照: @messageArea.<名前>",
  options: "選択肢カタログ (セレクトボックス / ラジオなどの選択肢セット) を定義します。参照: @options.<名前>",
  global: "アプリケーション全体で共有する設定値を定義します。参照: @var.global.<キー>",
  "state-machine": "状態と、状態の遷移 (契機・条件・遷移を起こす処理フロー) を定義します",
  "seed-data": "テーブルに最初から入れておく行 (マスタ・初期値) を定義します",
  requirement: "非機能要件 (性能・可用性) の目標値を、対象の処理フローと結びつけて定義します",
  "job-definition": "定期・出来事を契機に動く処理 (実行の時刻・再実行の方針) を定義します",
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
      <p style={{ color: "var(--hm-fg-2)", marginBottom: "24px", fontSize: "0.9rem" }}>
        Generic Definition Catalog — データ契約・ドメイン型・例外型など 17 種類の汎用設計定義を管理します。
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
                border: "1px solid var(--hm-border-strong)",
                borderRadius: "8px",
                padding: "16px",
                cursor: "pointer",
                backgroundColor: "var(--hm-surface)",
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
                <i className={`bi ${KIND_ICONS[kind]}`} style={{ fontSize: "1.3rem", color: "color-mix(in srgb, var(--hm-hue-blue) 80%, var(--hm-fg))" }} />
                <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                  {GENERIC_DEFINITION_KIND_LABELS[kind]}
                </span>
                <span style={{
                  fontSize: "0.75rem",
                  background: "var(--hm-surface-3)",
                  color: "color-mix(in srgb, var(--hm-hue-blue) 80%, var(--hm-fg))",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  marginLeft: "auto",
                }}>
                  {count} 件
                </span>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--hm-fg-2)", margin: 0 }}>
                {KIND_DESCRIPTIONS[kind]}
              </p>
              <p style={{ fontSize: "0.78rem", color: "var(--hm-fg-muted)", margin: "4px 0 0", fontFamily: "monospace" }}>
                {kind}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
