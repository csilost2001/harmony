// Phase-3 (#1145): ProcessFlowEditor.tsx から警告詳細パネル (#261 UI 統合) を抽出。
// 警告一覧 + 「全て AI に依頼」 / 個別「AI に依頼」ボタン (既起票判定込み)。

import { generateUUID } from "../../../utils/uuid";
import type { ProcessFlow, Marker, Uuid, Timestamp, LocalId } from "../../../types/v3";
import type { ValidationError } from "../../../utils/actionValidation";

export interface WarningsPanelProps {
  group: ProcessFlow | null;
  validationErrors: ValidationError[];
  onClose: () => void;
  /** マーカーを 1 件以上追加するため、ProcessFlow を updater で更新する */
  onUpdateProcessFlow: (fn: (g: ProcessFlow) => void) => void;
}

export function WarningsPanel({
  group,
  validationErrors,
  onClose,
  onUpdateProcessFlow,
}: WarningsPanelProps) {
  const warnings = validationErrors.filter((e) => e.severity === "warning");
  if (warnings.length === 0) return null;

  const handleBulkAskAi = () => {
    if (!group) return;
    const existingKeys = new Set(
      (group.authoring?.markers ?? [])
        .filter((m) => !m.resolvedAt && m.kind === "todo")
        .map((m) => `${m.validatorCode ?? ""}|${m.validatorPath ?? ""}`),
    );
    const newMarkers = warnings
      .filter((e) => e.path)
      .filter((e) => !existingKeys.has(`${e.code ?? ""}|${e.path ?? ""}`))
      .map((e): Marker => ({
        id: generateUUID() as Uuid,
        kind: "todo",
        body: `警告解消: ${e.message}`,
        // #1016 silent bug fix: stepId は anchor.stepId に、code/path → validatorCode/validatorPath (v3 Marker schema 規範)
        anchor: e.stepId
          ? { stepId: e.stepId as LocalId, fieldPath: e.path }
          : (e.path ? { fieldPath: e.path } : undefined),
        validatorCode: e.code,
        validatorPath: e.path,
        author: "human",
        createdAt: new Date().toISOString() as Timestamp,
      }));
    if (newMarkers.length === 0) {
      window.alert("全ての警告は既に AI 依頼済みです");
      return;
    }
    onUpdateProcessFlow((g) => {
      g.authoring = {
        ...(g.authoring ?? {}),
        markers: [...(g.authoring?.markers ?? []), ...newMarkers],
      };
    });
    window.alert(
      `${newMarkers.length} 件の警告を marker として起票しました。/designer-work で処理できます。`,
    );
  };

  return (
    <div className="process-flow-validation-panel">
      <div className="process-flow-validation-panel-header">
        <i className="bi bi-exclamation-triangle-fill" /> 警告 ({warnings.length} 件)
        <button
          className="btn btn-sm btn-link process-flow-validation-panel-bulk-ai"
          onClick={handleBulkAskAi}
          title="全ての警告をまとめて AI 依頼 marker として起票"
        >
          <i className="bi bi-robot" /> 全て AI に依頼
        </button>
        <button className="btn btn-sm btn-link ms-1" onClick={onClose} title="閉じる">
          <i className="bi bi-x-lg" />
        </button>
      </div>
      <ul className="process-flow-validation-panel-list">
        {warnings.map((e, i) => {
          const isMarked = (group?.authoring?.markers ?? []).some(
            (m) =>
              !m.resolvedAt && m.kind === "todo" && m.validatorCode === e.code && m.validatorPath === e.path,
          );
          return (
            <li key={i}>
              {e.code && <span className="validation-code">{e.code}</span>}
              <span className="validation-message">{e.message}</span>
              {e.path && <span className="validation-path">{e.path}</span>}
              <button
                className={`btn btn-sm validation-ask-ai-btn ${isMarked ? "asked" : ""}`}
                disabled={isMarked || !group}
                title={isMarked ? "AI に依頼済み" : "この警告を marker として AI に依頼"}
                onClick={() => {
                  if (!group || isMarked) return;
                  const newMarker: Marker = {
                    id: generateUUID() as Uuid,
                    kind: "todo",
                    body: `警告解消: ${e.message}`,
                    // #1016 silent bug fix: stepId は anchor.stepId に、code/path → validatorCode/validatorPath
                    anchor: e.stepId
                      ? { stepId: e.stepId as LocalId, fieldPath: e.path }
                      : (e.path ? { fieldPath: e.path } : undefined),
                    validatorCode: e.code,
                    validatorPath: e.path,
                    author: "human",
                    createdAt: new Date().toISOString() as Timestamp,
                  };
                  onUpdateProcessFlow((g) => {
                    g.authoring = {
                      ...(g.authoring ?? {}),
                      markers: [...(g.authoring?.markers ?? []), newMarker],
                    };
                  });
                }}
              >
                <i className={`bi ${isMarked ? "bi-check-circle-fill" : "bi-robot"}`} />
                {" "}
                {isMarked ? "依頼済" : "AI に依頼"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
