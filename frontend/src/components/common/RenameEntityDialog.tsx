/**
 * RenameEntityDialog — 7 top-level entity の id rename refactor 共通ダイアログ
 * (RFC #1284 / メタ #1292 / ISSUE #1298 I-6)
 *
 * 3 段 UI:
 *   1. step="input": 新 id を入力 (EntityIdInput 流用) + 「シミュレーション (preview)」 button
 *   2. step="preview": preview RPC 結果表示 (file renames + ref updates 件数 + lock 状態) +
 *      「実行」 / 「再入力」 button
 *   3. step="executing": rename RPC 実行中 (spinner)
 *
 * 親 callback `onSuccess(newId, operationId)` で URL/tab migration + 5 分 TTL undo toast を
 * 表示する責務 (handleRenameSuccess helper 利用)。
 */
import { useCallback, useState } from "react";
import { EntityIdInput, type EntityIdValidationState } from "./EntityIdInput";
import { mcpBridge } from "../../mcp/mcpBridge";
import { getRenameEntityMeta, type RenameEntityType } from "../../utils/renameEntityMapping";
import "../../styles/renameEntityDialog.css";

export interface RenameEntityDialogProps {
  entityType: RenameEntityType;
  /**
   * ダイアログ表示用日本語ラベル ("テーブル定義" 等)。
   * 省略時は `getRenameEntityMeta(entityType).entityLabel` を fallback。
   */
  entityLabel?: string;
  /** 現在の id (rename 元) */
  currentId: string;
  /** AI 提案ボタン用の name (entity の物理名 / display name 等) */
  currentName: string;
  /** 同 entity 種別内の既存 id 配列 (currentId は除外して渡す想定、含まれていても無害) */
  existingIds: readonly string[];
  /** dialog を閉じる (cancel / 成功後 共通) */
  onClose: () => void;
  /** rename 成功時のコールバック (URL/tab migration + undo toast 表示は親の責務) */
  onSuccess: (newId: string, operationId: string) => void;
}

// backend `PreviewResult` 型と一致 (renameEntity.ts:65-81)
interface PreviewResult {
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  uniqueOk: boolean;
  oldExists: boolean;
  lockedByOther: boolean;
  fileRenames: Array<{ from: string; to: string }>;
  refUpdates: Array<{
    filePath: string;
    entityKind: string;
    entityId: string;
    jsonPointer: string;
    oldValue: string;
  }>;
  totalRefs: number;
}

interface RenameRpcResult {
  operation: {
    operationId: string;
    entityType: RenameEntityType;
    oldId: string;
    newId: string;
    uuid: string;
    ts: number;
  };
  preview: PreviewResult;
}

type Step = "input" | "preview" | "executing";

export function RenameEntityDialog({
  entityType,
  entityLabel,
  currentId,
  currentName,
  existingIds,
  onClose,
  onSuccess,
}: RenameEntityDialogProps) {
  const meta = getRenameEntityMeta(entityType);
  const label = entityLabel ?? meta.entityLabel;

  const [step, setStep] = useState<Step>("input");
  const [newId, setNewId] = useState("");
  const [validation, setValidation] = useState<EntityIdValidationState>({
    isFormatValid: false,
    isUnique: true,
    isInvalid: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // EntityIdInput の existingIds に currentId が混ざっていると「衝突」扱いになるため除外
  const filteredExistingIds = existingIds.filter((id) => id !== currentId);

  const handlePreview = useCallback(async () => {
    if (validation.isInvalid) return;
    setError(null);
    try {
      const result = (await mcpBridge.request("previewEntityRename", {
        entityType,
        oldId: currentId,
        newId: newId.trim(),
      })) as PreviewResult;
      setPreview(result);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [validation.isInvalid, entityType, currentId, newId]);

  const handleExecute = useCallback(async () => {
    if (!preview) return;
    if (preview.lockedByOther) return;
    setError(null);
    setStep("executing");
    try {
      const result = (await mcpBridge.request("renameEntityId", {
        entityType,
        oldId: currentId,
        newId: preview.newId,
      })) as RenameRpcResult;
      onSuccess(preview.newId, result.operation.operationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("preview"); // executing は cancel 不能なので preview に戻す
    }
  }, [preview, entityType, currentId, onSuccess]);

  const handleBackToInput = useCallback(() => {
    setStep("input");
    setPreview(null);
    setError(null);
  }, []);

  return (
    <div className="rename-entity-overlay" role="dialog" aria-modal="true" data-testid="rename-entity-dialog">
      <div className="rename-entity-modal">
        <div className="rename-entity-modal__header">
          <i className="bi bi-tag" />
          {label} の id を変更
        </div>

        <div className="rename-entity-modal__body">
          <div className="rename-entity-current">
            現在の id: <code>{currentId}</code>
            {currentName && currentName !== currentId && (
              <>
                {" "}/ 名称: <code>{currentName}</code>
              </>
            )}
          </div>

          {step === "input" && (
            <>
              <label htmlFor="rename-entity-new-id" className="form-label small fw-semibold mb-1">
                新しい id
              </label>
              <EntityIdInput
                value={newId}
                onChange={setNewId}
                name={currentName}
                existingIds={filteredExistingIds}
                entityLabel={label}
                inputId="rename-entity-new-id"
                onEnter={() => { void handlePreview(); }}
                onValidationChange={setValidation}
              />
              {error && (
                <div className="rename-entity-error" data-testid="rename-entity-error">
                  <i className="bi bi-exclamation-triangle" /> {error}
                </div>
              )}
            </>
          )}

          {step === "preview" && preview && (
            <>
              <div className="rename-entity-preview-summary" data-testid="rename-entity-preview-summary">
                <strong>{preview.fileRenames.length}</strong> 件のファイル rename と{" "}
                <strong>{preview.totalRefs}</strong> 件の参照更新を実行します。
              </div>

              {preview.lockedByOther && (
                <div className="rename-entity-preview-warning" data-testid="rename-entity-lock-warning">
                  <i className="bi bi-lock" /> 他のセッションが編集ロックを保持しています。
                  ロック解除後に再度お試しください。
                </div>
              )}

              {!preview.oldExists && (
                <div className="rename-entity-preview-warning">
                  <i className="bi bi-exclamation-triangle" /> 旧 id <code>{currentId}</code> のファイルが見つかりません。
                </div>
              )}

              {!preview.uniqueOk && (
                <div className="rename-entity-preview-warning">
                  <i className="bi bi-exclamation-triangle" /> 新 id <code>{preview.newId}</code> が既に存在します。
                </div>
              )}

              <div className="rename-entity-preview-section">
                <h4>ファイル rename ({preview.fileRenames.length})</h4>
                {preview.fileRenames.length === 0 ? (
                  <div className="text-muted small">(なし)</div>
                ) : (
                  <table className="rename-entity-preview-table">
                    <thead>
                      <tr>
                        <th>from</th>
                        <th>to</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.fileRenames.map((r, i) => (
                        <tr key={i}>
                          <td><code>{r.from}</code></td>
                          <td><code>{r.to}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="rename-entity-preview-section">
                <h4>参照更新 ({preview.totalRefs})</h4>
                {preview.totalRefs === 0 ? (
                  <div className="text-muted small">(なし — 本 {label} を参照する箇所はありません)</div>
                ) : (
                  <RefUpdatesByFile refs={preview.refUpdates} />
                )}
              </div>

              {error && (
                <div className="rename-entity-error" data-testid="rename-entity-error">
                  <i className="bi bi-exclamation-triangle" /> {error}
                </div>
              )}
            </>
          )}

          {step === "executing" && (
            <div className="rename-entity-executing">
              <div className="spinner-border" role="status" aria-label="rename 実行中" />
              <div>rename を実行中…</div>
            </div>
          )}
        </div>

        <div className="rename-entity-modal__footer">
          {step === "input" && (
            <>
              <button type="button" className="btn btn-sm btn-secondary" onClick={onClose} data-testid="rename-entity-cancel">
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => { void handlePreview(); }}
                disabled={validation.isInvalid}
                data-testid="rename-entity-preview-btn"
              >
                <i className="bi bi-search" /> シミュレーション
              </button>
            </>
          )}

          {step === "preview" && preview && (
            <>
              <button type="button" className="btn btn-sm btn-secondary" onClick={handleBackToInput} data-testid="rename-entity-back-btn">
                <i className="bi bi-arrow-left" /> 再入力
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => { void handleExecute(); }}
                disabled={preview.lockedByOther || !preview.oldExists || !preview.uniqueOk}
                data-testid="rename-entity-execute-btn"
              >
                <i className="bi bi-check2" /> 実行
              </button>
            </>
          )}

          {step === "executing" && (
            <button type="button" className="btn btn-sm btn-secondary" disabled>
              実行中…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Ref updates を filePath でグループ化して details/summary で折りたたみ表示
 */
function RefUpdatesByFile({ refs }: { refs: PreviewResult["refUpdates"] }) {
  const grouped = new Map<string, PreviewResult["refUpdates"]>();
  for (const r of refs) {
    const arr = grouped.get(r.filePath) ?? [];
    arr.push(r);
    grouped.set(r.filePath, arr);
  }
  const entries = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      {entries.map(([filePath, items]) => (
        <details key={filePath} className="rename-entity-ref-group">
          <summary>
            <code>{filePath}</code>: <strong>{items.length}</strong> 件
          </summary>
          <ul>
            {items.map((r, i) => (
              <li key={i}>
                <code>{r.jsonPointer}</code> ({r.entityKind} / {r.entityId})
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}
