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
import { useCallback, useEffect, useState } from "react";
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
  /**
   * Phase I round 3+4 Nit N-1 (Opus round 3): dialog open 時に existingIds を最新化する
   * 任意の async fetcher。省略時は props.existingIds を固定使用 (旧挙動)。
   *
   * 各 editor は mount 時に listTables() 等で fetch した snapshot を保持しているが、
   * dialog open までに他 session が新規 id を作成すると stale。本 callback で
   * dialog open 時に再取得する経路を提供する (multi-session 運用での UX 改善)。
   * backend execute 時の uniqueness check は引き続き safety net。
   */
  fetchExistingIds?: () => Promise<readonly string[]>;
  /** dialog を閉じる (cancel / 成功後 共通) */
  onClose: () => void;
  /**
   * rename 成功時のコールバック (URL/tab migration + undo toast 表示は親の責務)。
   *
   * Phase J Nit N-1 / SF-β: optional 第 3 引数で `{ttlExpiresAt, workspaceRoot}` を渡す。
   * 親はこれを RenameEntityUndoToast の props に転送する。
   * 既存呼出 (2 引数) は backward compat (旧 toast は client clock + 現 active root に fallback)。
   */
  onSuccess: (
    newId: string,
    operationId: string,
    extra?: { ttlExpiresAt?: number; workspaceRoot?: string },
  ) => void;
}

// backend `PreviewResult` 型と一致 (renameEntity.ts: PreviewResult interface)
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
  /**
   * Phase I round 3+4 Should-fix SF-1 (Codex S-1 / Opus SF-1 / Antigravity SF-1):
   * 以下 4 field は backend で追加されたが UI dialog に未反映だった。
   * 全 4 field を render + execute button の disable 条件に組み込む。
   */
  ambiguousDependencies: Array<{
    viewId: string;
    conflictingEntityType: RenameEntityType;
    filePath: string;
  }>;
  concurrentEditRefs: Array<{ entityKind: string; entityId: string; sessionId: string }>;
  warnings: string[];
  positionsCollisions: string[];
}

interface RenameRpcResult {
  operation: {
    operationId: string;
    entityType: RenameEntityType;
    oldId: string;
    newId: string;
    uuid: string;
    ts: number;
    /**
     * Phase J Nit N-1 (#1298 round 5 Codex N-1): server-side TTL 期限 (絶対 timestamp、
     * server clock 基準)。frontend toast はこの値を基準に auto-dismiss を計算することで
     * client-server clock drift による誤差を回避できる。
     */
    ttlExpiresAt?: number;
    /**
     * Phase J SF-β (#1298 round 5 Opus SF-2): rename 実行時の workspace root path。
     * user が workspace 切替後に undo を押した時、現 active root と乖離するため、
     * toast props として保持し undo RPC params に明示渡しする。
     */
    workspaceRoot?: string;
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
  fetchExistingIds,
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

  // Phase I round 3+4 N-1 (Opus round 3): dialog open 時に existingIds を再取得 (任意)
  const [refreshedExistingIds, setRefreshedExistingIds] = useState<readonly string[] | null>(null);
  useEffect(() => {
    if (!fetchExistingIds) return;
    let cancelled = false;
    fetchExistingIds()
      .then((ids) => {
        if (!cancelled) setRefreshedExistingIds(ids);
      })
      .catch((e) => {
        // best effort: 失敗時は props.existingIds を継続使用 (safety net は backend uniqueness)
        console.warn("RenameEntityDialog: existingIds refresh failed (fallback to props snapshot)", e);
      });
    return () => { cancelled = true; };
  }, [fetchExistingIds]);

  // EntityIdInput の existingIds に currentId が混ざっていると「衝突」扱いになるため除外
  const effectiveExistingIds = refreshedExistingIds ?? existingIds;
  const filteredExistingIds = effectiveExistingIds.filter((id) => id !== currentId);

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
      onSuccess(preview.newId, result.operation.operationId, {
        ttlExpiresAt: result.operation.ttlExpiresAt,
        workspaceRoot: result.operation.workspaceRoot,
      });
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

              {/*
                Phase I round 3+4 SF-1: backend で追加された blocker 系 field を UI に反映
                - ambiguousDependencies: 同名 entity が他 type に存在 + View.dependencies 経由参照
                - concurrentEditRefs: 参照側 entity を他 session が編集中
                - positionsCollisions: screen-flow-positions / er-layout の KEY 衝突
                - warnings: 非 blocker 情報通知 (現状未使用、将来拡張用)
                blocker 系 3 field は execute button disable + 専用 error section で表示する
              */}
              {preview.ambiguousDependencies.length > 0 && (
                <div className="rename-entity-preview-warning" data-testid="rename-entity-ambiguous-deps">
                  <i className="bi bi-exclamation-octagon" />
                  <strong>{` cross-type ambiguous dependency 検出 (${preview.ambiguousDependencies.length} 件)`}</strong>
                  <ul className="mb-0 mt-1">
                    {preview.ambiguousDependencies.map((d, i) => (
                      <li key={i}>
                        View <code>{d.viewId}</code> ({d.filePath}) が <code>{d.conflictingEntityType}</code> "{preview.oldId}" を参照している可能性
                      </li>
                    ))}
                  </ul>
                  <small>先に同名の別 entity を rename / 削除してから再実行してください。</small>
                </div>
              )}

              {preview.concurrentEditRefs.length > 0 && (
                <div className="rename-entity-preview-warning" data-testid="rename-entity-concurrent-edits">
                  <i className="bi bi-people" />
                  <strong>{` 他 session が参照側 entity を編集中 (${preview.concurrentEditRefs.length} 件)`}</strong>
                  <ul className="mb-0 mt-1">
                    {preview.concurrentEditRefs.map((c, i) => (
                      <li key={i}>
                        <code>{c.entityKind}/{c.entityId}</code> (session=<code>{c.sessionId}</code>)
                      </li>
                    ))}
                  </ul>
                  <small>当該 editor の編集を確定 / 破棄してから再実行してください。</small>
                </div>
              )}

              {preview.positionsCollisions.length > 0 && (
                <div className="rename-entity-preview-warning" data-testid="rename-entity-positions-collisions">
                  <i className="bi bi-exclamation-octagon" />
                  <strong>{` positions key 衝突 (${preview.positionsCollisions.length} 件)`}</strong>
                  <ul className="mb-0 mt-1">
                    {preview.positionsCollisions.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="rename-entity-preview-info" data-testid="rename-entity-warnings">
                  <i className="bi bi-info-circle" />
                  <strong>{` 通知 (${preview.warnings.length} 件)`}</strong>
                  <ul className="mb-0 mt-1">
                    {preview.warnings.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
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
                /*
                 * Phase I round 3+4 SF-1: backend blocker 系 field を disable 条件に組み込む。
                 * - lockedByOther / !oldExists / !uniqueOk: 既存 disable 条件
                 * - ambiguousDependencies / concurrentEditRefs / positionsCollisions: backend が
                 *   execute throw する 3 種の blocker。preview 段階で button 無効化して
                 *   設計者が無駄な execute → raw error を回避できるようにする。
                 */
                disabled={
                  preview.lockedByOther ||
                  !preview.oldExists ||
                  !preview.uniqueOk ||
                  preview.ambiguousDependencies.length > 0 ||
                  preview.concurrentEditRefs.length > 0 ||
                  preview.positionsCollisions.length > 0
                }
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
