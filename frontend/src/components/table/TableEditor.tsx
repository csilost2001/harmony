import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { Table, Column, BuiltinDataType, PhysicalName, DisplayName, LocalId, Maturity, SemVer } from "../../types/v3";
import {
  DATA_TYPE_LABELS,
  COLUMN_TEMPLATES,
  DATA_TYPES_WITH_LENGTH,
  DATA_TYPES_WITH_SCALE,
  TABLE_CATEGORIES,
  type ColumnTemplate,
} from "./tableConstants";
import type { SqlDialect } from "../../utils/ddlGenerator";
import { loadTable, saveTable, addColumn, removeColumn } from "../../store/tableStore";
import { listTables, loadAllTables } from "../../store/tableStore";
import { generateDdl, generateTableMarkdown } from "../../utils/ddlGenerator";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useDetailPanelKeyboard } from "../../hooks/useDetailPanelKeyboard";
import { useListSort } from "../../hooks/useListSort";
import { EditorHeader } from "../common/EditorHeader";
import { RenameEntityDialog } from "../common/RenameEntityDialog";
import { PasteColumnsDialog } from "./PasteColumnsDialog";
import { showToast } from "../../utils/toast";
import { isPasteIntoField, looksLikeSpreadsheet } from "../../utils/pasteDetect";
import { columnsToTsv, type ParsedColumn } from "../../utils/columnPaste";
import { ReferencesButton } from "../common/ReferencesButton";
import { RenameEntityUndoToast } from "../common/RenameEntityUndoToast";
import { useRenameEntityUndoToast } from "../common/useRenameEntityUndoToast";
import { handleRenameSuccess } from "../../utils/handleRenameSuccess";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { DataList, type DataListColumn } from "../common/DataList";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { DdlPreviewDrawer } from "./DdlPreviewDrawer";
import { ConstraintsTab } from "./ConstraintsTab";
import { IndexesTab } from "./IndexesTab";
import { TriggersDefaultsTab } from "./TriggersDefaultsTab";
import { renumber } from "../../utils/listOrder";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog, AfterForceUnlockChoiceDialog } from "../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import "../../styles/table.css";
import "../../styles/editMode.css";
import { reportFailure } from "../../utils/failureToast";
import { useResyncDraftOnReconnect } from "../../hooks/useResyncDraftOnReconnect";
import { EmptyState } from "../common/EmptyState";
import { conflictingPhysicalNames, planColumnPaste } from "../../utils/columnClipboard";
import { BulkEditDialog } from "../common/BulkEditDialog";
import { applyBulkPatch } from "../../utils/bulkEdit";
import { COLUMN_BULK_FIELDS } from "./bulkColumnFields";
import { SnippetMenu } from "../common/SnippetMenu";
import { ColumnGrid } from "./ColumnGrid";
import { useColumnSuggestionSource } from "../../hooks/useColumnSuggestionSource";
import { planColumnAutofill } from "../../utils/columnSuggestion";
import { usePersistentState } from "../../hooks/usePersistentState";
import { HelpHint } from "../help/HelpHint";

type TabId = "columns" | "constraints" | "indexes" | "triggers" | "comment";

export function TableEditor() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  const [tab, setTab] = useState<TabId>("columns");
  const [ddlDialect, setDdlDialect] = useState<SqlDialect>("postgresql");
  const ddlOpen = window.innerWidth >= 2560;
  const [editingMeta, setEditingMeta] = useState(false);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  // #1298 I-6 (RFC #1284): id rename refactor 用 state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  // Phase M Codex SF-1 (#1298 round 8): wsId scoped key
  const [renameUndoToast, setRenameUndoToast] = useRenameEntityUndoToast("table", tableId, wsId);

  const handleNotFound = useCallback(() => navigate(wsPath("/table/list"), { replace: true }), [navigate, wsPath]);

  const sessionId = mcpBridge.getSessionId();

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { syncSessionToUrl, initialEditSessionId: initialTableSessionId } = useSessionUrlSync({
    resourceType: "table",
    resourceId: tableId ?? "",
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  // #891 fix: useResourceEditor より前に呼び出し、viewerMode / viewerEditSessionId を渡せるようにする
  const { editSession, mode, loading: sessionLoading, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "table",
    resourceId: tableId ?? "",
    sessionId,
    editSessionId: initialTableSessionId,
  });

  const {
    state: table,
    isDirty, isSaving, serverChanged,
    update, undo, redo, canUndo, canRedo, history, jumpTo,
    postSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<Table>({
    tabType: "table",
    mtimeKind: "table",
    draftKind: "table",
    id: tableId,
    load: loadTable,
    save: saveTable,
    broadcastName: "tableChanged",
    broadcastIdField: "tableId",
    onNotFound: handleNotFound,
    // #891 fix: viewer mode で mid-edit broadcast を受信するため渡す
    // 新 API では "viewer" | "editing" | "readonly" の 3 値のみ返す (legacy 値は発生しない)
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: "table",
    viewerEditSessionId: editSession?.id,
    // I-7 Round 3 G-5 (#1299 Codex S-R2-1): rename-in-progress 判定の wsId scoping
    wsId,
  });

  const isReadonly = mode.kind !== "editing";

  // #960: 「作成して編集」経由で sessionStorage に flag があれば auto-edit モードで開く。
  const autoEditFiredRef = useRef(false);
  useEffect(() => {
    if (autoEditFiredRef.current) return;
    if (!tableId) return;
    if (mode.kind !== "readonly") return;
    if (sessionLoading) return;
    const key = `harmony-auto-edit:table:${tableId}`;
    if (sessionStorage.getItem(key) !== "1") return;
    autoEditFiredRef.current = true;
    sessionStorage.removeItem(key);
    void actions.startEditing();
  }, [tableId, mode.kind, sessionLoading, actions]);

  const tableRef = useRef<Table | null>(null);
  useEffect(() => { tableRef.current = table ?? null; }, [table]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (t: Table) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!tableId || !tableRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: tableRef.current }).catch((err) => reportFailure(err, "下書きの保存"));
      }
    }, 300);
  }, [isReadonly, update, tableId, editSession]);

  // 接続が切れて戻ったとき、編集中の内容を下書きへ送り直す
  useResyncDraftOnReconnect(!isReadonly && !!editSession?.id, isDirty, () => {
    if (editSession?.id && tableRef.current) mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: tableRef.current }).catch((err) => reportFailure(err, "下書きの保存"));
  });

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    // P1 fix (#908 round-5): debounce 中の draft を flush して即送信、その後 conflict check
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (tableRef.current && editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: tableRef.current });
    }
    // P1 fix (#908): conflict 時は postSave をスキップして clean 化を防ぐ。
    const { conflicted, failed } = await actions.save();
    if (conflicted || failed) return;
    await postSave();
  }, [isReadonly, isSaving, actions, postSave, editSession]);

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
    await actions.discard();
    await reload();
  }, [actions, reload]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  useEffect(() => {
    if (!tableId) return;
    const tabId = makeTabId("table", tableId);
    setTabDirty(tabId, isDirty);
  }, [tableId, isDirty]);

  useEffect(() => {
    if (!tableId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      // workspace context が未確立の場合 WorkspaceUnsetError が返ることがあるため最大 25 回 retry する (200ms × 25 = 5s)
      for (let attempt = 0; attempt < 25 && !cancelled; attempt++) {
        try {
          const res = await mcpBridge.request("editSession.list", { resourceType: "table", resourceId: tableId }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
          if (cancelled) return;
          // #980-A: 自分が participant として参加していた Active session のみ対象。
          // 他人の Active session で自分が unparticipated の場合は ResumeOrDiscardDialog を出さない。
          const mySessionId = mcpBridge.getSessionId();
          const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
            s.state === "Active" && !!s.participants?.[mySessionId],
          );
          if (hasMyActiveSession) setShowResumeDialog(true);
          return;
        } catch (err) {
          if (cancelled) return;
          const msg = String((err as Error)?.message ?? err);
          if (!msg.includes("WorkspaceUnset") && !msg.includes("workspace not")) {
            console.error(err);
            return;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tableId, sessionLoading, mode.kind]);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    (async () => {
      setAllTables(await loadAllTables()); // 全テーブルを 1 回の問い合わせで
    })();
  }, [tableId]);

  if (!table || sessionLoading) {
    return <div className="table-editor-loading"><i className="bi bi-hourglass-split" /> 読み込み中...</div>;
  }

  const ddl = generateDdl(table, ddlDialect, allTables);
  const columnsEmpty = table.columns.length === 0;
  const primaryKeyEmpty = !table.columns.some((column) => column.primaryKey);
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
        dirty={isDirty}
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

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={async () => {
            try {
              await onSaveConflictOverwrite();
              await postSave();
            } catch (e) {
              console.error("[TableEditor] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      <EditorHeader
        variant="dark"
        backLink={{ label: "テーブル一覧", onClick: () => navigate(wsPath("/table/list")) }}
        title={
          editingMeta && !isReadonly ? (
            <TableMetaEditor
              table={table}
              onSave={(patch) => {
                updateWithDraft((t) => Object.assign(t, patch));
                setEditingMeta(false);
              }}
              onCancel={() => setEditingMeta(false)}
            />
          ) : (
            <div
              className="table-editor-title"
              onClick={() => { if (!isReadonly) setEditingMeta(true); }}
              title={isReadonly ? undefined : "クリックして編集"}
            >
              <span className="table-name-display">{table.physicalName}</span>
              <span className="table-logical-display">{table.name}</span>
              {table.category && <span className="table-category-badge">{table.category}</span>}
              {!isReadonly && <i className="bi bi-pencil table-edit-icon" />}
            </div>
          )
        }
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo, history, present: table, onJump: jumpTo }}
        extraRight={
          <>
            <EditSessionDropdown
              resourceType="table"
              resourceId={tableId ?? ""}
              currentMode={mode}
              currentSessionId={sessionId}
              onStartEditing={() => { void actions.startEditing(); }}
              onViewerAttached={syncSessionToUrl}
              onAttachAsView={attach}
              onTakeOver={takeOver}
            />
            {tableId && <ReferencesButton compact entityType="table" id={tableId} name={table.physicalName || table.name || ""} />}
            {/* #1298 I-6 (RFC #1284): id rename refactor */}
            <button
              className="editor-header-undo-btn"
              onClick={() => setShowRenameDialog(true)}
              disabled={isReadonly || isDirty}
              title={
                isReadonly
                  ? "編集モードに切り替えてから id を変更できます"
                  : isDirty
                  ? "未保存の変更があります。保存または破棄してから id を変更してください"
                  : "id を変更 (rename refactor)"
              }
              data-testid="rename-entity-open-btn-table"
            >
              <i className="bi bi-tag" />
            </button>
            <button
              className="editor-header-undo-btn"
              onClick={() => {
                const md = generateTableMarkdown(table);
                navigator.clipboard.writeText(md)
                  .then(() => showToast("Markdown をコピーしました"))
                  .catch(() => showToast("コピーできませんでした (ブラウザが許可していません)", "error"));
              }}
              title="Markdown をコピー"
              aria-label="Markdown をコピー"
            >
              <i className="bi bi-clipboard" />
            </button>
            <button
              className="editor-header-undo-btn"
              onClick={() => {
                navigator.clipboard.writeText(columnsToTsv(table.columns))
                  .then(() => showToast("Excel 用の表 (タブ区切り) をコピーしました"))
                  .catch(() => showToast("コピーできませんでした (ブラウザが許可していません)", "error"));
              }}
              title="カラムを Excel 用の表 (タブ区切り) としてコピー"
              aria-label="カラムを Excel 用の表としてコピー"
              data-testid="copy-columns-tsv"
            >
              <i className="bi bi-file-earmark-spreadsheet" />
            </button>
          </>
        }
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: () => setShowDiscardDialog(true) }}
      />

      <div className="table-editor-tabs">
        <button className={tab === "columns" ? "active" : ""} onClick={() => setTab("columns")}>
          <i className="bi bi-columns-gap" /> 列 <span className="tab-count">{table.columns.length}</span>
          {(columnsEmpty || primaryKeyEmpty) && (
            <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title={columnsEmpty ? "カラムが未定義です" : "主キーが未指定です"}>{"⚠️"}</span>
          )}
        </button>
        <button className={tab === "constraints" ? "active" : ""} onClick={() => setTab("constraints")}>
          <i className="bi bi-shield-check" /> 制約
          {(table.constraints?.length ?? 0) > 0 && (
            <span className="tab-count">{table.constraints?.length}</span>
          )}
        </button>
        <button className={tab === "indexes" ? "active" : ""} onClick={() => setTab("indexes")}>
          <i className="bi bi-lightning" /> インデックス <span className="tab-count">{table.indexes?.length ?? 0}</span>
        </button>
        <button className={tab === "triggers" ? "active" : ""} onClick={() => setTab("triggers")}>
          <i className="bi bi-play-btn" /> トリガー/DEFAULT
          {((table.triggers?.length ?? 0) + (table.defaults?.length ?? 0)) > 0 && (
            <span className="tab-count">{(table.triggers?.length ?? 0) + (table.defaults?.length ?? 0)}</span>
          )}
        </button>
        <button className={tab === "comment" ? "active" : ""} onClick={() => setTab("comment")}>
          <i className="bi bi-chat-left-text" /> コメント
        </button>
      </div>

      <div className="table-editor-content-area">
        <div className="table-editor-body">
          {tab === "columns" && (
            <ColumnsTab table={table} update={isReadonly ? () => {} : updateWithDraft} isReadonly={isReadonly} />
          )}
          {tab === "constraints" && (
            <ConstraintsTab table={table} update={isReadonly ? () => {} : updateWithDraft} allTables={allTables} />
          )}
          {tab === "indexes" && (
            <IndexesTab key="indexes" table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
          {tab === "triggers" && (
            <TriggersDefaultsTab table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
          {tab === "comment" && (
            <CommentTab table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
        </div>

        <DdlPreviewDrawer
          ddl={ddl}
          dialect={ddlDialect}
          onDialectChange={setDdlDialect}
          defaultOpen={ddlOpen}
          diff={{ table, allTables }}
        />
      </div>

      {/* #1298 I-6 (RFC #1284): id rename refactor dialog */}
      {showRenameDialog && tableId && (
        <RenameEntityDialog
          entityType="table"
          currentId={tableId}
          currentName={table.physicalName || table.name || ""}
          existingIds={allTables.map((t) => t.id)}
          // Phase J SF-α (#1298 round 5 Opus SF-1): dialog open 時の existingIds rehydration
          fetchExistingIds={async () => (await listTables()).map((t) => t.id)}
          onClose={() => setShowRenameDialog(false)}
          onSuccess={(newId, operationId, extra) => {
            setShowRenameDialog(false);
            handleRenameSuccess({
              entityType: "table",
              oldId: tableId,
              newId,
              label: table.physicalName || table.name || newId,
              navigate,
              wsPath,
              wsId,
            });
            setRenameUndoToast({
              operationId, oldId: tableId, newId,
              ttlMs: extra?.ttlMs,
            });
          }}
        />
      )}

      {/* rename 成功直後の undo toast (5 分 TTL) */}
      {renameUndoToast && (
        <RenameEntityUndoToast
          operationId={renameUndoToast.operationId}
          oldId={renameUndoToast.oldId}
          newId={renameUndoToast.newId}
          ttlMs={renameUndoToast.ttlMs}
          entityLabel="テーブル定義"
          onUndo={() => {
            // undo 後、旧 id の編集ページに戻す
            handleRenameSuccess({
              entityType: "table",
              oldId: renameUndoToast.newId,
              newId: renameUndoToast.oldId,
              label: table.physicalName || table.name || renameUndoToast.oldId,
              navigate,
              wsPath,
              wsId,
            });
            setRenameUndoToast(null);
          }}
          onDismiss={() => setRenameUndoToast(null)}
        />
      )}
    </div>
  );
}

// ── メタ情報編集 ──────────────────────────────────────────────────────────────

function TableMetaEditor({
  table, onSave, onCancel,
}: {
  table: Table;
  onSave: (patch: Partial<Table>) => void;
  onCancel: () => void;
}) {
  const [physicalName, setPhysicalName] = useState<string>(table.physicalName);
  const [name, setName] = useState<string>(table.name);
  const [description, setDescription] = useState<string>(table.description ?? "");
  const [category, setCategory] = useState<string>(table.category ?? "");
  const [maturity, setMaturity] = useState<string>(table.maturity ?? "");
  const [version, setVersion] = useState<string>(table.version ?? "");
  const physicalNameEmpty = !physicalName.trim();

  return (
    <div className="table-meta-editor">
      <input
        className="table-meta-input name"
        value={physicalName}
        onChange={(e) => setPhysicalName(e.target.value)}
        placeholder="物理名 (snake_case)"
        autoFocus
      />
      {physicalNameEmpty && (
        <span className="view-editor-section-marker" style={{ color: "red", marginLeft: 2 }} title="物理名が必須です">{"\u26A0\uFE0F"}</span>
      )}
      <input
        className="table-meta-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="表示名"
      />
      <input
        className="table-meta-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="説明"
      />
      <select className="table-meta-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">カテゴリなし</option>
        {TABLE_CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select className="table-meta-input" value={maturity} onChange={(e) => setMaturity(e.target.value)}>
        <option value="">成熟度: 未指定</option>
        <option value="draft">draft（下書き）</option>
        <option value="provisional">provisional（暫定）</option>
        <option value="committed">committed（確定）</option>
      </select>
      <input
        className="table-meta-input"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="バージョン (SemVer 例: 1.0.0)"
        pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
      />
      <div className="table-meta-btns">
        <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={onCancel}>キャンセル</button>
        <button
          className="tbl-btn tbl-btn-primary tbl-btn-sm"
          onClick={() =>
            onSave({
              physicalName: physicalName.trim() as PhysicalName,
              name: name.trim() as DisplayName,
              description: description || undefined,
              category: category || undefined,
              maturity: (maturity || undefined) as Maturity | undefined,
              version: (version || undefined) as SemVer | undefined,
            })
          }
          disabled={!physicalName.trim() || !name.trim()}
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ── カラムタブ ────────────────────────────────────────────────────────────────

function ColumnsTab({
  table, update, isReadonly = false,
}: {
  table: Table;
  update: (fn: (t: Table) => void) => void;
  /** 閲覧中 (編集を始めていない)。追加の操作を止める */
  isReadonly?: boolean;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteInitial, setPasteInitial] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [activeColId, setActiveColId] = useState<string | null>(null);

  const sortAccessor = useCallback((col: Column, key: string): string | number => {
    switch (key) {
      case "physicalName": return col.physicalName;
      case "name": return col.name;
      case "dataType": return col.dataType;
      case "length": return col.length ?? 0;
      case "notNull": return col.notNull ? 1 : 0;
      case "primaryKey": return col.primaryKey ? 1 : 0;
      case "unique": return col.unique ? 1 : 0;
      case "autoIncrement": return col.autoIncrement ? 1 : 0;
      case "defaultValue": return col.defaultValue ?? "";
      default: return "";
    }
  }, []);

  const sort = useListSort(table.columns, sortAccessor);
  const selection = useListSelection(sort.sorted, (c) => c.id);
  // 別のテーブルへも運べる共有のクリップボード (カラムの種類ごと)
  const [showBulk, setShowBulk] = useState(false);
  // 「表で編集」(セルを選んでその場で編集) と「一覧で編集」(行を選んで、パネルで編集。コピー・並べ替え・一括変更ができる) の切り替え
  const [gridMode, setGridMode] = usePersistentState<boolean>("harmony.columns.gridMode", false);
  const clipboard = useListClipboard<Column>((c) => c.id, { channel: "columns", sourceId: table.id });

  // FK column id 集合 (ColumnsTab で FK アイコン表示用)
  const fkColumnIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of table.constraints ?? []) {
      if (c.kind === "foreignKey") {
        for (const id of c.columnIds) set.add(id);
      }
    }
    return set;
  }, [table.constraints]);

  const suggestionSource = useColumnSuggestionSource(table.id);
  const handleUpdateCol = useCallback((colId: string, patch: Partial<Column>) => {
    // 新しく足した列に表示名を入れたら、物理名・型・長さも埋める (決めた値は変えない。Ctrl+Z で戻せる)
    let merged = patch;
    const current = table.columns.find((c) => c.id === colId);
    if (current && typeof patch.name === "string") {
      const plan = planColumnAutofill(current, patch.name, table.columns.filter((c) => c.id !== colId), suggestionSource.index, suggestionSource.convention);
      if (plan) {
        merged = { ...plan.patch, ...patch } as Partial<Column>;
        showToast(plan.message, "info");
      }
    }
    update((t) => {
      const col = t.columns.find((c) => c.id === colId);
      if (col) Object.assign(col, merged);
    });
  }, [update, table.columns, suggestionSource]);

  const handleAddBlank = () => {
    let newColId: string = "";
    update((t) => { newColId = addColumn(t).id; });
    selection.setSelectedIds(new Set<string>([newColId]));
    setActiveColId(newColId);
  };

  const handlePasteColumns = (cols: ParsedColumn[], updates: Array<{ id: string; patch: Partial<Column> }>) => {
    const newIds: string[] = [];
    update((t) => {
      for (const u of updates) {
        const target = t.columns.find((c) => c.id === u.id);
        if (target) Object.assign(target, u.patch);
      }
      for (const c of cols) {
        // 既存のカラム ID と重ならない ID を付ける
        let n = t.columns.length + 1;
        while (t.columns.some((x) => x.id === `col-${String(n).padStart(2, "0")}`)) n++;
        newIds.push(addColumn(t, { ...c, id: `col-${String(n).padStart(2, "0")}` as Column["id"], physicalName: c.physicalName as PhysicalName, name: c.name as DisplayName }).id);
      }
    });
    if (newIds.length > 0) {
      selection.setSelectedIds(new Set<string>(newIds));
      setActiveColId(newIds[newIds.length - 1]);
    }
  };

  const handleAddFromTemplate = (tpl: ColumnTemplate) => {
    let newColId: string = "";
    update((t) => { newColId = addColumn(t, { ...tpl.column }).id; });
    selection.setSelectedIds(new Set<string>([newColId]));
    setActiveColId(newColId);
    setShowTemplates(false);
  };

  const handleDelete = (cols: Column[]) => {
    const ids = new Set(cols.map((c) => c.id));
    update((t) => {
      for (const id of ids) removeColumn(t, id);
    });
    selection.clearSelection();
    if (activeColId && ids.has(activeColId as LocalId)) setActiveColId(null);
  };

  const handleDuplicate = (cols: Column[]) => {
    const newIds: string[] = [];
    update((t) => {
      for (const src of cols) {
        const cur = t.columns.find((c) => c.id === src.id);
        if (!cur) continue;
        newIds.push(addColumn(t, { ...cur, physicalName: (cur.physicalName + "_copy") as PhysicalName }).id);
      }
    });
    selection.setSelectedIds(new Set<string>(newIds));
  };

  const moveBlock = (cols: Column[], direction: "up" | "down") => {
    const ids = new Set(cols.map((c) => c.id));
    update((t) => {
      const idxs = t.columns
        .map((c, i) => (ids.has(c.id) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (idxs.length === 0) return;
      if (direction === "up") {
        if (idxs[0] === 0) return;
        const [moved] = t.columns.splice(idxs[0] - 1, 1);
        t.columns.splice(idxs[idxs.length - 1], 0, moved);
      } else {
        if (idxs[idxs.length - 1] === t.columns.length - 1) return;
        const [moved] = t.columns.splice(idxs[idxs.length - 1] + 1, 1);
        t.columns.splice(idxs[0], 0, moved);
      }
      t.columns = renumber(t.columns);
    });
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    update((t) => {
      const [moved] = t.columns.splice(fromIdx, 1);
      t.columns.splice(toIdx, 0, moved);
      t.columns = renumber(t.columns);
    });
  };

  const handlePaste = (insertIdx: number | null) => {
    const foreign = clipboard.isForeign;
    // 別のテーブルから切り取ったものは、元のテーブルから消せないので、コピーとして貼る
    const mode = foreign ? "copy" : clipboard.clipboard.mode;
    const clipItems = clipboard.clipboard.items;
    if (!clipItems.length) return;

    if (mode === "cut") {
      const cutIds = new Set(clipItems.map((c) => c.id));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size &&
        [...selIds].every((id) => cutIds.has(id as LocalId));
      if (sameSet) return;
    }

    // 別のテーブルから貼るとき、同じ物理名のカラムがあれば、先に確認する
    if (foreign) {
      const conflicts = conflictingPhysicalNames(table.columns, clipItems);
      if (conflicts.length > 0 && !window.confirm(`このテーブルには、同じ物理名のカラムがあります: ${conflicts.join(", ")}\n物理名に「_copy」を付けて貼り付けますか?`)) return;
    }

    const consumed = clipboard.consume();
    const newIds: string[] = [];
    let notice = "";

    update((t) => {
      if (mode === "cut") {
        const cutIds = new Set(consumed.map((c) => c.id));
        const pos0 = insertIdx ?? t.columns.length;
        const removedBefore = t.columns.slice(0, pos0).filter((c) => cutIds.has(c.id)).length;
        t.columns = t.columns.filter((c) => !cutIds.has(c.id));
        const pos = Math.min(t.columns.length, pos0 - removedBefore);
        t.columns.splice(pos, 0, ...consumed);
        newIds.push(...consumed.map((c) => c.id));
      } else {
        // copy: 新しい ID・重ならない物理名を付けて追加する
        const plan = planColumnPaste(t.columns, consumed, foreign);
        for (const c of plan.columns) newIds.push(addColumn(t, c).id);
        const parts: string[] = [];
        if (plan.renamed.length > 0) parts.push(`物理名を変えたカラム ${plan.renamed.length} 件 (${plan.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")})`);
        if (plan.droppedKeys > 0) parts.push(`主キー・自動採番の印を外したカラム ${plan.droppedKeys} 件`);
        if (foreign && parts.length > 0) notice = parts.join(" / ");
        // 挿入位置は addColumn が末尾に置くため、ここで insertIdx に並べ替える
        if (insertIdx != null && insertIdx < t.columns.length) {
          const moved = t.columns.splice(t.columns.length - newIds.length, newIds.length);
          t.columns.splice(insertIdx, 0, ...moved);
        }
      }
      t.columns = renumber(t.columns);
    });
    selection.setSelectedIds(new Set<string>(newIds));
    if (foreign) showToast(`${newIds.length} 件のカラムを貼り付けました${notice ? `: ${notice}` : ""}`, "info");
  };

  const sortActive = sort.sortKeys.length > 0;

  const buildMenuItems = (target: Column | null): ContextMenuItem[] => {
    const hasSelection = selection.selectedIds.size > 0 || target !== null;
    const pasteBlocked = sortActive || !clipboard.hasContent;
    const pasteReason = sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "クリップボードが空";
    const sortReason = "ソート中は無効 (ソート解除で利用可能)";

    if (target === null && selection.selectedIds.size === 0) {
      return [
        {
          key: "addCol", label: "カラム追加", icon: "bi-plus-lg",
          disabled: sortActive, disabledReason: sortReason,
          onClick: handleAddBlank,
        },
        {
          key: "addTpl", label: "テンプレートから追加", icon: "bi-collection",
          disabled: sortActive, disabledReason: sortReason,
          onClick: () => setShowTemplates(true),
        },
        {
          key: "pasteTable", label: "表から貼り付け", icon: "bi-clipboard-data",
          disabled: sortActive, disabledReason: sortReason,
          onClick: () => setShowPaste(true),
        },
      ];
    }

    const items = target && !selection.isSelected(target.id)
      ? [target]
      : selection.selectedItems;

    return [
      {
        key: "addCol", label: "カラム追加", icon: "bi-plus-lg",
        disabled: sortActive, disabledReason: sortReason,
        onClick: handleAddBlank,
      },
      {
        key: "addTpl", label: "テンプレートから追加", icon: "bi-collection",
        disabled: sortActive, disabledReason: sortReason,
        onClick: () => setShowTemplates(true),
      },
      { key: "sep1", separator: true },
      {
        key: "copy", label: "コピー", icon: "bi-files", shortcut: "Ctrl+C",
        disabled: !hasSelection,
        onClick: () => { if (items.length > 0) clipboard.copy(items); },
      },
      {
        key: "cut", label: "切り取り", icon: "bi-scissors", shortcut: "Ctrl+X",
        disabled: !hasSelection,
        onClick: () => { if (items.length > 0) clipboard.cut(items); },
      },
      {
        key: "paste", label: "貼り付け", icon: "bi-clipboard", shortcut: "Ctrl+V",
        disabled: pasteBlocked, disabledReason: pasteBlocked && sortActive ? sortReason : pasteReason,
        onClick: () => {
          const ids = Array.from(selection.selectedIds);
          const allIds = (table?.columns ?? []).map((c) => c.id as string);
          const insertIndex = ids.length > 0
            ? Math.max(...ids.map((id) => allIds.indexOf(id))) + 1
            : null;
          handlePaste(insertIndex);
        },
      },
      { key: "sep2", separator: true },
      {
        key: "moveUp", label: "上へ移動", icon: "bi-chevron-up", shortcut: "Alt+↑",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) moveBlock(items, "up"); },
      },
      {
        key: "moveDown", label: "下へ移動", icon: "bi-chevron-down", shortcut: "Alt+↓",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) moveBlock(items, "down"); },
      },
      { key: "sep3", separator: true },
      {
        key: "duplicate", label: "複製", icon: "bi-copy", shortcut: "Ctrl+D",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) handleDuplicate(items); },
      },
      { key: "sep4", separator: true },
      {
        key: "delete", label: "削除", icon: "bi-trash", shortcut: "Delete",
        disabled: !hasSelection, danger: true,
        onClick: () => { if (items.length > 0) handleDelete(items); },
      },
    ];
  };

  const handleContextMenu = (e: React.MouseEvent, target: Column | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: Column | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set<string>([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (c: Column) => {
    handleDelete([c]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (c) => c.id,
    selection,
    clipboard,
    sort,
    layout: "list",
    onActivate: (c) => setActiveColId(c.id),
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    onMoveUp: (cols) => moveBlock(cols, "up"),
    onMoveDown: (cols) => moveBlock(cols, "down"),
    onPaste: handlePaste,
    onContextMenuKey: handleContextMenuKey,
  });

  const columnLabels = useMemo<Record<string, string>>(() => ({
    physicalName: "物理名",
    name: "表示名",
    dataType: "データ型",
    length: "長さ",
    notNull: "NN",
    primaryKey: "PK",
    unique: "UK",
    autoIncrement: "AI",
    defaultValue: "デフォルト",
  }), []);

  // Esc で詳細パネルを閉じる
  useEffect(() => {
    if (!activeColId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".list-context-menu")) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setActiveColId(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeColId]);

  // activeColId が table.columns 内に存在しないなら render 中に null 化 (React 19 公式 pattern:
  // "Adjusting state while rendering" — setActiveColId が same value なら React は re-render を
  // skip するので無限ループにはならない)。
  const detailCol = activeColId ? table.columns.find((c) => c.id === activeColId) ?? null : null;
  if (activeColId && !detailCol) {
    setActiveColId(null);
  }

  // 詳細パネルを Enter / Ctrl+Enter だけで次々に入力する (最後のカラムの次は、新しいカラムを追加)
  const detailRef = useRef<HTMLDivElement>(null);
  const goToColumn = (offset: number) => {
    if (!detailCol) return;
    const list = sort.sorted;
    const at = list.findIndex((c) => c.id === detailCol.id);
    const target = list[at + offset];
    if (target) {
      selection.setSelectedIds(new Set<string>([target.id]));
      setActiveColId(target.id);
    } else if (offset > 0 && !isReadonly && !sortActive) {
      handleAddBlank();
    }
  };
  const detailKeys = useDetailPanelKeyboard({
    panelRef: detailRef,
    resetKey: detailCol?.id ?? null,
    onNext: () => goToColumn(1),
    onPrev: () => goToColumn(-1),
  });

  const columns = useMemo<DataListColumn<Column>[]>(() => [
    {
      key: "physicalName",
      header: "物理名",
      width: "18%",
      sortable: true,
      sortAccessor: (c) => c.physicalName,
      render: (c) => (
        <>
          <code className="col-name-code">{c.physicalName}</code>
          {fkColumnIds.has(c.id) && <i className="bi bi-link-45deg col-fk-icon" title="外部キー (Constraint で定義)" />}
        </>
      ),
    },
    { key: "name", header: "表示名", width: "18%", sortable: true, sortAccessor: (c) => c.name, render: (c) => c.name },
    {
      key: "dataType",
      header: "データ型",
      width: "10%",
      sortable: true,
      sortAccessor: (c) => c.dataType,
      render: (c) => <span className="col-type-badge">{c.dataType}</span>,
    },
    {
      key: "length",
      header: "長さ",
      width: "60px",
      align: "right",
      sortable: true,
      sortAccessor: (c) => c.length ?? 0,
      render: (c) => (c.length != null ? `${c.length}${c.scale != null ? `,${c.scale}` : ""}` : ""),
    },
    { key: "notNull", header: "NN", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.notNull ? 1 : 0), render: (c) => (c.notNull ? <i className="bi bi-check-lg" /> : null) },
    { key: "primaryKey", header: "PK", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.primaryKey ? 1 : 0), render: (c) => (c.primaryKey ? <i className="bi bi-key-fill col-pk-icon" /> : null) },
    { key: "unique", header: "UK", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.unique ? 1 : 0), render: (c) => (c.unique ? <i className="bi bi-check-lg" /> : null) },
    { key: "autoIncrement", header: "AI", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.autoIncrement ? 1 : 0), render: (c) => (c.autoIncrement ? <i className="bi bi-check-lg" /> : null) },
    { key: "defaultValue", header: "デフォルト", width: "14%", sortable: true, sortAccessor: (c) => c.defaultValue ?? "", render: (c) => <code className="col-default-code">{c.defaultValue ?? ""}</code> },
  ], [fkColumnIds]);

  const templateCategories = COLUMN_TEMPLATES.reduce<Record<string, ColumnTemplate[]>>((acc, tpl) => {
    (acc[tpl.category] ??= []).push(tpl);
    return acc;
  }, {});

  const selectedCount = selection.selectedIds.size;
  const anySelected = selectedCount > 0;
  const columnsEmpty = table.columns.length === 0;
  const primaryKeyEmpty = !table.columns.some((column) => column.primaryKey);

  return (
    <div
      className="columns-tab"
      onPaste={(e) => {
        // Excel の表を貼り付けたら、「表から貼り付け」を開く (アプリ内のコピーがあるとき・入力欄の中は、ふつうの貼り付け)
        if (isReadonly || sortActive || isPasteIntoField(e.target) || clipboard.hasContent) return;
        const text = e.clipboardData?.getData("text/plain");
        if (!looksLikeSpreadsheet(text)) return;
        e.preventDefault();
        setPasteInitial(text ?? "");
        setShowPaste(true);
      }}
    >
      <div className="columns-selection-bar">
        <span className="columns-selection-count">
          {gridMode ? "セルをクリックして、そのまま編集できます (Tab で次のセル、Enter で下の行)" : anySelected ? `${selectedCount} 件選択中 (ダブルクリック/Enter で編集)` : "クリックで選択、ダブルクリックで編集"}
        </span>
        {(columnsEmpty || primaryKeyEmpty) && (
          <span className="columns-warning" data-testid="columns-warning">
            <i className="bi bi-exclamation-triangle-fill" /> {columnsEmpty ? "カラムが未定義です" : "主キーが未指定です"}
          </span>
        )}
        <div className={`columns-selection-actions${gridMode ? " is-grid" : ""}`}>
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => moveBlock(selection.selectedItems, "up")}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "上へ移動 (Alt+↑)"}
          >
            <i className="bi bi-chevron-up" /> 上へ
          </button>
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => moveBlock(selection.selectedItems, "down")}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "下へ移動 (Alt+↓)"}
          >
            <i className="bi bi-chevron-down" /> 下へ
          </button>
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => handleDuplicate(selection.selectedItems)}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "複製 (Ctrl+D)"}
          >
            <i className="bi bi-copy" /> 複製
          </button>
          <button
            className={`tbl-btn tbl-btn-ghost tbl-btn-sm${gridMode ? " active" : ""}`}
            onClick={() => setGridMode((v) => !v)}
            aria-pressed={gridMode}
            title={gridMode ? "一覧で編集に戻す (行を選んで、コピー・並べ替え・一括変更ができます)" : "表計算ソフトのように、セルを選んでその場で編集する (Tab で次の列、Enter で下の行)"}
            data-testid="columns-grid-toggle"
          >
            <i className={`bi ${gridMode ? "bi-list-ul" : "bi-grid-3x3"}`} /> {gridMode ? "一覧で編集" : "表で編集"}
          </button>
          <SnippetMenu kind="columns" selectionCount={selectedCount} getSelection={() => selection.selectedItems} readonly={isReadonly || sortActive}
            onInsert={(sn) => {
              const items = sn.items as unknown as Column[];
              const newIds: string[] = [];
              let renamed = 0;
              update((t) => {
                const plan = planColumnPaste(t.columns, items, false);
                renamed = plan.renamed.length;
                for (const c of plan.columns) newIds.push(addColumn(t, c).id);
                t.columns = renumber(t.columns);
              });
              selection.setSelectedIds(new Set<string>(newIds));
              showToast(`スニペット「${sn.name}」を挿入しました (${newIds.length} 列${renamed > 0 ? `。物理名が重なる ${renamed} 列は _copy を付けました` : ""})`, "info");
            }} />
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || isReadonly}
            onClick={() => setShowBulk(true)}
            title="選んだカラムの型・長さ・NOT NULL などをまとめて変える"
            data-testid="columns-bulk-edit"
          >
            <i className="bi bi-sliders" /> 一括変更
          </button>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm danger" disabled={!anySelected} onClick={() => handleDelete(selection.selectedItems)} title="削除 (Delete)">
            <i className="bi bi-trash" /> 削除{anySelected ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </div>

      {gridMode && (
        <ColumnGrid columns={table.columns} readonly={isReadonly} onUpdateColumn={handleUpdateCol} onAppend={handleAddBlank} />
      )}
      {!gridMode && (<>
      <SortBar sort={sort} columnLabels={columnLabels} />

      <DataList
        items={sort.sorted}
        columns={columns}
        getId={(c) => c.id}
        getNo={(c) => c.no ?? 0}
        onRowDelete={handleRowDelete}
        onContextMenu={handleContextMenu}
        selection={selection}
        clipboard={clipboard}
        sort={sort}
        onActivate={(c) => setActiveColId(c.id)}
        onReorder={handleReorder}
        showNumColumn
        variant="dark"
        className="columns-data-list"
        emptyMessage={<EmptyState noun="カラム" icon="bi-columns-gap" hint="テンプレート (id・作成日時など) から足すか、空のカラムを追加します。Excel の表を貼り付けても作れます" onCreate={isReadonly || sortActive ? undefined : handleAddBlank} createLabel="空のカラムを追加" />}
      />

      </>)}

      {!gridMode && detailCol && (
        <div className="column-detail" ref={detailRef} onKeyDown={detailKeys.onKeyDown} data-testid="column-detail">
          <div className="column-detail-header">
            <span className="column-detail-title">
              <i className="bi bi-pencil-square" /> 編集中: <code>{detailCol.physicalName}</code>
              <span className="column-detail-hint">(Enter で次の欄、Ctrl+Enter で次のカラム、Esc で閉じる。外部キーは「制約」タブで管理)</span>
            </span>
            <button className="tbl-btn-icon" onClick={() => setActiveColId(null)} title="閉じる">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <ColumnDetailEditor
            col={detailCol}
            onUpdate={(patch) => handleUpdateCol(detailCol.id, patch)}
            showLength={DATA_TYPES_WITH_LENGTH.includes(detailCol.dataType as BuiltinDataType)}
            showScale={DATA_TYPES_WITH_SCALE.includes(detailCol.dataType as BuiltinDataType)}
          />
        </div>
      )}

      <div className="columns-add-bar">
        <button
          className="tbl-btn tbl-btn-primary"
          onClick={handleAddBlank}
          disabled={sortActive || isReadonly}
          title={isReadonly ? "「編集開始」を押してから追加できます" : sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
        >
          <i className="bi bi-plus-lg" /> カラム追加
        </button>
        <button
          className={`tbl-btn tbl-btn-secondary${showTemplates ? " active" : ""}`}
          onClick={() => setShowTemplates(!showTemplates)}
          disabled={sortActive || isReadonly}
          title={isReadonly ? "「編集開始」を押してから追加できます" : sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
        >
          <i className="bi bi-collection" /> テンプレートから追加
        </button>
        <button
          className="tbl-btn tbl-btn-secondary"
          onClick={() => setShowPaste(true)}
          disabled={sortActive || isReadonly}
          title={isReadonly ? "「編集開始」を押してから追加できます" : sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "Excel などの表を貼り付けて、カラムをまとめて追加"}
          data-testid="paste-columns-open"
        >
          <i className="bi bi-clipboard-data" /> 表から貼り付け
        </button>
      </div>
      {showBulk && (
        <BulkEditDialog<Column>
          title="カラムの一括変更"
          fields={COLUMN_BULK_FIELDS}
          items={selection.selectedItems}
          itemLabel={(c) => `${c.physicalName}${c.name ? ` (${c.name})` : ""}`}
          onClose={() => setShowBulk(false)}
          onApply={(patches) => {
            const targets = selection.selectedItems;
            update((t) => {
              for (const p of patches) {
                const col = t.columns.find((c) => c.id === targets[p.index]?.id);
                if (col) applyBulkPatch(col, p.patch);
              }
            });
            showToast(`${patches.length} 件のカラムを変更しました (Ctrl+Z で元に戻せます)`, "info");
          }}
        />
      )}
      {showPaste && (
        <PasteColumnsDialog existing={table.columns} onApply={handlePasteColumns} onClose={() => { setShowPaste(false); setPasteInitial(""); }} initialText={pasteInitial} />
      )}

      {contextMenu && (
        <ListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showTemplates && (
        <div className="column-templates">
          <div className="column-templates-title">
            <i className="bi bi-collection" /> カラムテンプレート
            <button className="tbl-btn-icon" onClick={() => setShowTemplates(false)} title="閉じる">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <div className="column-templates-grid">
            {Object.entries(templateCategories).map(([cat, tpls]) => (
              <div key={cat} className="template-category">
                <div className="template-category-name">{cat}</div>
                <div className="template-items">
                  {tpls.map((tpl) => (
                    <button
                      key={tpl.id}
                      className="template-item"
                      onClick={() => handleAddFromTemplate(tpl)}
                      title={`${tpl.column.physicalName} (${tpl.column.dataType})`}
                    >
                      <i className={`bi ${tpl.icon}`} />
                      <span>{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── カラム詳細編集 (FK は ConstraintsTab で管理) ────────────────────────────

function ColumnDetailEditor({
  col, onUpdate, showLength, showScale,
}: {
  col: Column;
  onUpdate: (patch: Partial<Column>) => void;
  showLength: boolean;
  showScale: boolean;
}) {
  return (
    <div className="column-detail">
      <div className="column-detail-grid">
        <label className="tbl-field">
          <span>物理名<HelpHint topic="table.physicalName" /></span>
          <input
            type="text"
            value={col.physicalName}
            onChange={(e) => onUpdate({ physicalName: e.target.value as PhysicalName })}
            placeholder="例: column_name"
          />
        </label>
        <label className="tbl-field">
          <span>表示名<HelpHint topic="table.name" /></span>
          <input
            type="text"
            value={col.name}
            onChange={(e) => onUpdate({ name: e.target.value as DisplayName })}
            placeholder="例: カラムの日本語名"
          />
        </label>
        <label className="tbl-field">
          <span>データ型<HelpHint topic="table.dataType" /></span>
          <select
            value={col.dataType}
            onChange={(e) => onUpdate({ dataType: e.target.value })}
          >
            {Object.entries(DATA_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {showLength && (
          <label className="tbl-field">
            <span>長さ</span>
            <input
              type="number"
              value={col.length ?? ""}
              onChange={(e) => onUpdate({ length: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="例: 255"
              min={1}
            />
          </label>
        )}
        {showScale && (
          <label className="tbl-field">
            <span>スケール</span>
            <input
              type="number"
              value={col.scale ?? ""}
              onChange={(e) => onUpdate({ scale: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="例: 2"
              min={0}
            />
          </label>
        )}
        <label className="tbl-field">
          <span>デフォルト値<HelpHint topic="table.defaultValue" /></span>
          <input
            type="text"
            value={col.defaultValue ?? ""}
            onChange={(e) => onUpdate({ defaultValue: e.target.value || undefined })}
            placeholder="例: NULL"
          />
        </label>
      </div>

      <div className="column-detail-flags">
        <span className="column-flag-help">制約の印<HelpHint topic="table.keys" /></span>
        <label className="column-flag-label">
          <input type="checkbox" checked={col.notNull ?? false} onChange={(e) => onUpdate({ notNull: e.target.checked })} />
          NOT NULL
        </label>
        <label className="column-flag-label">
          <input
            type="checkbox"
            checked={col.primaryKey ?? false}
            onChange={(e) => onUpdate({ primaryKey: e.target.checked, notNull: e.target.checked ? true : col.notNull })}
          />
          PRIMARY KEY
        </label>
        <label className="column-flag-label">
          <input type="checkbox" checked={col.unique ?? false} onChange={(e) => onUpdate({ unique: e.target.checked })} />
          UNIQUE
        </label>
        <label className="column-flag-label">
          <input type="checkbox" checked={col.autoIncrement ?? false} onChange={(e) => onUpdate({ autoIncrement: e.target.checked })} />
          AUTO INCREMENT
        </label>
      </div>

      <div className="column-detail-extra">
        <label className="tbl-field">
          <span>備考</span>
          <input
            type="text"
            value={col.comment ?? ""}
            onChange={(e) => onUpdate({ comment: e.target.value || undefined })}
            placeholder="カラムの補足説明"
          />
        </label>

        <div className="column-fk-hint">
          <i className="bi bi-info-circle" /> 外部キー (FK) は「制約」タブで定義します。v3 では FK が Column ではなく Constraint に集約されました。
        </div>
      </div>
    </div>
  );
}

// ── コメントタブ ──────────────────────────────────────────────────────────────

function CommentTab({
  table, update,
}: {
  table: Table;
  update: (fn: (t: Table) => void) => void;
}) {
  return (
    <div className="comment-tab">
      <label className="tbl-field comment-tab-field">
        <span>テーブルコメント</span>
        <textarea
          className="comment-tab-textarea"
          value={table.comment ?? ""}
          onChange={(e) => update((t) => { t.comment = e.target.value || undefined; })}
          placeholder="テーブルの用途・概要を記載します（DDL の COMMENT ON TABLE に反映されます）"
          rows={4}
        />
      </label>
      <p className="comment-tab-hint">
        <i className="bi bi-info-circle" /> PostgreSQL では <code>COMMENT ON TABLE {table.physicalName} IS &#39;...&#39;;</code> として DDL に出力されます。
      </p>
    </div>
  );
}
