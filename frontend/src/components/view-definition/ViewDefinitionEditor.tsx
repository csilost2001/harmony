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
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type {
  ViewDefinition,
  ViewColumn,
  SortSpec,
  FilterSpec,
  FilterOperator,
  BuiltinViewDefinitionKind,
  ViewQueryStructured,
  ViewQueryRawSql,
  ViewQueryJoin,
  ViewQueryParameterRef,
} from "../../types/v3/view-definition";
import type { Table, TableEntry, Maturity, Identifier, FieldType, FieldTypePrimitive } from "../../types/v3";
import type { TableId, LocalId } from "../../types/v3/common";
import { loadViewDefinition, saveViewDefinition } from "../../store/viewDefinitionStore";
import { listTables, loadTable } from "../../store/tableStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { EditorHeader, type EditorHeaderSaveReset, type EditorHeaderBackLink, type EditorHeaderUndoRedo } from "../common/EditorHeader";
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
import { MaturityBadge } from "../process-flow/MaturityBadge";
import { ValidationBadge } from "../common/ValidationBadge";
import { checkViewDefinition, type ViewDefinitionIssue, type TableDefinitionForView } from "../../schemas/viewDefinitionValidator";
import "../../styles/table.css";
import "../../styles/editMode.css";

// ─── FieldType primitives available for display ──────────────────────────────

const FIELD_TYPE_OPTIONS: FieldTypePrimitive[] = [
  "string", "integer", "number", "boolean", "date", "datetime", "json",
];

// ─── FilterOperator options ───────────────────────────────────────────────────

const FILTER_OPERATORS: FilterOperator[] = [
  "eq", "neq", "gt", "gte", "lt", "lte",
  "contains", "startsWith", "in", "between",
];

// ─── BuiltinViewDefinitionKind labels ────────────────────────────────────────

const KIND_LABELS: Record<BuiltinViewDefinitionKind, string> = {
  list: "list — 一覧",
  detail: "detail — 詳細",
  kanban: "kanban — カンバン",
  calendar: "calendar — カレンダー",
};

// ─── Level 検出 + 切替ヘルパー (#748、3 レベル DSL UI 対応) ───────────────
// テスト容易性のため別 module に切り出し済み (viewDefinitionLevels.ts)。
import {
  detectLevel,
  migrateToLevel,
  suggestAlias,
  type ViewLevel,
} from "./viewDefinitionLevels";

const JOIN_KIND_OPTIONS: ViewQueryJoin["kind"][] = ["INNER", "LEFT", "RIGHT", "FULL"];

const LEVEL_LABELS: Record<ViewLevel, string> = {
  1: "Level 1 — Simple (1 テーブル)",
  2: "Level 2 — Structured (joins + where)",
  3: "Level 3 — Raw SQL (CTE / window 等)",
};

// ─── useTablesForValidator hook ───────────────────────────────────────────────

function useTablesForValidator(): TableDefinitionForView[] {
  const [tables, setTables] = useState<TableDefinitionForView[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await listTables();
      const all = await Promise.all(entries.map((e: TableEntry) => loadTable(e.id)));
      const valid = all.filter((t): t is Table => t !== null);
      if (!cancelled) {
        // Table is shape-compatible with TableDefinitionForView (id / name / physicalName / columns)
        setTables(valid as unknown as TableDefinitionForView[]);
      }
    })().catch(console.error);
    return () => { cancelled = true; };
  }, []);
  return tables;
}

// ─── TableOption ─────────────────────────────────────────────────────────────

interface TableOption {
  id: string;
  name: string;
  columns: Array<{ id: string; name: string; physicalName: string }>;
}

function useTableOptions(): TableOption[] {
  const [options, setOptions] = useState<TableOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await listTables();
      const tables = await Promise.all(entries.map((e: TableEntry) => loadTable(e.id)));
      if (!cancelled) {
        setOptions(
          tables
            .filter((t): t is Table => t !== null)
            .map((t) => ({
              id: t.id,
              name: t.name ?? t.physicalName ?? t.id,
              columns: (t.columns ?? []).map((c) => ({
                id: c.id,
                name: c.name ?? c.physicalName ?? c.id,
                physicalName: c.physicalName ?? c.id,
              })),
            })),
        );
      }
    })().catch(console.error);
    return () => { cancelled = true; };
  }, []);
  return options;
}

// ─── Inline issue display helper ─────────────────────────────────────────────

function IssueHints({ issues }: { issues: ViewDefinitionIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="vd-editor-issue-hints">
      {issues.map((iss, i) => (
        <small
          key={i}
          className={`vd-editor-issue vd-editor-issue--${iss.severity}`}
          title={iss.code}
        >
          <i className={`bi ${iss.severity === "error" ? "bi-x-circle-fill" : "bi-exclamation-triangle-fill"}`} />
          {" "}{iss.message}
        </small>
      ))}
    </div>
  );
}

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

  const {
    state: viewDefinition,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit, handleSave: resourceHandleSave, handleReset, dismissServerBanner,
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
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "view-definition",
    resourceId: viewDefinitionId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  const viewDefRef = useRef<ViewDefinition | null>(null);
  useEffect(() => { viewDefRef.current = viewDefinition ?? null; }, [viewDefinition]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (s: ViewDefinition) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!viewDefinitionId || !viewDefRef.current) return;
      mcpBridge.updateDraft("view-definition", viewDefinitionId, viewDefRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update, viewDefinitionId]);

  const updateSilentWithDraft = useCallback((fn: (s: ViewDefinition) => void) => {
    if (isReadonly) return;
    updateSilent(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!viewDefinitionId || !viewDefRef.current) return;
      mcpBridge.updateDraft("view-definition", viewDefinitionId, viewDefRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, updateSilent, viewDefinitionId]);

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
    if (viewDefinitionId) await mcpBridge.discardDraft("view-definition", viewDefinitionId);
    await reload();
  }, [viewDefinitionId, reload]);

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
      const res = await mcpBridge.hasDraft("view-definition", viewDefinitionId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
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

  function colPath(ci: number, colName: string, field?: string): string {
    const base = `ViewDefinition[${vdId}].columns[${ci}=${colName}]`;
    return field ? `${base}.${field}` : base;
  }

  function sortPath(si: number, field?: string): string {
    const base = `ViewDefinition[${vdId}].sortDefaults[${si}].columnName`;
    return field ? `ViewDefinition[${vdId}].sortDefaults[${si}].${field}` : base;
  }

  function filterPath(fi: number, field: string): string {
    return `ViewDefinition[${vdId}].filterDefaults[${fi}].${field}`;
  }

  function getIssues(path: string): ViewDefinitionIssue[] {
    return issuesByPath.get(path) ?? [];
  }

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

  const isBuiltinKind = (k: string): k is BuiltinViewDefinitionKind =>
    ["list", "detail", "kanban", "calendar"].includes(k);

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
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">基本情報</h3>
            <div className="seq-editor-grid">

              {/* ID (read-only) */}
              <label className="tbl-field">
                <span>ID</span>
                <input
                  type="text"
                  value={viewDefinition.id}
                  readOnly
                  className="seq-readonly"
                  title="ID は変更できません"
                />
              </label>

              {/* 表示名 */}
              <label className="tbl-field">
                <span>表示名 <span className="vd-editor-required">*</span></span>
                <input
                  type="text"
                  value={viewDefinition.name}
                  onChange={(e) => updateSilentWithDraft((d) => { d.name = e.target.value as ViewDefinition["name"]; })}
                  onBlur={() => { if (!isReadonly) commit(); }}
                  placeholder="顧客一覧"
                  disabled={isReadonly}
                />
              </label>

              {/* 説明 */}
              <label className="tbl-field">
                <span>説明</span>
                <textarea
                  value={viewDefinition.description ?? ""}
                  onChange={(e) => updateSilentWithDraft((d) => {
                    d.description = e.target.value || undefined;
                  })}
                  onBlur={() => { if (!isReadonly) commit(); }}
                  rows={2}
                  placeholder="このビュー定義の用途を記述..."
                  disabled={isReadonly}
                />
              </label>

              {/* viewer 種別 */}
              <div className="tbl-field">
                <span>viewer 種別 <span className="vd-editor-required">*</span></span>
                <div className="vd-editor-kind-row">
                  {!kindExtMode ? (
                    <select
                      value={isBuiltinKind(viewDefinition.kind) ? viewDefinition.kind : "list"}
                      onChange={(e) => updateWithDraft((d) => { d.kind = e.target.value; })}
                      disabled={isReadonly}
                    >
                      {(Object.entries(KIND_LABELS) as [BuiltinViewDefinitionKind, string][]).map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={viewDefinition.kind}
                      onChange={(e) => updateSilentWithDraft((d) => { d.kind = e.target.value; })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="namespace:kindName (例: retail:storefront)"
                      disabled={isReadonly}
                    />
                  )}
                  <button
                    type="button"
                    className="tbl-btn tbl-btn-ghost tbl-btn-sm"
                    onClick={() => {
                      setKindExtMode((v) => !v);
                      if (kindExtMode) {
                        updateWithDraft((d) => { d.kind = "list"; });
                      }
                    }}
                    title={kindExtMode ? "組み込み種別に戻す" : "拡張参照を入力"}
                    disabled={isReadonly}
                  >
                    {kindExtMode ? "組み込みに戻す" : "拡張参照"}
                  </button>
                </div>
              </div>

              {/* Level 切替 (#748、3 レベル DSL) */}
              <div className="tbl-field">
                <span>クエリ Level <span className="vd-editor-required">*</span></span>
                <div className="vd-editor-level-row">
                  {([1, 2, 3] as ViewLevel[]).map((lv) => (
                    <label key={lv} className="vd-editor-level-radio" title={LEVEL_LABELS[lv]}>
                      <input
                        type="radio"
                        name="vd-level"
                        checked={currentLevel === lv}
                        onChange={() => {
                          if (currentLevel === lv || isReadonly) return;
                          const tableName = (id: string) =>
                            tableOptions.find((t) => t.id === id)?.name;
                          updateWithDraft((d) => {
                            const migrated = migrateToLevel(d, lv, tableName);
                            d.sourceTableId = migrated.sourceTableId;
                            d.query = migrated.query;
                          });
                        }}
                        disabled={isReadonly}
                      />
                      {" "}{LEVEL_LABELS[lv]}
                    </label>
                  ))}
                </div>
                <small className="vd-editor-level-hint">
                  Level 切替時は <code>sourceTableId</code> と <code>query</code> が排他的に書き換わります (既存の columns / sort / filter は維持)。
                </small>
              </div>

              {/* 成熟度 */}
              <label className="tbl-field">
                <span>成熟度</span>
                <div className="vd-editor-maturity-row">
                  <MaturityBadge
                    maturity={viewDefinition.maturity}
                    size="md"
                    onChange={isReadonly ? undefined : (m: Maturity) => updateWithDraft((d) => { d.maturity = m; })}
                  />
                  <span className="vd-editor-maturity-label">
                    {viewDefinition.maturity ?? "draft"}
                  </span>
                </div>
              </label>

            </div>
          </section>

          {/* ───── Section 2: Query (Level 別) (#748) ──────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              クエリ <small className="vd-editor-level-tag">{LEVEL_LABELS[currentLevel]}</small>
            </h3>

            {currentLevel === 1 && (
              <div className="seq-editor-grid">
                <div className="tbl-field">
                  <span>ソーステーブル <span className="vd-editor-required">*</span></span>
                  <select
                    value={(viewDefinition.sourceTableId as string | undefined) ?? ""}
                    onChange={(e) => updateWithDraft((d) => { d.sourceTableId = e.target.value as TableId; })}
                    className={getIssues(`ViewDefinition[${vdId}].sourceTableId`).length > 0 ? "input-error" : undefined}
                    disabled={isReadonly}
                  >
                    <option value="">— テーブルを選択 —</option>
                    {tableOptions.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <IssueHints issues={getIssues(`ViewDefinition[${vdId}].sourceTableId`)} />
                </div>
              </div>
            )}

            {currentLevel === 2 && (() => {
              const sq = (viewDefinition.query as ViewQueryStructured | undefined) ?? {
                from: { tableId: "" as TableId, alias: "a" },
              };
              const fromIssuePath = `ViewDefinition[${vdId}].query.from.tableId`;
              return (
                <div className="vd-query-structured">
                  {/* FROM */}
                  <div className="vd-query-row">
                    <span className="vd-query-label">FROM</span>
                    <select
                      value={(sq.from?.tableId as string | undefined) ?? ""}
                      onChange={(e) => updateWithDraft((d) => {
                        const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "a" } };
                        d.query = { ...cur, from: { ...cur.from, tableId: e.target.value as TableId } };
                      })}
                      className={getIssues(fromIssuePath).length > 0 ? "input-error" : undefined}
                      disabled={isReadonly}
                    >
                      <option value="">— テーブル —</option>
                      {tableOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span className="vd-query-as">AS</span>
                    <input
                      type="text"
                      value={sq.from?.alias ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "" } };
                        d.query = { ...cur, from: { ...cur.from, alias: e.target.value } };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="alias"
                      className="vd-query-alias-input"
                      pattern="^[a-z][a-z0-9_]*$"
                      title="snake_case (^[a-z][a-z0-9_]*$)"
                      disabled={isReadonly}
                    />
                  </div>
                  <IssueHints issues={getIssues(fromIssuePath)} />

                  {/* JOINS */}
                  <div className="vd-query-block">
                    <div className="vd-query-block-title">JOINS</div>
                    {(sq.joins ?? []).map((j, ji) => {
                      const joinIssuePath = `ViewDefinition[${vdId}].query.joins[${ji}].tableId`;
                      const aliasIssuePath = `ViewDefinition[${vdId}].query.joins[${ji}].alias`;
                      return (
                        <div key={ji} className="vd-query-join-row">
                          <select
                            value={j.kind}
                            onChange={(e) => updateWithDraft((d) => {
                              const cur = d.query as ViewQueryStructured;
                              const joins = [...(cur.joins ?? [])];
                              joins[ji] = { ...joins[ji], kind: e.target.value as ViewQueryJoin["kind"] };
                              d.query = { ...cur, joins };
                            })}
                            disabled={isReadonly}
                          >
                            {JOIN_KIND_OPTIONS.map((k) => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                          <span className="vd-query-as">JOIN</span>
                          <select
                            value={(j.tableId as string | undefined) ?? ""}
                            onChange={(e) => updateWithDraft((d) => {
                              const cur = d.query as ViewQueryStructured;
                              const joins = [...(cur.joins ?? [])];
                              joins[ji] = { ...joins[ji], tableId: e.target.value as TableId };
                              d.query = { ...cur, joins };
                            })}
                            className={getIssues(joinIssuePath).length > 0 ? "input-error" : undefined}
                            disabled={isReadonly}
                          >
                            <option value="">— テーブル —</option>
                            {tableOptions.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                          <span className="vd-query-as">AS</span>
                          <input
                            type="text"
                            value={j.alias}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              const cur = d.query as ViewQueryStructured;
                              const joins = [...(cur.joins ?? [])];
                              joins[ji] = { ...joins[ji], alias: e.target.value };
                              d.query = { ...cur, joins };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="alias"
                            className={`vd-query-alias-input${getIssues(aliasIssuePath).length > 0 ? " input-error" : ""}`}
                            disabled={isReadonly}
                          />
                          <span className="vd-query-as">ON</span>
                          <div className="vd-query-on-list">
                            {j.on.map((cond, oi) => (
                              <input
                                key={oi}
                                type="text"
                                value={cond}
                                onChange={(e) => updateSilentWithDraft((d) => {
                                  const cur = d.query as ViewQueryStructured;
                                  const joins = [...(cur.joins ?? [])];
                                  const on = [...(joins[ji].on ?? [])];
                                  on[oi] = e.target.value;
                                  joins[ji] = { ...joins[ji], on };
                                  d.query = { ...cur, joins };
                                })}
                                onBlur={() => { if (!isReadonly) commit(); }}
                                placeholder="o.customer_id = c.id"
                                className="vd-query-fragment-input"
                                disabled={isReadonly}
                              />
                            ))}
                            <button
                              type="button"
                              className="tbl-btn-icon"
                              onClick={() => updateWithDraft((d) => {
                                const cur = d.query as ViewQueryStructured;
                                const joins = [...(cur.joins ?? [])];
                                const on = [...(joins[ji].on ?? []), ""];
                                joins[ji] = { ...joins[ji], on };
                                d.query = { ...cur, joins };
                              })}
                              disabled={isReadonly}
                              title="ON 条件追加 (AND 結合)"
                            >
                              <i className="bi bi-plus-lg" />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="tbl-btn-icon danger"
                            onClick={() => updateWithDraft((d) => {
                              const cur = d.query as ViewQueryStructured;
                              const joins = (cur.joins ?? []).filter((_, i) => i !== ji);
                              d.query = { ...cur, joins: joins.length ? joins : undefined };
                            })}
                            disabled={isReadonly}
                            title="JOIN 削除"
                          >
                            <i className="bi bi-trash" />
                          </button>
                          <IssueHints issues={[...getIssues(joinIssuePath), ...getIssues(aliasIssuePath)]} />
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="tbl-btn tbl-btn-ghost"
                      onClick={() => updateWithDraft((d) => {
                        const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "a" } };
                        const usedAliases = new Set<string>([cur.from?.alias ?? ""]);
                        (cur.joins ?? []).forEach((j) => usedAliases.add(j.alias));
                        const newJoin: ViewQueryJoin = {
                          kind: "INNER",
                          tableId: "" as TableId,
                          alias: suggestAlias(undefined, usedAliases),
                          on: [""],
                        };
                        d.query = { ...cur, joins: [...(cur.joins ?? []), newJoin] };
                      })}
                      disabled={isReadonly}
                    >
                      <i className="bi bi-plus-lg" /> JOIN 追加
                    </button>
                  </div>

                  {/* WHERE / GROUP BY / HAVING / ORDER BY */}
                  {(["where", "groupBy", "having", "orderBy"] as const).map((kw) => {
                    const items = (sq[kw] ?? []) as string[];
                    const labelMap = {
                      where: ["WHERE", "AND 結合される条件式 (例: \"o.status = 'active'\")"],
                      groupBy: ["GROUP BY", "GROUP BY 列式 (例: \"o.customer_id\")"],
                      having: ["HAVING", "AND 結合される HAVING 条件 (例: \"COUNT(*) > 10\")"],
                      orderBy: ["ORDER BY", "ORDER BY 式 (例: \"o.created_at DESC\")"],
                    } as const;
                    const [label, hint] = labelMap[kw];
                    return (
                      <div key={kw} className="vd-query-block">
                        <div className="vd-query-block-title" title={hint}>{label}</div>
                        {items.map((cond, idx) => (
                          <div key={idx} className="vd-query-fragment-row">
                            <input
                              type="text"
                              value={cond}
                              onChange={(e) => updateSilentWithDraft((d) => {
                                const cur = d.query as ViewQueryStructured;
                                const arr = [...((cur[kw] as string[] | undefined) ?? [])];
                                arr[idx] = e.target.value;
                                d.query = { ...cur, [kw]: arr };
                              })}
                              onBlur={() => { if (!isReadonly) commit(); }}
                              placeholder={hint}
                              className="vd-query-fragment-input vd-query-fragment-input--full"
                              disabled={isReadonly}
                            />
                            <button
                              type="button"
                              className="tbl-btn-icon danger"
                              onClick={() => updateWithDraft((d) => {
                                const cur = d.query as ViewQueryStructured;
                                const arr = ((cur[kw] as string[] | undefined) ?? []).filter((_, i) => i !== idx);
                                d.query = { ...cur, [kw]: arr.length ? arr : undefined };
                              })}
                              disabled={isReadonly}
                              title="削除"
                            >
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="tbl-btn tbl-btn-ghost tbl-btn-sm"
                          onClick={() => updateWithDraft((d) => {
                            const cur = d.query as ViewQueryStructured;
                            const arr = [...((cur[kw] as string[] | undefined) ?? []), ""];
                            d.query = { ...cur, [kw]: arr };
                          })}
                          disabled={isReadonly}
                        >
                          <i className="bi bi-plus-lg" /> {label} 追加
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {currentLevel === 3 && (() => {
              const rq = (viewDefinition.query as ViewQueryRawSql | undefined) ?? { sql: "", parameterRefs: [] };
              return (
                <div className="vd-query-rawsql">
                  <div className="vd-query-block">
                    <div className="vd-query-block-title">SQL</div>
                    <textarea
                      value={rq.sql ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        const cur = (d.query as ViewQueryRawSql | undefined) ?? { sql: "", parameterRefs: [] };
                        d.query = { ...cur, sql: e.target.value };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder={"WITH ranked AS (\n  SELECT id, name, ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS rn FROM products\n)\nSELECT * FROM ranked WHERE rn <= @param.topN"}
                      rows={12}
                      className="vd-query-sql-textarea"
                      disabled={isReadonly}
                    />
                    <small className="vd-editor-level-hint">
                      式補間は ProcessFlow と同じく <code>@&lt;var&gt;</code> / <code>@conv.*</code> / <code>@env.*</code> / <code>@param.&lt;name&gt;</code>。
                    </small>
                  </div>

                  <div className="vd-query-block">
                    <div className="vd-query-block-title">parameterRefs</div>
                    {(rq.parameterRefs ?? []).map((p, pi) => (
                      <div key={pi} className="vd-query-fragment-row">
                        <input
                          type="text"
                          value={p.name as string}
                          onChange={(e) => updateSilentWithDraft((d) => {
                            const cur = d.query as ViewQueryRawSql;
                            const params = [...(cur.parameterRefs ?? [])];
                            params[pi] = { ...params[pi], name: e.target.value as Identifier };
                            d.query = { ...cur, parameterRefs: params };
                          })}
                          onBlur={() => { if (!isReadonly) commit(); }}
                          placeholder="paramName"
                          className="vd-query-fragment-input"
                          disabled={isReadonly}
                        />
                        <select
                          value={typeof p.fieldType === "string" ? p.fieldType : "string"}
                          onChange={(e) => updateWithDraft((d) => {
                            const cur = d.query as ViewQueryRawSql;
                            const params = [...(cur.parameterRefs ?? [])];
                            params[pi] = { ...params[pi], fieldType: e.target.value as FieldType };
                            d.query = { ...cur, parameterRefs: params };
                          })}
                          disabled={isReadonly}
                        >
                          {FIELD_TYPE_OPTIONS.map((ft) => (
                            <option key={ft} value={ft}>{ft}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={p.description ?? ""}
                          onChange={(e) => updateSilentWithDraft((d) => {
                            const cur = d.query as ViewQueryRawSql;
                            const params = [...(cur.parameterRefs ?? [])];
                            params[pi] = { ...params[pi], description: e.target.value || undefined };
                            d.query = { ...cur, parameterRefs: params };
                          })}
                          onBlur={() => { if (!isReadonly) commit(); }}
                          placeholder="description (任意)"
                          className="vd-query-fragment-input vd-query-fragment-input--full"
                          disabled={isReadonly}
                        />
                        <button
                          type="button"
                          className="tbl-btn-icon danger"
                          onClick={() => updateWithDraft((d) => {
                            const cur = d.query as ViewQueryRawSql;
                            const params = (cur.parameterRefs ?? []).filter((_, i) => i !== pi);
                            d.query = { ...cur, parameterRefs: params.length ? params : undefined };
                          })}
                          disabled={isReadonly}
                          title="削除"
                        >
                          <i className="bi bi-trash" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="tbl-btn tbl-btn-ghost tbl-btn-sm"
                      onClick={() => updateWithDraft((d) => {
                        const cur = (d.query as ViewQueryRawSql | undefined) ?? { sql: "" };
                        const newParam: ViewQueryParameterRef = {
                          name: "" as Identifier,
                          fieldType: "string" as FieldType,
                        };
                        d.query = { ...cur, parameterRefs: [...(cur.parameterRefs ?? []), newParam] };
                      })}
                      disabled={isReadonly}
                    >
                      <i className="bi bi-plus-lg" /> parameterRef 追加
                    </button>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* ───── Section 3: columns 編集 ────────────────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              カラム定義
              <span className="vd-editor-col-count">
                ({(viewDefinition.columns ?? []).length} 件)
              </span>
            </h3>

            <div className="vd-editor-columns-table-wrap">
              <table className="vd-editor-columns-table">
                <thead>
                  <tr>
                    <th>name <span className="vd-editor-required">*</span></th>
                    {currentLevel !== 3 && (
                      <>
                        <th title={currentLevel === 2 ? "from / joins[] のテーブルから選択" : "参照テーブル"}>
                          {currentLevel === 2 ? "alias.テーブル" : "参照テーブル"}
                        </th>
                        <th>参照カラム</th>
                      </>
                    )}
                    <th>表示名</th>
                    <th>type <span className="vd-editor-required">*</span></th>
                    <th>書式</th>
                    <th>幅</th>
                    <th>align</th>
                    <th title="ソート可能">sort</th>
                    <th title="フィルタ可能">filter</th>
                    <th>linkTo</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewDefinition.columns ?? []).map((col, ci) => {
                    const colName = col.name as string;
                    const refTableId = colRefTableIds[ci] ?? col.tableColumnRef?.tableId ?? viewDefinition.sourceTableId;
                    const colOptions = tableOptions.find((t) => t.id === refTableId)?.columns ?? [];
                    const basePath = colPath(ci, colName);
                    const colIssues = [
                      ...getIssues(basePath),
                      ...getIssues(`${basePath}.tableColumnRef`),
                      ...getIssues(`${basePath}.type`),
                    ];

                    return (
                      <tr key={ci} className={colIssues.some((i) => i.severity === "error") ? "vd-col-row--error" : colIssues.some((i) => i.severity === "warning") ? "vd-col-row--warning" : undefined}>
                        {/* name */}
                        <td>
                          <input
                            type="text"
                            value={col.name as string}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], name: e.target.value as Identifier };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="columnName"
                            className="vd-col-input-sm"
                            title="camelCase 識別子"
                            disabled={isReadonly}
                          />
                        </td>
                        {currentLevel !== 3 && (
                          <>
                            {/* 参照テーブル (cascade step 1) — Level 2 では in-scope alias リスト */}
                            <td>
                              <select
                                value={refTableId ?? ""}
                                onChange={(e) => setColRefTable(ci, e.target.value)}
                                className="vd-col-select"
                                disabled={isReadonly}
                              >
                                <option value="">— テーブル —</option>
                                {currentLevel === 2
                                  ? inScopeTables.map((s) => (
                                      <option key={`${s.alias}-${s.tableId}`} value={s.tableId}>
                                        {s.label}
                                      </option>
                                    ))
                                  : tableOptions.map((t) => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                              </select>
                            </td>
                            {/* 参照カラム (cascade step 2) */}
                            <td>
                              <select
                                value={col.tableColumnRef?.columnId ?? ""}
                                onChange={(e) => setColRefColumn(ci, e.target.value)}
                                className="vd-col-select"
                                disabled={!refTableId || isReadonly}
                              >
                                <option value="">— カラム —</option>
                                {colOptions.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </td>
                          </>
                        )}
                        {/* displayName */}
                        <td>
                          <input
                            type="text"
                            value={col.displayName ?? ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              d.columns[ci] = {
                                ...d.columns[ci],
                                displayName: (e.target.value || undefined) as ViewColumn["displayName"],
                              };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="表示名"
                            className="vd-col-input-sm"
                            disabled={isReadonly}
                          />
                        </td>
                        {/* type */}
                        <td>
                          <select
                            value={typeof col.type === "string" ? col.type : "string"}
                            onChange={(e) => updateColumn(ci, "type", e.target.value as FieldType)}
                            className="vd-col-select"
                            disabled={isReadonly}
                          >
                            {FIELD_TYPE_OPTIONS.map((ft) => (
                              <option key={ft} value={ft}>{ft}</option>
                            ))}
                          </select>
                        </td>
                        {/* displayFormat */}
                        <td>
                          <input
                            type="text"
                            value={col.displayFormat ?? ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], displayFormat: e.target.value || undefined };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="#,##0"
                            className="vd-col-input-xs"
                            disabled={isReadonly}
                          />
                        </td>
                        {/* width */}
                        <td>
                          <input
                            type="text"
                            value={col.width ?? ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], width: e.target.value || undefined };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="120px"
                            className="vd-col-input-xs"
                            disabled={isReadonly}
                          />
                        </td>
                        {/* align */}
                        <td>
                          <select
                            value={col.align ?? ""}
                            onChange={(e) => updateWithDraft((d) => {
                              d.columns[ci] = {
                                ...d.columns[ci],
                                align: (e.target.value || undefined) as ViewColumn["align"],
                              };
                            })}
                            className="vd-col-select-xs"
                            disabled={isReadonly}
                          >
                            <option value="">—</option>
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                          </select>
                        </td>
                        {/* sortable */}
                        <td className="vd-col-center">
                          <input
                            type="checkbox"
                            checked={col.sortable ?? false}
                            onChange={(e) => updateWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], sortable: e.target.checked || undefined };
                            })}
                            disabled={isReadonly}
                          />
                        </td>
                        {/* filterable */}
                        <td className="vd-col-center">
                          <input
                            type="checkbox"
                            checked={col.filterable ?? false}
                            onChange={(e) => updateWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], filterable: e.target.checked || undefined };
                            })}
                            disabled={isReadonly}
                          />
                        </td>
                        {/* linkTo */}
                        <td>
                          <input
                            type="text"
                            value={col.linkTo ?? ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              d.columns[ci] = { ...d.columns[ci], linkTo: e.target.value || undefined };
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="/orders/:id"
                            className="vd-col-input-sm"
                            disabled={isReadonly}
                          />
                        </td>
                        {/* 操作 */}
                        <td className="vd-col-ops">
                          <button
                            type="button"
                            className="tbl-btn-icon"
                            onClick={() => moveColumn(ci, "up")}
                            disabled={ci === 0 || isReadonly}
                            title="上に移動"
                          >
                            <i className="bi bi-arrow-up" />
                          </button>
                          <button
                            type="button"
                            className="tbl-btn-icon"
                            onClick={() => moveColumn(ci, "down")}
                            disabled={ci === (viewDefinition.columns?.length ?? 0) - 1 || isReadonly}
                            title="下に移動"
                          >
                            <i className="bi bi-arrow-down" />
                          </button>
                          <button
                            type="button"
                            className="tbl-btn-icon danger"
                            onClick={() => removeColumn(ci)}
                            title="削除"
                            disabled={isReadonly}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 列ごとの issue 表示 */}
            {(viewDefinition.columns ?? []).map((col, ci) => {
              const colName = col.name as string;
              const basePath = colPath(ci, colName);
              const colIssues = [
                ...getIssues(basePath),
                ...getIssues(`${basePath}.tableColumnRef`),
                ...getIssues(`${basePath}.type`),
              ];
              if (colIssues.length === 0) return null;
              return (
                <div key={ci} className="vd-editor-col-issues">
                  <span className="vd-editor-col-issues-label">
                    カラム {ci + 1} ({colName || "未設定"}):
                  </span>
                  <IssueHints issues={colIssues} />
                </div>
              );
            })}

            <button
              type="button"
              className="tbl-btn tbl-btn-ghost vd-editor-add-row-btn"
              onClick={addColumn}
              disabled={isReadonly}
            >
              <i className="bi bi-plus-lg" /> カラム追加
            </button>
          </section>

          {/* ───── Section 3: sortDefaults ────────────────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              既定ソート順
              <span className="vd-editor-col-count">({(viewDefinition.sortDefaults ?? []).length} 件)</span>
            </h3>

            {(viewDefinition.sortDefaults ?? []).length > 0 && (
              <table className="vd-editor-sub-table">
                <thead>
                  <tr>
                    <th>カラム名</th>
                    <th>順序</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewDefinition.sortDefaults ?? []).map((spec, si) => {
                    const siIssues = getIssues(sortPath(si));
                    return (
                      <tr key={si} className={siIssues.some((i) => i.severity === "error") ? "vd-col-row--error" : undefined}>
                        <td>
                          <select
                            value={spec.columnName as string}
                            onChange={(e) => updateSortSpec(si, "columnName", e.target.value as Identifier)}
                            className={siIssues.length > 0 ? "input-error" : undefined}
                            disabled={isReadonly}
                          >
                            <option value="">— カラムを選択 —</option>
                            {columnNames.map((cn) => (
                              <option key={cn} value={cn}>{cn}</option>
                            ))}
                          </select>
                          <IssueHints issues={siIssues} />
                        </td>
                        <td>
                          <select
                            value={spec.order}
                            onChange={(e) => updateSortSpec(si, "order", e.target.value as "asc" | "desc")}
                            disabled={isReadonly}
                          >
                            <option value="asc">asc (昇順)</option>
                            <option value="desc">desc (降順)</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="tbl-btn-icon danger"
                            onClick={() => removeSortSpec(si)}
                            title="削除"
                            disabled={isReadonly}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <button
              type="button"
              className="tbl-btn tbl-btn-ghost vd-editor-add-row-btn"
              onClick={addSortSpec}
              disabled={isReadonly}
            >
              <i className="bi bi-plus-lg" /> ソート条件追加
            </button>
          </section>

          {/* ───── Section 4: filterDefaults ─────────────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">
              初期フィルタ
              <span className="vd-editor-col-count">({(viewDefinition.filterDefaults ?? []).length} 件)</span>
            </h3>

            {(viewDefinition.filterDefaults ?? []).length > 0 && (
              <table className="vd-editor-sub-table">
                <thead>
                  <tr>
                    <th>カラム名</th>
                    <th>演算子</th>
                    <th>値</th>
                    <th>値 (式)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewDefinition.filterDefaults ?? []).map((spec, fi) => {
                    const colIssues = getIssues(filterPath(fi, "columnName"));
                    const opIssues = getIssues(filterPath(fi, "operator"));
                    return (
                      <tr
                        key={fi}
                        className={
                          [...colIssues, ...opIssues].some((i) => i.severity === "error")
                            ? "vd-col-row--error"
                            : [...colIssues, ...opIssues].some((i) => i.severity === "warning")
                              ? "vd-col-row--warning"
                              : undefined
                        }
                      >
                        <td>
                          <select
                            value={spec.columnName as string}
                            onChange={(e) => updateFilterSpec(fi, "columnName", e.target.value as Identifier)}
                            className={colIssues.length > 0 ? "input-error" : undefined}
                            disabled={isReadonly}
                          >
                            <option value="">— カラムを選択 —</option>
                            {columnNames.map((cn) => (
                              <option key={cn} value={cn}>{cn}</option>
                            ))}
                          </select>
                          <IssueHints issues={colIssues} />
                        </td>
                        <td>
                          <select
                            value={spec.operator}
                            onChange={(e) => updateFilterSpec(fi, "operator", e.target.value as FilterOperator)}
                            className={opIssues.length > 0 ? "input-error" : undefined}
                            disabled={isReadonly}
                          >
                            {FILTER_OPERATORS.map((op) => (
                              <option key={op} value={op}>{op}</option>
                            ))}
                          </select>
                          <IssueHints issues={opIssues} />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={typeof spec.value === "string" ? spec.value : spec.value != null ? String(spec.value) : ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              const specs = d.filterDefaults ?? [];
                              specs[fi] = { ...specs[fi], value: e.target.value || undefined };
                              d.filterDefaults = specs;
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="比較値"
                            className="vd-col-input-sm"
                            disabled={isReadonly}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={spec.valueExpression ?? ""}
                            onChange={(e) => updateSilentWithDraft((d) => {
                              const specs = d.filterDefaults ?? [];
                              specs[fi] = { ...specs[fi], valueExpression: (e.target.value || undefined) as FilterSpec["valueExpression"] };
                              d.filterDefaults = specs;
                            })}
                            onBlur={() => { if (!isReadonly) commit(); }}
                            placeholder="@conv.numbering.threshold"
                            className="vd-col-input-sm"
                            disabled={isReadonly}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="tbl-btn-icon danger"
                            onClick={() => removeFilterSpec(fi)}
                            title="削除"
                            disabled={isReadonly}
                          >
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <button
              type="button"
              className="tbl-btn tbl-btn-ghost vd-editor-add-row-btn"
              onClick={addFilterSpec}
              disabled={isReadonly}
            >
              <i className="bi bi-plus-lg" /> フィルタ条件追加
            </button>
          </section>

          {/* ───── Section 5: その他 ─────────────────────────────────────── */}
          <section className="seq-editor-section">
            <h3 className="seq-editor-section-title">その他</h3>
            <div className="seq-editor-grid">

              {/* pageSize */}
              <label className="tbl-field">
                <span>ページサイズ <small>(1..1000)</small></span>
                <input
                  type="number"
                  value={viewDefinition.pageSize ?? ""}
                  min={1}
                  max={1000}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : undefined;
                    updateWithDraft((d) => { d.pageSize = v; });
                  }}
                  placeholder="20"
                  className="vd-editor-number-input"
                  disabled={isReadonly}
                />
              </label>

              {/* groupBy */}
              <div className="tbl-field">
                <span>groupBy</span>
                <select
                  value={viewDefinition.groupBy ?? ""}
                  onChange={(e) => updateWithDraft((d) => {
                    d.groupBy = (e.target.value || undefined) as Identifier | undefined;
                  })}
                  className={getIssues(`ViewDefinition[${vdId}].groupBy`).length > 0 ? "input-error" : undefined}
                  disabled={isReadonly}
                >
                  <option value="">— なし —</option>
                  {columnNames.map((cn) => (
                    <option key={cn} value={cn}>{cn}</option>
                  ))}
                </select>
                <IssueHints issues={getIssues(`ViewDefinition[${vdId}].groupBy`)} />
              </div>

            </div>
          </section>

        </div>{/* seq-editor-left-col */}
      </div>
    </div>
  );
}
