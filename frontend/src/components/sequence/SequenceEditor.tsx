import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { Sequence, TableColumnRef, TableId, LocalId, Maturity, SemVer } from "../../types/v3";
import { loadSequence, saveSequence } from "../../store/sequenceStore";
import { loadConventions } from "../../store/conventionsStore";
import { listTables, loadTable } from "../../store/tableStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { EditorHeader, type EditorHeaderSaveReset, type EditorHeaderBackLink } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import { generateSequenceDdl } from "./generateSequenceDdl";
import type { Table, NumberingEntry } from "../../types/v3";
import "../../styles/editMode.css";

interface TableColumnOption {
  tableId: string;
  tableName: string;
  /** カラム選択用。id (LocalId) を TableColumnRef.columnId として保存、name (DisplayName) は表示用。 */
  columns: Array<{ id: string; name: string }>;
}

export function SequenceEditor() {
  const { sequenceId: rawId } = useParams<{ sequenceId: string }>();
  const sequenceId = rawId ? decodeURIComponent(rawId) : rawId;
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [ddlOpen, setDdlOpen] = useState(false);
  const [numberingKeys, setNumberingKeys] = useState<Array<{ key: string; entry: NumberingEntry }>>([]);
  const [tableOptions, setTableOptions] = useState<TableColumnOption[]>([]);
  const [addUsedByTableId, setAddUsedByTableId] = useState("");
  const [addUsedByColumnId, setAddUsedByColumnId] = useState("");
  const [addingUsedBy, setAddingUsedBy] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const handleNotFound = useCallback(() => navigate(wsPath("/sequence/list"), { replace: true }), [navigate, wsPath]);

  const sessionId = mcpBridge.getSessionId();

  const {
    state: seq,
    isDirty, isSaving, serverChanged,
    update, handleSave: resourceHandleSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<Sequence>({
    tabType: "sequence",
    mtimeKind: "sequence",
    draftKind: "sequence",
    id: sequenceId,
    load: loadSequence,
    save: saveSequence,
    broadcastName: "sequenceChanged",
    broadcastIdField: "sequenceId",
    onNotFound: handleNotFound,
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "sequence",
    resourceId: sequenceId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  const seqRef = useRef<Sequence | null>(null);
  useEffect(() => { seqRef.current = seq ?? null; }, [seq]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (s: Sequence) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!sequenceId || !seqRef.current) return;
      mcpBridge.updateDraft("sequence", sequenceId, seqRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update, sequenceId]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    await resourceHandleSave();
    await actions.save();
  }, [isReadonly, isSaving, resourceHandleSave, actions]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await actions.discard();
    await reload();
  }, [actions, reload]);

  const handleForceRelease = useCallback(async () => {
    setShowForceReleaseDialog(false);
    await actions.forceReleaseOther();
  }, [actions]);

  const handleResumeContinue = useCallback(async () => {
    setShowResumeDialog(false);
    await actions.startEditing();
  }, [actions]);

  const handleResumeDiscard = useCallback(async () => {
    setShowResumeDialog(false);
    if (sequenceId) await mcpBridge.discardDraft("sequence", sequenceId);
    await reload();
  }, [sequenceId, reload]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  useEffect(() => {
    if (!sequenceId) return;
    const tabId = makeTabId("sequence", sequenceId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [sequenceId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!sequenceId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("sequence", sequenceId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sequenceId, sessionLoading, mode.kind]);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    (async () => {
      const catalog = await loadConventions();
      if (catalog?.numbering) {
        const entries = Object.entries(catalog.numbering).map(([k, v]) => ({
          key: `@conv.numbering.${k}`,
          entry: v,
        }));
        setNumberingKeys(entries);
      }

      const metas = await listTables();
      const opts: TableColumnOption[] = [];
      for (const m of metas) {
        const td: Table | null = await loadTable(m.id);
        if (td) {
          opts.push({
            tableId: td.id,
            tableName: td.name || td.physicalName,
            columns: td.columns.map((c) => ({ id: c.id, name: c.name || c.physicalName })),
          });
        }
      }
      setTableOptions(opts);
    })();
  }, [sequenceId]);

  if (!seq || sessionLoading) {
    return <div className="table-editor-loading"><i className="bi bi-hourglass-split" /> 読み込み中...</div>;
  }

  const selectedConvEntry = numberingKeys.find((k) => k.key === seq.conventionRef)?.entry ?? null;
  const ddl = generateSequenceDdl(seq);
  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  const addUsedBy = () => {
    if (!addUsedByTableId || !addUsedByColumnId) return;
    const entry: TableColumnRef = {
      tableId: addUsedByTableId as TableId,
      columnId: addUsedByColumnId as LocalId,
    };
    updateWithDraft((prev) => {
      prev.usedBy = [...(prev.usedBy ?? []), entry];
    });
    setAddUsedByTableId("");
    setAddUsedByColumnId("");
    setAddingUsedBy(false);
  };

  const removeUsedBy = (idx: number) => {
    updateWithDraft((prev) => {
      prev.usedBy = (prev.usedBy ?? []).filter((_, i) => i !== idx);
    });
  };

  const selectedTable = tableOptions.find((t) => t.tableId === addUsedByTableId);
  const selectedTableColumns = selectedTable?.columns ?? [];

  const columnNameOf = (tableId: string, columnId: string): string => {
    const tbl = tableOptions.find((t) => t.tableId === tableId);
    return tbl?.columns.find((c) => c.id === columnId)?.name ?? columnId;
  };

  return (
    <div className={`table-editor-page${isReadonly ? " readonly-mode" : ""}`}>
      {serverChanged && (
        <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={handleSave}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => actions.handleForcedOut(choice)}
        />
      )}

      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => actions.handleAfterForceUnlock(choice)}
        />
      )}

      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={handleResumeContinue}
          onDiscard={handleResumeDiscard}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}

      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}

      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          onConfirm={handleForceRelease}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}

      <EditorHeader
        title={<><i className="bi bi-arrow-repeat" /> シーケンス編集: <code>{seq.physicalName}</code></>}
        backLink={{
          label: "シーケンス一覧",
          onClick: () => navigate(wsPath("/sequence/list")),
        } satisfies EditorHeaderBackLink}
        saveReset={isReadonly ? undefined : {
          isDirty,
          isSaving,
          onSave: handleSave,
          onReset: () => setShowDiscardDialog(true),
        } satisfies EditorHeaderSaveReset}
      />

      <div className="seq-editor-body">
        {/* 4K: 左カラム（基本設定・値設定・規約・使用先） */}
        <div className="seq-editor-left-col">
        {/* 基本設定 */}
        <section className="seq-editor-section">
          <h3 className="seq-editor-section-title">基本設定</h3>
          <div className="seq-editor-grid">
            <label className="tbl-field">
              <span>物理名</span>
              <input
                type="text"
                value={seq.physicalName}
                readOnly
                className="seq-readonly"
                title="物理名は作成後変更できません"
              />
            </label>
            <label className="tbl-field">
              <span>表示名</span>
              <input
                type="text"
                value={seq.name}
                onChange={(e) => updateWithDraft((prev) => { prev.name = e.target.value; })}
                placeholder="発注番号採番"
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>説明</span>
              <input
                type="text"
                value={seq.description ?? ""}
                onChange={(e) => updateWithDraft((prev) => { prev.description = e.target.value || undefined; })}
                placeholder="発注番号の採番 (ORD-YYYY-NNNN)"
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>成熟度</span>
              <select
                value={seq.maturity ?? ""}
                onChange={(e) =>
                  updateWithDraft((prev) => { prev.maturity = (e.target.value || undefined) as Maturity | undefined; })
                }
                disabled={isReadonly}
              >
                <option value="">（未指定）</option>
                <option value="draft">draft（下書き）</option>
                <option value="provisional">provisional（暫定）</option>
                <option value="committed">committed（確定）</option>
              </select>
            </label>
            <label className="tbl-field">
              <span>バージョン</span>
              <input
                type="text"
                value={seq.version ?? ""}
                onChange={(e) =>
                  updateWithDraft((prev) => { prev.version = (e.target.value || undefined) as SemVer | undefined; })
                }
                placeholder="1.0.0"
                pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
                disabled={isReadonly}
              />
            </label>
          </div>
        </section>

        {/* 値設定 */}
        <section className="seq-editor-section">
          <h3 className="seq-editor-section-title">値設定</h3>
          <div className="seq-editor-grid seq-editor-grid-4">
            <label className="tbl-field">
              <span>開始値</span>
              <input
                type="number"
                value={seq.startValue ?? 1}
                onChange={(e) => updateWithDraft((prev) => { prev.startValue = Number(e.target.value); })}
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>増分</span>
              <input
                type="number"
                value={seq.increment ?? 1}
                onChange={(e) => updateWithDraft((prev) => { prev.increment = Number(e.target.value); })}
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>最小値</span>
              <input
                type="number"
                value={seq.minValue ?? ""}
                placeholder="（省略可）"
                onChange={(e) => updateWithDraft((prev) => {
                  prev.minValue = e.target.value === "" ? undefined : Number(e.target.value);
                })}
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>最大値</span>
              <input
                type="number"
                value={seq.maxValue ?? ""}
                placeholder="（省略可）"
                onChange={(e) => updateWithDraft((prev) => {
                  prev.maxValue = e.target.value === "" ? undefined : Number(e.target.value);
                })}
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field">
              <span>キャッシュ</span>
              <input
                type="number"
                value={seq.cache ?? 1}
                min={1}
                onChange={(e) => updateWithDraft((prev) => { prev.cache = Number(e.target.value); })}
                disabled={isReadonly}
              />
            </label>
            <label className="tbl-field seq-field-checkbox">
              <span>CYCLE</span>
              <label className="seq-checkbox-label">
                <input
                  type="checkbox"
                  checked={seq.cycle ?? false}
                  onChange={(e) => updateWithDraft((prev) => { prev.cycle = e.target.checked; })}
                  disabled={isReadonly}
                />
                最大値到達後に最小値に戻る
              </label>
            </label>
          </div>
        </section>

        {/* 規約カタログ連携 */}
        <section className="seq-editor-section">
          <h3 className="seq-editor-section-title">規約カタログ連携</h3>
          <label className="tbl-field">
            <span>対応する規約</span>
            <input
              type="text"
              list="numbering-keys"
              value={seq.conventionRef ?? ""}
              onChange={(e) => updateWithDraft((prev) => { prev.conventionRef = e.target.value || undefined; })}
              placeholder="@conv.numbering.orderNumber"
              disabled={isReadonly}
            />
            <datalist id="numbering-keys">
              {numberingKeys.map((k) => (
                <option key={k.key} value={k.key}>{k.entry.description ?? k.entry.format}</option>
              ))}
            </datalist>
          </label>
          {selectedConvEntry && (
            <div className="seq-conv-preview">
              <div className="seq-conv-preview-key">{seq.conventionRef}</div>
              <div className="seq-conv-preview-format">
                <span className="seq-conv-preview-label">format:</span> {selectedConvEntry.format}
              </div>
              {selectedConvEntry.description && (
                <div className="seq-conv-preview-desc">{selectedConvEntry.description}</div>
              )}
              {selectedConvEntry.implementation && (
                <div className="seq-conv-preview-impl">
                  <span className="seq-conv-preview-label">implementation:</span> {selectedConvEntry.implementation}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 使用先 */}
        <section className="seq-editor-section">
          <h3 className="seq-editor-section-title">使用先</h3>
          {(seq.usedBy ?? []).length > 0 && (
            <div className="seq-used-by-list">
              {(seq.usedBy ?? []).map((u, i) => {
                const tbl = tableOptions.find((t) => t.tableId === u.tableId);
                return (
                  <div key={`${u.tableId}.${u.columnId}`} className="seq-used-by-row">
                    <span className="seq-used-by-text">
                      <i className="bi bi-table" /> {tbl?.tableName ?? u.tableId}
                      <span className="seq-used-by-sep">.</span>
                      <code>{columnNameOf(u.tableId, u.columnId)}</code>
                    </span>
                    <button
                      className="seq-used-by-del"
                      onClick={() => removeUsedBy(i)}
                      title="削除"
                      disabled={isReadonly}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {addingUsedBy && !isReadonly ? (
            <div className="seq-used-by-add-form">
              <select
                value={addUsedByTableId}
                onChange={(e) => { setAddUsedByTableId(e.target.value); setAddUsedByColumnId(""); }}
              >
                <option value="">テーブルを選択...</option>
                {tableOptions.map((t) => (
                  <option key={t.tableId} value={t.tableId}>{t.tableName}</option>
                ))}
              </select>
              <select
                value={addUsedByColumnId}
                onChange={(e) => setAddUsedByColumnId(e.target.value)}
                disabled={!addUsedByTableId}
              >
                <option value="">列を選択...</option>
                {selectedTableColumns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                className="tbl-btn tbl-btn-primary"
                onClick={addUsedBy}
                disabled={!addUsedByTableId || !addUsedByColumnId}
              >
                追加
              </button>
              <button
                className="tbl-btn tbl-btn-ghost"
                onClick={() => { setAddingUsedBy(false); setAddUsedByTableId(""); setAddUsedByColumnId(""); }}
              >
                キャンセル
              </button>
            </div>
          ) : (
            <button
              className="tbl-btn tbl-btn-ghost seq-add-used-by-btn"
              onClick={() => setAddingUsedBy(true)}
              disabled={isReadonly}
            >
              <i className="bi bi-plus-lg" /> 使用先を追加
            </button>
          )}
        </section>

        </div>{/* seq-editor-left-col */}

        {/* DDL プレビュー（4K: 右カラムに常時表示） */}
        <section className="seq-editor-section seq-editor-ddl-section">
          <button
            className="seq-ddl-toggle"
            onClick={() => setDdlOpen((v) => !v)}
          >
            <i className={`bi bi-chevron-${ddlOpen ? "down" : "right"}`} />
            DDL プレビュー (CREATE SEQUENCE)
          </button>
          {ddlOpen && (
            <pre className="seq-ddl-preview">{ddl}</pre>
          )}
        </section>
      </div>
    </div>
  );
}
