import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { View, OutputColumn, PhysicalName, Uuid, Maturity, SemVer } from "../../types/v3";
import { loadView, saveView } from "../../store/viewStore";
import { listTables } from "../../store/tableStore";
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
import { generateViewDdl } from "./generateViewDdl";
import "../../styles/table.css";
import "../../styles/editMode.css";

interface TableOption {
  id: string;
  name: string;
}

export function ViewEditor() {
  const { viewId: rawId } = useParams<{ viewId: string }>();
  const viewId = rawId ? decodeURIComponent(rawId) : rawId;
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [ddlOpen, setDdlOpen] = useState(false);
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [addDepId, setAddDepId] = useState("");
  const [addColPhysical, setAddColPhysical] = useState("");
  const [addColName, setAddColName] = useState("");
  const [addColDataType, setAddColDataType] = useState("");
  const [addColDesc, setAddColDesc] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const handleNotFound = useCallback(() => navigate(wsPath("/view/list"), { replace: true }), [navigate, wsPath]);

  const sessionId = mcpBridge.getSessionId();

  const {
    state: view,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit, handleSave: resourceHandleSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<View>({
    tabType: "view",
    mtimeKind: "view",
    draftKind: "view",
    id: viewId,
    load: loadView,
    save: saveView,
    broadcastName: "viewChanged",
    broadcastIdField: "viewId",
    onNotFound: handleNotFound,
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "view",
    resourceId: viewId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  const viewRef = useRef<View | null>(null);
  useEffect(() => { viewRef.current = view ?? null; }, [view]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (s: View) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!viewId || !viewRef.current) return;
      mcpBridge.updateDraft("view", viewId, viewRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update, viewId]);

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
    if (viewId) await mcpBridge.discardDraft("view", viewId);
    await reload();
  }, [viewId, reload]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  useEffect(() => {
    if (!viewId) return;
    const tabId = makeTabId("view", viewId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [viewId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!viewId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("view", viewId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [viewId, sessionLoading, mode.kind]);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    listTables().then((metas) => {
      setTableOptions(metas.map((m) => ({ id: m.id, name: m.name || m.physicalName || m.id })));
    });
  }, [viewId]);

  if (!view || sessionLoading) {
    return <div className="table-editor-loading"><i className="bi bi-hourglass-split" /> 読み込み中...</div>;
  }

  const ddl = generateViewDdl(view);
  const selectStatementEmpty = !view.selectStatement?.trim();
  const outputColumnsEmpty = view.outputColumns.length === 0;

  const addDependency = () => {
    const dep = addDepId.trim();
    if (!dep) return;
    if ((view.dependencies ?? []).includes(dep as Uuid)) return;
    updateWithDraft((prev) => {
      (prev as unknown as { dependencies: string[] }).dependencies = [...(prev.dependencies ?? []), dep as Uuid];
    });
    setAddDepId("");
  };

  const removeDependency = (dep: Uuid) => {
    updateWithDraft((prev) => {
      (prev as unknown as { dependencies: string[] }).dependencies = (prev.dependencies ?? []).filter((d) => d !== dep);
    });
  };

  const addOutputColumn = () => {
    if (!addColPhysical.trim() || !addColDataType.trim()) return;
    const col: OutputColumn = {
      physicalName: addColPhysical.trim() as PhysicalName,
      name: addColName.trim() || undefined,
      dataType: addColDataType.trim(),
      description: addColDesc.trim() || undefined,
    };
    updateWithDraft((prev) => { prev.outputColumns = [...prev.outputColumns, col]; });
    setAddColPhysical("");
    setAddColName("");
    setAddColDataType("");
    setAddColDesc("");
    setAddingCol(false);
  };

  const removeOutputColumn = (idx: number) => {
    updateWithDraft((prev) => {
      prev.outputColumns = prev.outputColumns.filter((_, i) => i !== idx);
    });
  };

  const updateOutputColumn = (idx: number, field: keyof OutputColumn, value: string) => {
    updateWithDraft((prev) => {
      prev.outputColumns = prev.outputColumns.map((c, i) => {
        if (i !== idx) return c;
        if (field === "physicalName") return { ...c, physicalName: (value || "") as PhysicalName };
        if (field === "name") return { ...c, name: value || undefined };
        if (field === "dataType") return { ...c, dataType: value };
        if (field === "description") return { ...c, description: value || undefined };
        return c;
      });
    });
  };

  const tableNameOf = (id: string): string => tableOptions.find((t) => t.id === id)?.name ?? id;

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

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
        title={<><i className="bi bi-eye" /> ビュー編集: <code>{view.physicalName}</code></>}
        backLink={{
          label: "ビュー一覧",
          onClick: () => navigate(wsPath("/view/list")),
        } satisfies EditorHeaderBackLink}
        saveReset={isReadonly ? undefined : {
          isDirty,
          isSaving,
          onSave: handleSave,
          onReset: () => setShowDiscardDialog(true),
        } satisfies EditorHeaderSaveReset}
      />

      <div className="seq-editor-body">
        {/* 左カラム（基本設定・SELECT・依存テーブル・出力列） */}
        <div className="seq-editor-left-col">

          {/* 基本設定 */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">基本設定</h3>
            <div className="seq-editor-grid">
              <label className="tbl-field">
                <span>物理名</span>
                <input
                  type="text"
                  value={view.physicalName}
                  readOnly
                  className="seq-readonly"
                  title="物理名は作成後変更できません"
                />
              </label>
              <label className="tbl-field">
                <span>表示名</span>
                <input
                  type="text"
                  value={view.name}
                  onChange={(e) => updateWithDraft((prev) => { prev.name = e.target.value; })}
                  placeholder="顧客最終購入日ビュー"
                  disabled={isReadonly}
                />
              </label>
              <label className="tbl-field">
                <span>説明</span>
                <input
                  type="text"
                  value={view.description ?? ""}
                  onChange={(e) => updateWithDraft((prev) => { prev.description = e.target.value || undefined; })}
                  placeholder="顧客に最終購入日を結合した表示用ビュー"
                  disabled={isReadonly}
                />
              </label>
              <label className="tbl-field">
                <span>成熟度</span>
                {/* draft-state ポリシー #5: maturity は全リソースで必須選択。
                    既存データに maturity 欠落があれば "draft" として扱い、UI からは undefined に戻せない。 */}
                <select
                  value={view.maturity ?? "draft"}
                  onChange={(e) =>
                    updateWithDraft((prev) => { prev.maturity = e.target.value as Maturity; })
                  }
                  disabled={isReadonly}
                >
                  <option value="draft">draft（下書き）</option>
                  <option value="provisional">provisional（暫定）</option>
                  <option value="committed">committed（確定）</option>
                </select>
              </label>
              <label className="tbl-field">
                <span>バージョン</span>
                <input
                  type="text"
                  value={view.version ?? ""}
                  onChange={(e) =>
                    updateWithDraft((prev) => { prev.version = (e.target.value || undefined) as SemVer | undefined; })
                  }
                  placeholder="1.0.0"
                  pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
                  disabled={isReadonly}
                />
              </label>
              <label className="tbl-field seq-field-checkbox">
                <span>マテリアライズドビュー</span>
                <label className="seq-checkbox-label">
                  <input
                    type="checkbox"
                    checked={view.materialized ?? false}
                    onChange={(e) =>
                      updateWithDraft((prev) => { prev.materialized = e.target.checked || undefined; })
                    }
                    disabled={isReadonly}
                  />
                  実体テーブルとして保持 (CREATE MATERIALIZED VIEW)
                </label>
              </label>
            </div>
          </section>

          {/* SELECT 文 */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              SELECT 文
              {selectStatementEmpty && (
                <span className="view-editor-section-marker" style={{ color: "red", marginLeft: 6 }} title="SELECT 文が必須です">⚠️</span>
              )}
            </h3>
            <textarea
              className="view-editor-select-stmt"
              value={view.selectStatement}
              onChange={(e) => { if (!isReadonly) updateSilent((prev) => { prev.selectStatement = e.target.value; }); }}
              onBlur={() => { if (!isReadonly) commit(); }}
              rows={10}
              placeholder={`SELECT\n  c.customer_id,\n  c.customer_name,\n  MAX(o.created_at) AS last_order_at\nFROM customers c\nLEFT JOIN orders o ON c.customer_id = o.customer_id\nGROUP BY c.customer_id, c.customer_name`}
              spellCheck={false}
              disabled={isReadonly}
            />
          </section>

          {/* 依存テーブル */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">依存テーブル</h3>
            {(view.dependencies ?? []).length > 0 && (
              <div className="seq-used-by-list">
                {(view.dependencies ?? []).map((dep) => (
                  <div key={dep} className="seq-used-by-row">
                    <span className="seq-used-by-text">
                      <i className="bi bi-table" /> {tableNameOf(dep)}
                    </span>
                    <button
                      className="seq-used-by-del"
                      onClick={() => removeDependency(dep)}
                      title="削除"
                      disabled={isReadonly}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="view-editor-dep-add">
              <select
                value={addDepId}
                onChange={(e) => setAddDepId(e.target.value)}
                className="view-editor-dep-input"
              >
                <option value="">テーブルを選択...</option>
                {tableOptions
                  .filter((t) => !(view.dependencies ?? []).includes(t.id as Uuid))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
              <button
                className="tbl-btn tbl-btn-ghost"
                onClick={addDependency}
                disabled={!addDepId || isReadonly}
              >
                <i className="bi bi-plus-lg" /> 追加
              </button>
            </div>
          </section>

          {/* 出力列 */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              出力列
              {outputColumnsEmpty && (
                <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title={"\u51fa\u529b\u5217\u304c\u672a\u5b9a\u7fa9\u3067\u3059"}>{"\u26A0\uFE0F"}</span>
              )}
              <button
                className="tbl-btn tbl-btn-ghost view-editor-col-add-btn"
                onClick={() => setAddingCol(true)}
                disabled={isReadonly}
              >
                <i className="bi bi-plus-lg" /> 追加
              </button>
            </h3>

            {view.outputColumns.length > 0 && (
              <div className="view-editor-col-list">
                {view.outputColumns.map((col, i) => (
                  <div key={i} className="view-editor-col-row">
                    <input
                      type="text"
                      value={col.physicalName}
                      onChange={(e) => updateOutputColumn(i, "physicalName", e.target.value)}
                      placeholder="物理名 (snake_case)"
                      className="view-editor-col-name"
                      disabled={isReadonly}
                    />
                    <input
                      type="text"
                      value={col.name ?? ""}
                      onChange={(e) => updateOutputColumn(i, "name", e.target.value)}
                      placeholder="表示名（省略可）"
                      className="view-editor-col-name"
                      disabled={isReadonly}
                    />
                    <input
                      type="text"
                      value={col.dataType}
                      onChange={(e) => updateOutputColumn(i, "dataType", e.target.value)}
                      placeholder="データ型 (例: VARCHAR, INTEGER)"
                      className="view-editor-col-type"
                      disabled={isReadonly}
                    />
                    <input
                      type="text"
                      value={col.description ?? ""}
                      onChange={(e) => updateOutputColumn(i, "description", e.target.value)}
                      placeholder="説明（省略可）"
                      className="view-editor-col-desc"
                      disabled={isReadonly}
                    />
                    <button
                      className="seq-used-by-del"
                      onClick={() => removeOutputColumn(i)}
                      title="削除"
                      disabled={isReadonly}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingCol && (
              <div className="view-editor-col-add-form">
                <input
                  type="text"
                  value={addColPhysical}
                  onChange={(e) => setAddColPhysical(e.target.value)}
                  placeholder="物理名 (例: customer_id)"
                  autoFocus
                />
                <input
                  type="text"
                  value={addColName}
                  onChange={(e) => setAddColName(e.target.value)}
                  placeholder="表示名（省略可）"
                />
                <input
                  type="text"
                  value={addColDataType}
                  onChange={(e) => setAddColDataType(e.target.value)}
                  placeholder="データ型 (例: VARCHAR, INTEGER, TIMESTAMP)"
                />
                <input
                  type="text"
                  value={addColDesc}
                  onChange={(e) => setAddColDesc(e.target.value)}
                  placeholder="説明（省略可）"
                />
                <button
                  className="tbl-btn tbl-btn-primary"
                  onClick={addOutputColumn}
                  disabled={!addColPhysical.trim() || !addColDataType.trim() || isReadonly}
                >
                  追加
                </button>
                <button
                  className="tbl-btn tbl-btn-ghost"
                  onClick={() => { setAddingCol(false); setAddColPhysical(""); setAddColName(""); setAddColDataType(""); setAddColDesc(""); }}
                >
                  キャンセル
                </button>
              </div>
            )}
          </section>

        </div>{/* seq-editor-left-col */}

        {/* DDL プレビュー */}
        <section className="seq-editor-section seq-editor-ddl-section">
          <button
            className="seq-ddl-toggle"
            onClick={() => setDdlOpen((v) => !v)}
          >
            <i className={`bi bi-chevron-${ddlOpen ? "down" : "right"}`} />
            DDL プレビュー ({view.materialized ? "CREATE MATERIALIZED VIEW" : "CREATE OR REPLACE VIEW"})
          </button>
          {ddlOpen && (
            <pre className="seq-ddl-preview">{ddl}</pre>
          )}
        </section>
      </div>
    </div>
  );
}
