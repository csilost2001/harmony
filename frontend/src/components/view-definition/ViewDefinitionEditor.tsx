/**
 * ViewDefinitionEditor — ビュー定義編集画面 (#666 S5 / #748 で 3 レベル DSL 編集対応)
 *
 * 6 セクション構成:
 *  1. 基本情報 (id / name / description / kind / Level 切替 / maturity)
 *  2. Query — Level 1 (sourceTableId) / Level 2 (Structured: from + joins + where/...) /
 *             Level 3 (Raw SQL: sql + parameterRefs)
 *  3. columns 編集テーブル (Level に応じて tableColumnRef 列を切替)
 *  4. sortDefaults 編集テーブル
 *  5. filterDefaults 編集テーブル
 *  6. その他 (pageSize / groupBy)
 *
 * リアルタイム validator: checkViewDefinition() の結果を各フィールドの隣に inline 表示。
 *
 * #1145 Phase-4 (2026-05-18): 旧 1766 行 / 81KB を `internal/` 配下に責務分離。
 * - DSL 3 level 別 sub-editor: Level1QueryEditor / Level2QueryEditor / Level3QueryEditor
 * - 6 section: BasicInfoSection / (Query) / ColumnsSection / SortDefaultsSection / FilterDefaultsSection / MiscSection
 * - 共通 hook: useTablesForValidator / useTableOptions (`internal/useViewDefinitionTables.ts`)
 * - 共通 component: IssueHints
 * - 共通 constants: viewDefinitionConstants (FIELD_TYPE_OPTIONS / FILTER_OPERATORS / KIND_LABELS / JOIN_KIND_OPTIONS / LEVEL_LABELS / isBuiltinKind)
 *
 * 本ファイルは編集セッション / draft 管理 / state orchestration + 6 section 配置に専念する。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type {
  ViewDefinition,
  ViewColumn,
  SortSpec,
  FilterSpec,
  ViewQueryStructured,
} from "../../types/v3/view-definition";
import type { FieldTypePrimitive } from "../../types/v3";
import type { TableId, LocalId, Identifier } from "../../types/v3/common";
import { loadViewDefinition, saveViewDefinition } from "../../store/viewDefinitionStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { EditorHeader, type EditorHeaderSaveReset, type EditorHeaderBackLink, type EditorHeaderUndoRedo } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import { ValidationBadge } from "../common/ValidationBadge";
import { checkViewDefinition, type ViewDefinitionIssue } from "../../schemas/viewDefinitionValidator";
import "../../styles/table.css";
import "../../styles/editMode.css";

// Level 検出 + 切替ヘルパー (#748、3 レベル DSL UI 対応)
import { detectLevel, type ViewLevel } from "./viewDefinitionLevels";

// Phase-4 抽出 sub-editor / section / hooks / constants
import { useTablesForValidator, useTableOptions } from "./internal/useViewDefinitionTables";
import { LEVEL_LABELS } from "./internal/viewDefinitionConstants";
import { BasicInfoSection } from "./internal/BasicInfoSection";
import { Level1QueryEditor } from "./internal/Level1QueryEditor";
import { Level2QueryEditor } from "./internal/Level2QueryEditor";
import { Level3QueryEditor } from "./internal/Level3QueryEditor";
import { ColumnsSection } from "./internal/ColumnsSection";
import { SortDefaultsSection } from "./internal/SortDefaultsSection";
import { FilterDefaultsSection } from "./internal/FilterDefaultsSection";
import { MiscSection } from "./internal/MiscSection";

// ─── Main Component ───────────────────────────────────────────────────────────

export function ViewDefinitionEditor() {
  const { viewDefinitionId: rawId } = useParams<{ viewDefinitionId: string }>();
  const viewDefinitionId = rawId ? decodeURIComponent(rawId) : rawId;
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  // テーブル選択 state (tableColumnRef 用カスケード)
  // key: column index → 選択中のテーブル ID (cascade step 1)
  const [colRefTableIds, setColRefTableIds] = useState<Record<number, string>>({});

  // kind: 拡張参照モード (builtin 以外の場合は true で初期化)
  const [kindExtMode, setKindExtMode] = useState(false);

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const handleNotFound = useCallback(() => navigate(wsPath("/view-definition/list"), { replace: true }), [navigate, wsPath]);

  // onLoaded: viewDefinition 読み込み時に UI state を初期化 (useEffect の代わり)
  const handleLoaded = useCallback((vd: ViewDefinition) => {
    const builtin = ["list", "detail", "kanban", "calendar"];
    setKindExtMode(!builtin.includes(vd.kind));
    const nextIds: Record<number, string> = {};
    // Level 別 fallback (#748):
    //  L1: sourceTableId / L2: query.from.tableId / L3: tableColumnRef は省略可なので空
    const lv = detectLevel(vd);
    const fallbackTableId =
      lv === 1
        ? ((vd.sourceTableId as string | undefined) ?? "")
        : lv === 2
          ? (((vd.query as ViewQueryStructured | undefined)?.from?.tableId as string | undefined) ?? "")
          : "";
    (vd.columns ?? []).forEach((col, i) => {
      nextIds[i] = (col.tableColumnRef?.tableId as string | undefined) ?? fallbackTableId;
    });
    setColRefTableIds(nextIds);
  }, []);

  const sessionId = mcpBridge.getSessionId();

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { syncSessionToUrl, initialEditSessionId: initialViewDefSessionId } = useSessionUrlSync({
    resourceType: "view-definition",
    resourceId: viewDefinitionId ?? "",
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  // #891 fix: useResourceEditor より前に呼び出し、viewerMode / viewerEditSessionId を渡せるようにする
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "view-definition",
    resourceId: viewDefinitionId ?? "",
    sessionId,
    editSessionId: initialViewDefSessionId,
  });

  const {
    state: viewDefinition,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit, postSave, handleReset, dismissServerBanner,
    undo, redo, canUndo, canRedo,
    reload,
  } = useResourceEditor<ViewDefinition>({
    tabType: "view-definition",
    mtimeKind: "viewDefinition",
    draftKind: "view-definition",
    id: viewDefinitionId,
    load: loadViewDefinition,
    save: saveViewDefinition,
    broadcastName: "viewDefinitionChanged",
    broadcastIdField: "viewDefinitionId",
    onNotFound: handleNotFound,
    onLoaded: handleLoaded,
    // #891 fix: viewer mode で mid-edit broadcast を受信するため渡す
    // 新 API では "viewer" | "editing" | "readonly" の 3 値のみ返す (legacy 値は発生しない)
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: "view-definition",
    viewerEditSessionId: editSession?.id,
  });

  const isReadonly = mode.kind !== "editing";

  // #960: 「作成して編集」経由で sessionStorage に flag があれば auto-edit モードで開く。
  const autoEditFiredRef = useRef(false);
  useEffect(() => {
    if (autoEditFiredRef.current) return;
    if (!viewDefinitionId) return;
    if (mode.kind !== "readonly") return;
    if (sessionLoading) return;
    const key = `harmony-auto-edit:view-definition:${viewDefinitionId}`;
    if (sessionStorage.getItem(key) !== "1") return;
    autoEditFiredRef.current = true;
    sessionStorage.removeItem(key);
    void actions.startEditing();
  }, [viewDefinitionId, mode.kind, sessionLoading, actions]);

  const viewDefRef = useRef<ViewDefinition | null>(null);
  useEffect(() => { viewDefRef.current = viewDefinition ?? null; }, [viewDefinition]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (s: ViewDefinition) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!viewDefinitionId || !viewDefRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: viewDefRef.current }).catch(console.error);
      }
    }, 300);
  }, [isReadonly, update, viewDefinitionId, editSession]);

  const updateSilentWithDraft = useCallback((fn: (s: ViewDefinition) => void) => {
    if (isReadonly) return;
    updateSilent(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!viewDefinitionId || !viewDefRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: viewDefRef.current }).catch(console.error);
      }
    }, 300);
  }, [isReadonly, updateSilent, viewDefinitionId, editSession]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    // P1 fix (#908 round-5): debounce 中の draft を flush して即送信、その後 conflict check
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (viewDefRef.current && editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: viewDefRef.current });
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
    if (!viewDefinitionId) return;
    const tabId = makeTabId("view-definition", viewDefinitionId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [viewDefinitionId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!viewDefinitionId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", { resourceType: "view-definition", resourceId: viewDefinitionId }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      // #980-A: 自分が participant として参加していた Active session のみ対象。
      const mySessionId = mcpBridge.getSessionId();
      const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
        s.state === "Active" && !!s.participants?.[mySessionId],
      );
      if (hasMyActiveSession) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [viewDefinitionId, sessionLoading, mode.kind]);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
  }, [viewDefinitionId]);

  // テーブル一覧 (validator 用 & tableColumnRef 選択用)
  const tables = useTablesForValidator();
  const tableOptions = useTableOptions();


  // 現在の Level (#748)
  const currentLevel: ViewLevel = useMemo<ViewLevel>(() => {
    return viewDefinition ? detectLevel(viewDefinition) : 1;
  }, [viewDefinition]);

  // Level 2 で利用可能なテーブル + alias 一覧 (columns の tableColumnRef 選択肢生成用)
  // 各 entry = { tableId, alias, label } を返す。Level 1/3 では空配列 (UI 側で別経路を使う)。
  const inScopeTables = useMemo<Array<{ tableId: string; alias: string; label: string; tableName: string }>>(() => {
    if (!viewDefinition || currentLevel !== 2) return [];
    const sq = viewDefinition.query as ViewQueryStructured | undefined;
    if (!sq?.from) return [];
    const out: Array<{ tableId: string; alias: string; label: string; tableName: string }> = [];
    const fromTblName = tableOptions.find((t) => t.id === (sq.from.tableId as string))?.name ?? sq.from.tableId;
    out.push({
      tableId: sq.from.tableId as string,
      alias: sq.from.alias,
      label: `${sq.from.alias}: ${fromTblName}`,
      tableName: fromTblName,
    });
    for (const j of sq.joins ?? []) {
      const tName = tableOptions.find((t) => t.id === (j.tableId as string))?.name ?? (j.tableId as string);
      out.push({
        tableId: j.tableId as string,
        alias: j.alias,
        label: `${j.alias}: ${tName} (${j.kind} JOIN)`,
        tableName: tName,
      });
    }
    return out;
  }, [viewDefinition, currentLevel, tableOptions]);

  // リアルタイム validator
  const issues = useMemo<ViewDefinitionIssue[]>(() => {
    if (!viewDefinition) return [];
    return checkViewDefinition(viewDefinition, tables);
  }, [viewDefinition, tables]);

  const issuesByPath = useMemo<Map<string, ViewDefinitionIssue[]>>(() => {
    const map = new Map<string, ViewDefinitionIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.path) ?? [];
      list.push(issue);
      map.set(issue.path, list);
    }
    return map;
  }, [issues]);

  // issue 集計
  const errorCount = useMemo(() => issues.filter((i) => i.severity === "error").length, [issues]);
  const warningCount = useMemo(() => issues.filter((i) => i.severity === "warning").length, [issues]);

  // path ヘルパー
  const vdId = viewDefinition?.id ?? "";

  const colPath = useCallback((ci: number, colName: string, field?: string): string => {
    const base = `ViewDefinition[${vdId}].columns[${ci}=${colName}]`;
    return field ? `${base}.${field}` : base;
  }, [vdId]);

  const sortPath = useCallback((si: number, field?: string): string => {
    const base = `ViewDefinition[${vdId}].sortDefaults[${si}].columnName`;
    return field ? `ViewDefinition[${vdId}].sortDefaults[${si}].${field}` : base;
  }, [vdId]);

  const filterPath = useCallback((fi: number, field: string): string => {
    return `ViewDefinition[${vdId}].filterDefaults[${fi}].${field}`;
  }, [vdId]);

  const getIssues = useCallback((path: string): ViewDefinitionIssue[] => {
    return issuesByPath.get(path) ?? [];
  }, [issuesByPath]);

  // ─── 読み込み中 ────────────────────────────────────────────────────────────
  if (!viewDefinition || sessionLoading) {
    return (
      <div className="table-editor-loading">
        <i className="bi bi-hourglass-split" /> 読み込み中...
      </div>
    );
  }

  const columnNames = (viewDefinition.columns ?? []).map((c) => c.name as string);

  // ─── columns 操作 ──────────────────────────────────────────────────────────

  const addColumn = () => {
    // Level 別の初期 tableColumnRef:
    //  Level 1: sourceTableId
    //  Level 2: query.from.tableId (最初の in-scope テーブル)
    //  Level 3: tableColumnRef は不要 (省略)
    let initialTableId = "";
    if (currentLevel === 1) {
      initialTableId = (viewDefinition.sourceTableId as string | undefined) ?? "";
    } else if (currentLevel === 2) {
      const sq = viewDefinition.query as ViewQueryStructured | undefined;
      initialTableId = (sq?.from?.tableId as string | undefined) ?? "";
    }

    const newCol: ViewColumn =
      currentLevel === 3
        ? {
            name: "" as Identifier,
            type: "string" as FieldTypePrimitive,
          }
        : {
            name: "" as Identifier,
            tableColumnRef: {
              tableId: initialTableId as TableId,
              columnId: "" as LocalId,
            },
            type: "string" as FieldTypePrimitive,
          };
    updateWithDraft((d) => { d.columns = [...(d.columns ?? []), newCol]; });
    setColRefTableIds((prev) => ({
      ...prev,
      [viewDefinition.columns.length]: initialTableId,
    }));
  };

  const removeColumn = (ci: number) => {
    updateWithDraft((d) => { d.columns = d.columns.filter((_, i) => i !== ci); });
    setColRefTableIds((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx < ci) next[idx] = v;
        else if (idx > ci) next[idx - 1] = v;
      });
      return next;
    });
  };

  const moveColumn = (ci: number, direction: "up" | "down") => {
    const cols = [...(viewDefinition.columns ?? [])];
    const target = direction === "up" ? ci - 1 : ci + 1;
    if (target < 0 || target >= cols.length) return;
    updateWithDraft((d) => {
      const tmp = d.columns[ci];
      d.columns[ci] = d.columns[target];
      d.columns[target] = tmp;
    });
    setColRefTableIds((prev) => {
      const next = { ...prev };
      const tmp = next[ci];
      next[ci] = next[target] ?? "";
      next[target] = tmp ?? "";
      return next;
    });
  };

  const updateColumn = <K extends keyof ViewColumn>(ci: number, field: K, value: ViewColumn[K]) => {
    updateWithDraft((d) => {
      d.columns[ci] = { ...d.columns[ci], [field]: value };
    });
  };

  // tableColumnRef カスケード: テーブル選択
  const setColRefTable = (ci: number, tableId: string) => {
    setColRefTableIds((prev) => ({ ...prev, [ci]: tableId }));
    updateWithDraft((d) => {
      d.columns[ci] = {
        ...d.columns[ci],
        tableColumnRef: { tableId: tableId as TableId, columnId: "" as LocalId },
      };
    });
  };

  // tableColumnRef カスケード: カラム選択 (Level 別フォールバック)
  // Level 1: sourceTableId / Level 2: query.from.tableId / Level 3: 既存値そのまま
  const setColRefColumn = (ci: number, columnId: string) => {
    const fallbackTableId =
      currentLevel === 1
        ? (viewDefinition.sourceTableId as string | undefined)
        : currentLevel === 2
          ? ((viewDefinition.query as ViewQueryStructured | undefined)?.from?.tableId as string | undefined)
          : undefined;
    const existing = viewDefinition.columns[ci]?.tableColumnRef?.tableId as string | undefined;
    const tableId = colRefTableIds[ci] || existing || fallbackTableId || "";
    updateWithDraft((d) => {
      d.columns[ci] = {
        ...d.columns[ci],
        tableColumnRef: { tableId: tableId as TableId, columnId: columnId as LocalId },
      };
    });
  };

  // ─── sortDefaults 操作 ─────────────────────────────────────────────────────

  const addSortSpec = () => {
    const spec: SortSpec = { columnName: "" as Identifier, order: "asc" };
    updateWithDraft((d) => { d.sortDefaults = [...(d.sortDefaults ?? []), spec]; });
  };

  const removeSortSpec = (si: number) => {
    updateWithDraft((d) => { d.sortDefaults = (d.sortDefaults ?? []).filter((_, i) => i !== si); });
  };

  const updateSortSpec = <K extends keyof SortSpec>(si: number, field: K, value: SortSpec[K]) => {
    updateWithDraft((d) => {
      const specs = d.sortDefaults ?? [];
      specs[si] = { ...specs[si], [field]: value };
      d.sortDefaults = specs;
    });
  };

  // ─── filterDefaults 操作 ───────────────────────────────────────────────────

  const addFilterSpec = () => {
    const spec: FilterSpec = { columnName: "" as Identifier, operator: "eq" };
    updateWithDraft((d) => { d.filterDefaults = [...(d.filterDefaults ?? []), spec]; });
  };

  const removeFilterSpec = (fi: number) => {
    updateWithDraft((d) => { d.filterDefaults = (d.filterDefaults ?? []).filter((_, i) => i !== fi); });
  };

  const updateFilterSpec = <K extends keyof FilterSpec>(fi: number, field: K, value: FilterSpec[K]) => {
    updateWithDraft((d) => {
      const specs = d.filterDefaults ?? [];
      specs[fi] = { ...specs[fi], [field]: value };
      d.filterDefaults = specs;
    });
  };

  // ─── render ───────────────────────────────────────────────────────────────

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

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={async () => {
            try {
              await onSaveConflictOverwrite();
              await postSave();
            } catch (e) {
              console.error("[ViewDefinitionEditor] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      <EditorHeader
        title={
          <>
            <i className="bi bi-layout-text-window" /> ビュー定義編集:{" "}
            <code>{viewDefinition.name || viewDefinition.id}</code>
          </>
        }
        backLink={{
          label: "ビュー定義一覧",
          onClick: () => navigate(wsPath("/view-definition/list")),
        } satisfies EditorHeaderBackLink}
        undoRedo={{
          onUndo: undo,
          onRedo: redo,
          canUndo,
          canRedo,
        } satisfies EditorHeaderUndoRedo}
        extraRight={
          <EditSessionDropdown
            resourceType="view-definition"
            resourceId={viewDefinitionId ?? ""}
            currentMode={mode}
            currentSessionId={sessionId}
            onStartEditing={() => { void actions.startEditing(); }}
            onViewerAttached={syncSessionToUrl}
            onAttachAsView={attach}
            onTakeOver={takeOver}
          />
        }
        saveReset={isReadonly ? undefined : {
          isDirty,
          isSaving,
          onSave: handleSave,
          onReset: () => setShowDiscardDialog(true),
          resetConfirmMessage: "未保存の変更を破棄してサーバの状態に戻しますか？",
        } satisfies EditorHeaderSaveReset}
      />

      {/* 検証サマリーバー */}
      {(errorCount > 0 || warningCount > 0) && (
        <div className="vd-editor-issue-bar">
          {errorCount > 0 && (
            <ValidationBadge severity="error" count={errorCount} />
          )}
          {warningCount > 0 && (
            <ValidationBadge severity="warning" count={warningCount} />
          )}
          <span className="vd-editor-issue-bar-label">
            検証問題が検出されました。下記の各フィールドを確認してください。
          </span>
        </div>
      )}

      <div className="seq-editor-body">
        <div className="seq-editor-left-col">

          {/* ───── Section 1: 基本情報 ────────────────────────────────────── */}
          <BasicInfoSection
            viewDefinition={viewDefinition}
            currentLevel={currentLevel}
            tableOptions={tableOptions}
            isReadonly={isReadonly}
            kindExtMode={kindExtMode}
            setKindExtMode={setKindExtMode}
            updateWithDraft={updateWithDraft}
            updateSilentWithDraft={updateSilentWithDraft}
            commit={commit}
          />

          {/* ───── Section 2: Query (Level 別) (#748) ──────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              クエリ <small className="vd-editor-level-tag">{LEVEL_LABELS[currentLevel]}</small>
            </h3>

            {currentLevel === 1 && (
              <Level1QueryEditor
                viewDefinition={viewDefinition}
                vdId={vdId}
                tableOptions={tableOptions}
                isReadonly={isReadonly}
                updateWithDraft={updateWithDraft}
                getIssues={getIssues}
              />
            )}

            {currentLevel === 2 && (
              <Level2QueryEditor
                viewDefinition={viewDefinition}
                vdId={vdId}
                tableOptions={tableOptions}
                isReadonly={isReadonly}
                updateWithDraft={updateWithDraft}
                updateSilentWithDraft={updateSilentWithDraft}
                commit={commit}
                getIssues={getIssues}
              />
            )}

            {currentLevel === 3 && (
              <Level3QueryEditor
                viewDefinition={viewDefinition}
                isReadonly={isReadonly}
                updateWithDraft={updateWithDraft}
                updateSilentWithDraft={updateSilentWithDraft}
                commit={commit}
              />
            )}
          </section>

          {/* ───── Section 3: columns 編集 ────────────────────────────────── */}
          <ColumnsSection
            viewDefinition={viewDefinition}
            currentLevel={currentLevel}
            tableOptions={tableOptions}
            inScopeTables={inScopeTables}
            colRefTableIds={colRefTableIds}
            isReadonly={isReadonly}
            addColumn={addColumn}
            removeColumn={removeColumn}
            moveColumn={moveColumn}
            updateColumn={updateColumn}
            setColRefTable={setColRefTable}
            setColRefColumn={setColRefColumn}
            updateSilentWithDraft={updateSilentWithDraft}
            updateWithDraft={updateWithDraft}
            commit={commit}
            colPath={colPath}
            getIssues={getIssues}
          />

          {/* ───── Section 4: sortDefaults ────────────────────────────────── */}
          <SortDefaultsSection
            viewDefinition={viewDefinition}
            columnNames={columnNames}
            isReadonly={isReadonly}
            addSortSpec={addSortSpec}
            removeSortSpec={removeSortSpec}
            updateSortSpec={updateSortSpec}
            sortPath={sortPath}
            getIssues={getIssues}
          />

          {/* ───── Section 5: filterDefaults ─────────────────────────────── */}
          <FilterDefaultsSection
            viewDefinition={viewDefinition}
            columnNames={columnNames}
            isReadonly={isReadonly}
            addFilterSpec={addFilterSpec}
            removeFilterSpec={removeFilterSpec}
            updateFilterSpec={updateFilterSpec}
            updateSilentWithDraft={updateSilentWithDraft}
            commit={commit}
            filterPath={filterPath}
            getIssues={getIssues}
          />

          {/* ───── Section 6: その他 ─────────────────────────────────────── */}
          <MiscSection
            viewDefinition={viewDefinition}
            vdId={vdId}
            columnNames={columnNames}
            isReadonly={isReadonly}
            updateWithDraft={updateWithDraft}
            getIssues={getIssues}
          />

        </div>{/* seq-editor-left-col */}
      </div>
    </div>
  );
}
