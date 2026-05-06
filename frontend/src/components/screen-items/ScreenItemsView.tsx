/**
 * 画面項目定義ビュー (#318 プロトタイプ、#323 既存画面からの抽出対応)。
 *
 * #696: per-screen タブ化。useParams<{ screenId }> で画面 ID を取得し、
 * 1 画面 = 1 タブ = 1 draft モデルに統一。
 *
 * 項目追加経路 3 つ:
 * 1. 空欄追加 (従来)
 * 2. 画面デザインから選択 (#323 — モーダルで候補リスト + チェックボックス)
 * 3. (将来) GrapesJS サイドバーからの直接追加 (#322)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { EditorHeader } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import {
  loadScreenItems,
  saveScreenItems,
} from "../../store/screenItemsStore";
import { loadProject } from "../../store/flowStore";
import { loadConventions } from "../../store/conventionsStore";
import { checkScreenItemConventionReferences } from "../../schemas/conventionsValidator";
import type { ConventionsCatalog, ConventionIssue } from "../../schemas/conventionsValidator";
import { mcpBridge } from "../../mcp/mcpBridge";
import type {
  ScreenItem,
  ValueSource,
  FieldType,
  FieldTypePrimitive,
  Identifier,
  IdentifierPath,
  TableId,
  ViewId,
  LocalId,
  PhysicalName,
  ProcessFlowId,
  TableColumnRef,
  ViewColumnRef,
} from "../../types/v3";
import type { ScreenItemsDocument } from "../../store/screenItemsStore";
import type { ProcessFlowMeta } from "../../types/action";
import { listProcessFlows } from "../../store/processFlowStore";
import { listTables, loadTable } from "../../store/tableStore";
import { listViews, loadView } from "../../store/viewStore";
import type { Table, View } from "../../types/v3";
import { ConvCompletionInput } from "../common/ConvCompletionInput";
import { ScreenItemCandidatesModal } from "./ScreenItemCandidatesModal";
import type { ExtractedCandidate } from "../../utils/screenItemExtractor";
import { generateAutoId, getFieldTypePrefix } from "../../utils/screenItemNaming";
import "../../styles/screen-items.css";
import "../../styles/editMode.css";

const PRIMITIVE_TYPES: FieldTypePrimitive[] =
  ["string", "number", "integer", "boolean", "date", "datetime", "json"];

const DISPLAY_FORMAT_PRESETS = [
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "YYYY年MM月DD日",
  "YYYY/MM/DD HH:mm:ss",
  "#,##0",
  "0.00",
  "#,##0.00",
  "¥#,##0",
  "$#,##0.00",
  "0%",
  "0.00%",
];

const VALUE_SOURCE_KINDS = [
  { value: "flowVariable", label: "処理フロー変数" },
  { value: "tableColumn", label: "テーブル列" },
  { value: "viewColumn", label: "ビュー列" },
  { value: "expression", label: "計算式" },
] as const;

type OutputFieldsProps = {
  item: ScreenItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<ScreenItem>) => void;
  onCommit: () => void;
  tables: Table[];
  views: View[];
  isReadonly?: boolean;
};

function OutputFields({ item, idx, onUpdate, onCommit, tables, views, isReadonly }: OutputFieldsProps) {
  const kind = item.valueFrom?.kind ?? "";

  const handleKindChange = (newKind: string) => {
    if (!newKind) {
      onUpdate(idx, { valueFrom: undefined });
    } else if (newKind === "flowVariable") {
      onUpdate(idx, { valueFrom: { kind: "flowVariable", variableName: "" as IdentifierPath } });
    } else if (newKind === "tableColumn") {
      onUpdate(idx, {
        valueFrom: {
          kind: "tableColumn",
          ref: { tableId: "" as TableId, columnId: "" as LocalId },
        },
      });
    } else if (newKind === "viewColumn") {
      onUpdate(idx, {
        valueFrom: {
          kind: "viewColumn",
          ref: { viewId: "" as ViewId, columnPhysicalName: "" as PhysicalName },
        },
      });
    } else if (newKind === "expression") {
      onUpdate(idx, { valueFrom: { kind: "expression", expression: "" } });
    }
    onCommit();
  };

  const handleValueFromPatch = (patch: Partial<ValueSource>) => {
    if (!item.valueFrom) return;
    onUpdate(idx, { valueFrom: { ...item.valueFrom, ...patch } as ValueSource });
  };

  return (
    <div className="screen-items-output-section">
      <div className="screen-items-output-title">出力設定</div>
      <div className="screen-items-output-fields">
        <label className="screen-items-detail-field" style={{ minWidth: "14em", maxWidth: "20em" }}>
          <span className="screen-items-detail-label">表示フォーマット</span>
          <input
            type="text"
            list="screen-items-display-format-list"
            className="form-control form-control-sm"
            value={item.displayFormat ?? ""}
            onChange={(e) => onUpdate(idx, { displayFormat: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="YYYY/MM/DD"
            disabled={isReadonly}
          />
        </label>
        <div className="screen-items-valuefrom">
          <label className="screen-items-detail-field" style={{ minWidth: "10em", maxWidth: "14em" }}>
            <span className="screen-items-detail-label">バインド元 (種別)</span>
            <select
              className="form-select form-select-sm"
              value={kind}
              onChange={(e) => handleKindChange(e.target.value)}
              disabled={isReadonly}
            >
              <option value="">— 未設定 —</option>
              {VALUE_SOURCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          {kind === "flowVariable" && (() => {
            const vf = item.valueFrom as Extract<ValueSource, { kind: "flowVariable" }>;
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">処理フロー</span>
                  <input
                    type="text"
                    list="screen-items-process-flow-list"
                    className="form-control form-control-sm"
                    value={vf.processFlowId ?? ""}
                    onChange={(e) =>
                      handleValueFromPatch({
                        processFlowId: (e.target.value || undefined) as ProcessFlowId | undefined,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    placeholder="省略可"
                    disabled={isReadonly}
                  />
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">変数名</span>
                  <input
                    className="form-control form-control-sm"
                    value={vf.variableName as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        variableName: e.target.value as IdentifierPath,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    placeholder="createdOrder.order_number"
                    disabled={isReadonly}
                  />
                </label>
              </>
            );
          })()}
          {kind === "tableColumn" && (() => {
            const vf = item.valueFrom as Extract<ValueSource, { kind: "tableColumn" }>;
            const selectedTable = tables.find((t) => t.id === vf.ref.tableId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">テーブル</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.tableId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          tableId: e.target.value as TableId,
                          columnId: "" as LocalId,
                        } as TableColumnRef,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    disabled={isReadonly}
                  >
                    <option value="">— テーブル選択 —</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">列</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.columnId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          tableId: vf.ref.tableId,
                          columnId: e.target.value as LocalId,
                        } as TableColumnRef,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    disabled={isReadonly || !selectedTable}
                  >
                    <option value="">— 列選択 —</option>
                    {selectedTable?.columns?.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.physicalName}</option>
                    ))}
                  </select>
                </label>
              </>
            );
          })()}
          {kind === "viewColumn" && (() => {
            const vf = item.valueFrom as Extract<ValueSource, { kind: "viewColumn" }>;
            const selectedView = views.find((v) => v.id === vf.ref.viewId);
            return (
              <>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">ビュー</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.viewId as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          viewId: e.target.value as ViewId,
                          columnPhysicalName: "" as PhysicalName,
                        } as ViewColumnRef,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    disabled={isReadonly}
                  >
                    <option value="">— ビュー選択 —</option>
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </label>
                <label className="screen-items-detail-field" style={{ minWidth: "12em" }}>
                  <span className="screen-items-detail-label">列 (物理名)</span>
                  <select
                    className="form-select form-select-sm"
                    value={vf.ref.columnPhysicalName as string}
                    onChange={(e) =>
                      handleValueFromPatch({
                        ref: {
                          viewId: vf.ref.viewId,
                          columnPhysicalName: e.target.value as PhysicalName,
                        } as ViewColumnRef,
                      } as Partial<ValueSource>)
                    }
                    onBlur={onCommit}
                    disabled={isReadonly || !selectedView}
                  >
                    <option value="">— 列選択 —</option>
                    {selectedView?.outputColumns.map((c) => (
                      <option key={c.physicalName} value={c.physicalName}>
                        {c.name ?? c.physicalName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            );
          })()}
          {kind === "expression" && (
            <label className="screen-items-detail-field" style={{ minWidth: "18em", flex: 2 }}>
              <span className="screen-items-detail-label">計算式</span>
              <input
                className="form-control form-control-sm"
                value={(item.valueFrom as Extract<ValueSource, { kind: "expression" }>).expression}
                onChange={(e) => handleValueFromPatch({ expression: e.target.value } as Partial<ValueSource>)}
                onBlur={onCommit}
                placeholder="@inputs.price * @inputs.qty"
                disabled={isReadonly}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

const JS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

type ScreenMeta = { id: string; name: string };

/** useResourceEditor 互換のため画面項目を読み書きする load/save ラッパー */
async function loadFile(screenId: string): Promise<ScreenItemsDocument | null> {
  return loadScreenItems(screenId);
}
async function saveFile(data: ScreenItemsDocument): Promise<void> {
  await saveScreenItems(data);
}

export function ScreenItemsView() {
  const { screenId } = useParams<{ screenId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [screens, setScreens] = useState<ScreenMeta[]>([]);
  const [candidatesModalOpen, setCandidatesModalOpen] = useState(false);
  const [conventions, setConventions] = useState<ConventionsCatalog | null>(null);
  const [lintIssues, setLintIssues] = useState<ConventionIssue[]>([]);
  const [expandedErrorRows, setExpandedErrorRows] = useState<Set<number>>(new Set());
  const [expandedDetailRows, setExpandedDetailRows] = useState<Set<number>>(new Set());
  const [processFlows, setProcessFlows] = useState<ProcessFlowMeta[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [views, setViews] = useState<View[]>([]);

  // Edit session state
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const sessionId = mcpBridge.getSessionId();

  /** ID フィールドのフォーカス時の値 (行インデックス → 元の値) */
  const idFocusVals = useRef<Map<number, string>>(new Map());

  /** リネーム確認ダイアログの状態 */
  const [pendingRename, setPendingRename] = useState<{
    idx: number;
    oldId: string;
    newId: string;
    affectedGroups: Array<{ id: string; name: string; refCount: number }>;
    totalRefs: number;
  } | null>(null);

  /** ID リセット確認ダイアログの状態 */
  const [pendingReset, setPendingReset] = useState<{
    resets: Array<{ idx: number; oldId: string; newId: string }>;
    affectedGroups: Array<{ id: string; name: string; refCount: number }>;
    totalRefs: number;
  } | null>(null);

  /** 複数選択中の行インデックス */
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // 規約カタログをロード (初回のみ)
  useEffect(() => {
    loadConventions().then(setConventions).catch(console.error);
  }, []);

  // 処理フロー・テーブル・ビュー一覧をロード (valueFrom セレクタ用、列まで含む完全形)
  useEffect(() => {
    listProcessFlows().then(setProcessFlows).catch(console.error);
    (async () => {
      const tableMetas = await listTables();
      const tablesFull = (await Promise.all(tableMetas.map((m) => loadTable(m.id))))
        .filter((t): t is Table => t !== null);
      setTables(tablesFull);
    })().catch(console.error);
    (async () => {
      const viewMetas = await listViews();
      const viewsFull = (await Promise.all(viewMetas.map((m) => loadView(m.id))))
        .filter((v): v is View => v !== null);
      setViews(viewsFull);
    })().catch(console.error);
  }, []);

  // 画面一覧をロード (初回 + MCP 接続復帰時)。onNotFound ハンドリング用に画面一覧も保持。
  useEffect(() => {
    let mounted = true;
    const doLoad = () => {
      loadProject().then((p) => {
        if (!mounted) return;
        const metas = p.screens.map((s) => ({ id: s.id, name: s.name }));
        setScreens(metas);
        // screenId が存在しない場合は画面一覧へ遷移
        if (screenId && !metas.some((m) => m.id === screenId)) {
          navigate(wsPath("/screen/list"), { replace: true });
        }
      }).catch(console.error);
    };
    mcpBridge.startWithoutEditor();
    doLoad();
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected") doLoad();
    });
    return () => {
      mounted = false;
      unsubStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId]);

  const {
    state: file,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit,
    undo, redo, canUndo, canRedo,
    handleSave: resourceHandleSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<ScreenItemsDocument>({
    tabType: "screen-items",
    mtimeKind: "screenEntity",
    draftKind: "screen-items",
    id: screenId,
    load: loadFile,
    save: saveFile,
    broadcastName: "screenItemsChanged",
    broadcastIdField: "screenId",
    onNotFound: () => navigate(wsPath("/screen/list"), { replace: true }),
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "screen-item",
    resourceId: screenId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";
  const fileRef = useRef<ScreenItemsDocument | null>(null);
  useEffect(() => { fileRef.current = file ?? null; }, [file]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (f: ScreenItemsDocument) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!screenId || !fileRef.current) return;
      mcpBridge.updateDraft("screen-item", screenId, fileRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update, screenId]);

  const updateSilentWithDraft = useCallback((fn: (f: ScreenItemsDocument) => void) => {
    if (isReadonly) return;
    updateSilent(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!screenId || !fileRef.current) return;
      mcpBridge.updateDraft("screen-item", screenId, fileRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, updateSilent, screenId]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    // pending debounce があればキャンセルして即 flush
    // 編集開始直後に保存した場合 draft が空のまま commitDraft に到達してゾンビロックになるのを防ぐ
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (screenId && fileRef.current) {
      await mcpBridge.updateDraft("screen-item", screenId, fileRef.current);
    }
    await resourceHandleSave();
    await actions.save();
  }, [isReadonly, isSaving, resourceHandleSave, actions, screenId]);

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
    if (screenId) await mcpBridge.discardDraft("screen-item", screenId);
    await reload();
  }, [screenId, reload]);

  // タブ dirty マーク
  useEffect(() => {
    if (!screenId) return;
    const tabId = makeTabId("screen-items", screenId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [screenId, isDirtyForTab, isDirty]);

  // 復元ダイアログ (readonly + draft 存在時)
  useEffect(() => {
    if (sessionLoading) return;
    if (mode.kind !== "readonly") return;
    if (!screenId) return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("screen-item", screenId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind, screenId]);

  const handleAddItem = useCallback(() => {
    updateWithDraft((f) => {
      f.items.push({
        id: "" as Identifier,
        label: "",
        type: "string",
      });
    });
  }, [updateWithDraft]);

  const handleUpdateItem = useCallback((idx: number, patch: Partial<ScreenItem>) => {
    updateSilentWithDraft((f) => {
      Object.assign(f.items[idx], patch);
    });
  }, [updateSilentWithDraft]);

  const handleRemoveItem = useCallback((idx: number) => {
    updateWithDraft((f) => {
      f.items.splice(idx, 1);
    });
    setSelectedIndices((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
    setExpandedErrorRows((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
    setExpandedDetailRows((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
  }, [updateWithDraft]);

  /** 複数インデックスのリセット用新 ID を計算 (バッチ内で重複しないよう pool を積み上げ) */
  const buildResets = useCallback((indices: number[]): Array<{ idx: number; oldId: string; newId: string }> => {
    if (!file) return [];
    const indicesSet = new Set(indices);
    const pool: string[] = file.items
      .filter((_, i) => !indicesSet.has(i))
      .map((item) => item.id as string)
      .filter(Boolean);

    return indices.map((idx) => {
      const item = file.items[idx];
      const prefix = item.direction === "output" ? "textDisplay" : getFieldTypePrefix(item.type);
      const newId = generateAutoId(prefix, pool);
      pool.push(newId);
      return { idx, oldId: item.id as string, newId };
    });
  }, [file]);

  /** ID リセット開始: 参照チェック → 確認ダイアログ or 即実行 */
  const handleResetItems = useCallback(async (indices: number[]) => {
    if (!file || !screenId) return;
    if (isDirty) {
      alert("未保存の変更があります。先に保存してからIDをリセットしてください。");
      return;
    }
    const resets = buildResets(indices);
    if (resets.length === 0) return;

    // 空 ID 行はリネーム不要 (local に新 ID を直接セット)
    const toLocalSet = resets.filter((r) => !r.oldId);
    const toRename = resets.filter((r) => !!r.oldId);

    if (toLocalSet.length > 0) {
      updateSilentWithDraft((f) => {
        for (const { idx, newId } of toLocalSet) {
          f.items[idx].id = newId as Identifier;
        }
      });
      commit();
    }

    if (toRename.length === 0) return;

    // 参照チェック (全対象を並列チェック)
    try {
      const results = await Promise.all(
        toRename.map((r) =>
          mcpBridge.request("checkScreenItemRefs", {
            screenId: screenId,
            itemId: r.oldId,
          }) as Promise<{ affectedProcessFlows: Array<{ id: string; name: string; refCount: number }>; totalRefs: number }>,
        ),
      );

      const totalRefs = results.reduce((s, r) => s + r.totalRefs, 0);

      // 処理フロー名でまとめる (同一グループが複数 reset で重複する可能性あり)
      const groupMap = new Map<string, { id: string; name: string; refCount: number }>();
      for (const r of results) {
        for (const ag of r.affectedProcessFlows) {
          const existing = groupMap.get(ag.id);
          if (existing) existing.refCount += ag.refCount;
          else groupMap.set(ag.id, { ...ag });
        }
      }
      const affectedGroups = [...groupMap.values()];

      if (totalRefs === 0) {
        // 参照なし → 即実行
        for (const { oldId, newId } of toRename) {
          await mcpBridge.request("renameScreenItem", {
            screenId: screenId,
            oldId,
            newId,
          });
        }
        // ローカル state も同期 (保存操作で古い ID が上書きされるのを防ぐ)
        updateSilentWithDraft((f) => {
          for (const { idx, newId } of toRename) {
            f.items[idx].id = newId as Identifier;
          }
        });
        commit();
      } else {
        setPendingReset({ resets: toRename, affectedGroups, totalRefs });
      }
    } catch {
      // MCP 未接続等: ローカルのみ更新
      updateSilentWithDraft((f) => {
        for (const { idx, newId } of toRename) {
          f.items[idx].id = newId as Identifier;
        }
      });
      commit();
    }
  }, [file, screenId, isDirty, buildResets, updateSilentWithDraft, commit]);

  /** リセット確認: renameScreenItem を順次実行 */
  const handleConfirmReset = useCallback(async () => {
    if (!pendingReset || !screenId) return;
    const { resets } = pendingReset;
    setPendingReset(null);
    try {
      for (const { oldId, newId } of resets) {
        await mcpBridge.request("renameScreenItem", {
          screenId: screenId,
          oldId,
          newId,
        });
      }
      // ローカル state も同期 (保存操作で古い ID が上書きされるのを防ぐ)
      updateSilentWithDraft((f) => {
        for (const { idx, newId } of resets) {
          f.items[idx].id = newId as Identifier;
        }
      });
      commit();
    } catch (e) {
      alert(`IDリセットに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [pendingReset, screenId, updateSilentWithDraft, commit]);

  const handleCancelReset = useCallback(() => {
    setPendingReset(null);
  }, []);

  /** 行チェックボックスのトグル */
  const handleToggleRow = useCallback((idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  /** 候補モーダルから受け取った ExtractedCandidate[] を ScreenItem[] として一括追加。
   *  HTML name 属性 (c.name) を業務識別子 ScreenItem.id として採用する。未設定なら空文字。 */
  const handleAddCandidates = useCallback((cands: ExtractedCandidate[]) => {
    if (cands.length === 0) return;
    updateWithDraft((f) => {
      for (const c of cands) {
        f.items.push({
          id: (c.name || "") as Identifier,
          label: c.label || "",
          type: c.type,
          required: c.required,
          minLength: c.minLength,
          maxLength: c.maxLength,
          pattern: c.pattern,
          placeholder: c.placeholder,
        });
      }
    });
  }, [updateWithDraft]);

  /** ID フィールドの blur 時: 変更あり + 参照あり → 確認ダイアログを表示 */
  const handleIdBlur = useCallback(async (idx: number, e: React.FocusEvent<HTMLInputElement>) => {
    const newId = e.target.value;
    const originalId = idFocusVals.current.get(idx) ?? newId;
    idFocusVals.current.delete(idx);

    if (newId === originalId || !originalId || !screenId) {
      commit();
      return;
    }

    // 空文字はリネーム不可 → 元の ID に戻す
    if (!newId) {
      updateSilentWithDraft((f) => { f.items[idx].id = originalId as Identifier; });
      commit();
      return;
    }

    // 無効な JS 識別子はバックエンドに送る前に弾く
    if (!JS_IDENTIFIER_RE.test(newId)) {
      alert(`"${newId}" は有効な ID ではありません。英字・_ ・$ で始まり、英数字・_ ・$ のみ使用できます。`);
      updateSilentWithDraft((f) => { f.items[idx].id = originalId as Identifier; });
      commit();
      return;
    }

    // 同画面内の他の項目との重複チェック
    if (file?.items.some((item, i) => i !== idx && item.id === newId)) {
      alert(`ID "${newId}" は既に同じ画面内で使用されています。`);
      updateSilentWithDraft((f) => { f.items[idx].id = originalId as Identifier; });
      commit();
      return;
    }

    try {
      const result = await mcpBridge.request("checkScreenItemRefs", {
        screenId: screenId,
        itemId: originalId,
      }) as { affectedProcessFlows: Array<{ id: string; name: string; refCount: number }>; totalRefs: number };

      if (result.totalRefs === 0) {
        commit();
        return;
      }

      setPendingRename({
        idx,
        oldId: originalId,
        newId,
        affectedGroups: result.affectedProcessFlows,
        totalRefs: result.totalRefs,
      });
    } catch {
      commit();
    }
  }, [screenId, file, updateSilentWithDraft, commit]);

  /** リネーム確認: バックエンドに実行を委譲 */
  const handleConfirmRename = useCallback(async () => {
    if (!pendingRename || !screenId) return;
    const { idx, oldId, newId } = pendingRename;
    setPendingRename(null);
    try {
      await mcpBridge.request("renameScreenItem", {
        screenId: screenId,
        oldId,
        newId,
      });
      // ローカル state は onChange で既に newId に更新済み。draft を確定させるだけ。
      // (wsBridge は送信元を除外して broadcast するため、このタブへの自動リロードはない)
      commit();
    } catch (e) {
      alert(`リネームに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      // 失敗時はローカル状態を元に戻す
      updateSilentWithDraft((f) => { f.items[idx].id = oldId as Identifier; });
      commit();
    }
  }, [pendingRename, screenId, updateSilentWithDraft, commit]);

  /** リネームキャンセル: ローカル状態を元に戻す */
  const handleCancelRename = useCallback(() => {
    if (!pendingRename) return;
    updateSilentWithDraft((f) => { f.items[pendingRename.idx].id = pendingRename.oldId as Identifier; });
    commit();
    setPendingRename(null);
  }, [pendingRename, updateSilentWithDraft, commit]);

  // @conv.* lint (file または conventions 更新時)
  useEffect(() => {
    if (!file || !conventions) { setLintIssues([]); return; }
    setLintIssues(checkScreenItemConventionReferences(file, conventions));
  }, [file, conventions]);

  // 行インデックスごとの lint issues (行ハイライト用)
  const lintByRow = useMemo(() => {
    const map = new Map<number, ConventionIssue[]>();
    for (const issue of lintIssues) {
      const m = issue.path.match(/^items\[(\d+)\]/);
      if (m) {
        const idx = +m[1];
        if (!map.has(idx)) map.set(idx, []);
        map.get(idx)!.push(issue);
      }
    }
    return map;
  }, [lintIssues]);

  const existingIds = useMemo(
    () => new Set((file?.items ?? []).map((i) => i.id).filter(Boolean)),
    [file]
  );

  const itemCount = file?.items.length ?? 0;
  const allSelected = itemCount > 0 && selectedIndices.size === itemCount;
  const someSelected = selectedIndices.size > 0 && !allSelected;

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(Array.from({ length: itemCount }, (_, i) => i)));
    }
  }, [allSelected, itemCount]);

  const handleUpdateErrorMessage = useCallback((idx: number, key: string, val: string) => {
    updateSilentWithDraft((f) => {
      const em = { ...(f.items[idx].errorMessages ?? {}) };
      if (val) em[key] = val;
      else delete em[key];
      f.items[idx].errorMessages = Object.keys(em).length > 0 ? em : undefined;
    });
  }, [updateSilentWithDraft]);

  const handleToggleErrorRow = useCallback((idx: number) => {
    setExpandedErrorRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleToggleDetailRow = useCallback((idx: number) => {
    setExpandedDetailRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // ファイル切替時に選択・展開状態をリセット
  useEffect(() => {
    setSelectedIndices(new Set());
    setExpandedErrorRows(new Set());
    setExpandedDetailRows(new Set());
  }, [screenId]);

  const selectedScreenName = screens.find((s) => s.id === screenId)?.name;

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  return (
    <div className={`screen-items-view${isReadonly ? " readonly-mode" : ""}`}>
      <TableSubToolbar />

      {serverChanged && (
        <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={() => { handleSave().catch(console.error); }}
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
          <span className="fw-semibold">
            <i className="bi bi-ui-checks-grid me-1" />
            {selectedScreenName ? `${selectedScreenName} — 項目定義` : "画面項目定義"}
          </span>
        }
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo }}
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: () => setShowDiscardDialog(true) }}
      />

      <div className="screen-items-content">
        {screenId && file && (
          <>
          {lintIssues.length > 0 && (
            <div className="screen-items-lint-warnings">
              <i className="bi bi-exclamation-triangle-fill me-1" />
              <strong>@conv.* 参照エラー {lintIssues.length} 件</strong>
              <ul className="mb-0 mt-1">
                {lintIssues.map((issue, i) => (
                  <li key={i}>
                    <code className="me-1">{issue.value}</code>
                    <span className="text-muted">({issue.path})</span>
                    <span className="ms-1">{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="screen-items-table-wrap">
            <table className="screen-items-table">
              <colgroup>
                <col style={{ width: 24 }} />
                <col style={{ width: 40 }} />
                <col style={{ width: "12em" }} />
                <col style={{ width: "12em" }} />
                <col style={{ width: "9em" }} />
                <col style={{ width: "5em" }} />
                <col style={{ width: "4em" }} />
                <col style={{ width: "5em" }} />
                <col style={{ width: "5em" }} />
                <col style={{ width: "12em" }} />
                <col />
                <col style={{ width: 76 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-center">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={handleToggleAll}
                      aria-label="全選択"
                    />
                  </th>
                  <th>#</th>
                  <th>ID</th>
                  <th>ラベル</th>
                  <th>型</th>
                  <th>方向</th>
                  <th className="text-center">必須</th>
                  <th>最小長</th>
                  <th>最大長</th>
                  <th>pattern</th>
                  <th>description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {file.items.length === 0 && (
                  <tr>
                    <td colSpan={12} className="screen-items-empty-row">
                      項目がありません。下のボタンから追加してください。
                    </td>
                  </tr>
                )}
                {file.items.map((item, i) => (
                  <React.Fragment key={i}>
                  <tr className={selectedIndices.has(i) ? "screen-items-row-selected" : ""}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={selectedIndices.has(i)}
                        onChange={() => handleToggleRow(i)}
                        aria-label={`行${i + 1}を選択`}
                      />
                    </td>
                    <td className="screen-items-no">
                      {i + 1}
                      {lintByRow.has(i) && (
                        <i
                          className="bi bi-exclamation-circle-fill text-warning ms-1"
                          title={lintByRow.get(i)!.map((e) => e.message).join("\n")}
                        />
                      )}
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={item.id}
                        onChange={(e) => handleUpdateItem(i, { id: e.target.value as Identifier })}
                        onFocus={(e) => idFocusVals.current.set(i, e.target.value)}
                        onBlur={(e) => handleIdBlur(i, e)}
                        placeholder="email"
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={item.label}
                        onChange={(e) => handleUpdateItem(i, { label: e.target.value })}
                        onBlur={commit}
                        placeholder="メールアドレス"
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        list="screen-items-type-list"
                        className="form-control form-control-sm"
                        value={typeof item.type === "string"
                          ? item.type
                          : item.type.kind === "extension"
                            ? item.type.extensionRef
                            : item.type.kind}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            handleUpdateItem(i, { type: "string" });
                          } else if ((PRIMITIVE_TYPES as string[]).includes(v)) {
                            handleUpdateItem(i, { type: v as FieldType });
                          } else {
                            handleUpdateItem(i, { type: { kind: "extension", extensionRef: v } });
                          }
                        }}
                        onBlur={commit}
                        placeholder="string"
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={item.direction ?? "input"}
                        onChange={(e) => handleUpdateItem(i, { direction: e.target.value === "output" ? "output" : undefined })}
                        onBlur={commit}
                        aria-label="方向"
                        disabled={isReadonly}
                      >
                        <option value="input">入力</option>
                        <option value="output">出力</option>
                      </select>
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={!!item.required}
                        onChange={(e) => handleUpdateItem(i, { required: e.target.checked || undefined })}
                        aria-label="必須"
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={item.minLength ?? ""}
                        min={0}
                        onChange={(e) => handleUpdateItem(i, { minLength: e.target.value === "" ? undefined : Number(e.target.value) })}
                        onBlur={commit}
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={item.maxLength ?? ""}
                        min={0}
                        onChange={(e) => handleUpdateItem(i, { maxLength: e.target.value === "" ? undefined : Number(e.target.value) })}
                        onBlur={commit}
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <ConvCompletionInput
                        value={item.pattern ?? ""}
                        onValueChange={(v) => handleUpdateItem(i, { pattern: v || undefined })}
                        onCommit={commit}
                        conventions={conventions}
                        className="form-control form-control-sm"
                        placeholder="@conv.regex.email-simple"
                        disabled={isReadonly}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={item.description ?? ""}
                        onChange={(e) => handleUpdateItem(i, { description: e.target.value || undefined })}
                        onBlur={commit}
                        disabled={isReadonly}
                      />
                    </td>
                    <td className="text-center screen-items-actions-cell">
                      <button
                        type="button"
                        className={`btn btn-sm btn-link p-0 ${expandedDetailRows.has(i) ? "text-primary" : "text-secondary"}`}
                        onClick={() => handleToggleDetailRow(i)}
                        title="詳細フィールドを展開"
                        aria-label="詳細展開"
                      >
                        <i className={`bi bi-${expandedDetailRows.has(i) ? "sliders2-vertical" : "sliders"}`} />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm btn-link p-0 ${expandedErrorRows.has(i) ? "text-primary" : "text-secondary"}`}
                        onClick={() => handleToggleErrorRow(i)}
                        title="エラーメッセージ欄を展開"
                        aria-label="エラーメッセージ展開"
                      >
                        <i className={`bi bi-${expandedErrorRows.has(i) ? "chat-text-fill" : "chat-text"}`} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-secondary p-0"
                        onClick={() => handleResetItems([i])}
                        title="IDをリセット (自動採番形式に戻す)"
                        aria-label="IDをリセット"
                        disabled={isReadonly}
                      >
                        <i className="bi bi-arrow-counterclockwise" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-danger p-0"
                        onClick={() => handleRemoveItem(i)}
                        title="削除"
                        aria-label="削除"
                        disabled={isReadonly}
                      >
                        <i className="bi bi-x" />
                      </button>
                    </td>
                  </tr>
                  {expandedDetailRows.has(i) && (
                    <tr className="screen-items-detail-row">
                      <td colSpan={11}>
                        <div className="screen-items-detail-fields">
                          <div className="screen-items-detail-checks">
                            <label className="screen-items-detail-check">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={!!item.readonly}
                                onChange={(e) => { handleUpdateItem(i, { readonly: e.target.checked || undefined }); commit(); }}
                                aria-label="readonly"
                                disabled={isReadonly}
                              />
                              <span className="screen-items-detail-label">readonly</span>
                            </label>
                            <label className="screen-items-detail-check">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={!!item.disabled}
                                onChange={(e) => { handleUpdateItem(i, { disabled: e.target.checked || undefined }); commit(); }}
                                aria-label="disabled"
                                disabled={isReadonly}
                              />
                              <span className="screen-items-detail-label">disabled</span>
                            </label>
                          </div>
                          <label className="screen-items-detail-field">
                            <span className="screen-items-detail-label">placeholder</span>
                            <input
                              className="form-control form-control-sm"
                              value={item.placeholder ?? ""}
                              onChange={(e) => handleUpdateItem(i, { placeholder: e.target.value || undefined })}
                              onBlur={commit}
                              aria-label="placeholder"
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-field">
                            <span className="screen-items-detail-label">helperText</span>
                            <input
                              className="form-control form-control-sm"
                              value={item.helperText ?? ""}
                              onChange={(e) => handleUpdateItem(i, { helperText: e.target.value || undefined })}
                              onBlur={commit}
                              aria-label="helperText"
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-field">
                            <span className="screen-items-detail-label">visibleWhen</span>
                            <input
                              className="form-control form-control-sm"
                              value={item.visibleWhen ?? ""}
                              onChange={(e) => handleUpdateItem(i, { visibleWhen: e.target.value || undefined })}
                              onBlur={commit}
                              placeholder="@inputs.role === 'admin'"
                              aria-label="visibleWhen"
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-field">
                            <span className="screen-items-detail-label">enabledWhen</span>
                            <input
                              className="form-control form-control-sm"
                              value={item.enabledWhen ?? ""}
                              onChange={(e) => handleUpdateItem(i, { enabledWhen: e.target.value || undefined })}
                              onBlur={commit}
                              placeholder="@inputs.status !== 'locked'"
                              aria-label="enabledWhen"
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-num">
                            <span className="screen-items-detail-label">min</span>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              value={item.min ?? ""}
                              onChange={(e) => handleUpdateItem(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                              onBlur={commit}
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-num">
                            <span className="screen-items-detail-label">max</span>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              value={item.max ?? ""}
                              onChange={(e) => handleUpdateItem(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                              onBlur={commit}
                              disabled={isReadonly}
                            />
                          </label>
                          <label className="screen-items-detail-num">
                            <span className="screen-items-detail-label">step</span>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              value={item.step ?? ""}
                              min={0}
                              onChange={(e) => handleUpdateItem(i, { step: e.target.value === "" ? undefined : Number(e.target.value) })}
                              onBlur={commit}
                              disabled={isReadonly}
                            />
                          </label>
                        </div>
                        {item.direction === "output" && (
                          <OutputFields
                            item={item}
                            idx={i}
                            onUpdate={handleUpdateItem}
                            onCommit={commit}
                            tables={tables}
                            views={views}
                            isReadonly={isReadonly}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                  {expandedErrorRows.has(i) && (
                    <tr className="screen-items-error-row">
                      <td colSpan={11}>
                        <div className="screen-items-error-fields">
                          {(["required", "minLength", "maxLength", "invalidFormat", "outOfRange"] as const).map((key) => (
                            <label key={key} className="screen-items-error-field">
                              <span className="screen-items-error-label">{key}</span>
                              <ConvCompletionInput
                                value={item.errorMessages?.[key] ?? ""}
                                onValueChange={(v) => handleUpdateErrorMessage(i, key, v)}
                                onCommit={commit}
                                conventions={conventions}
                                className="form-control form-control-sm"
                                placeholder={`@conv.msg.${key}`}
                                disabled={isReadonly}
                              />
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <div className="screen-items-toolbar">
              <button
                type="button"
                className="btn btn-sm btn-outline-primary screen-items-add"
                onClick={handleAddItem}
                disabled={isReadonly}
              >
                <i className="bi bi-plus-lg me-1" /> 項目追加
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary screen-items-add"
                onClick={() => setCandidatesModalOpen(true)}
                title="現在選択中の画面デザインから input/select/textarea を抽出してチェックで追加"
                disabled={isReadonly}
              >
                <i className="bi bi-ui-checks me-1" /> 画面デザインから追加
              </button>
              {selectedIndices.size > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => handleResetItems([...selectedIndices].sort((a, b) => a - b))}
                  title="選択行の ID を自動採番形式にリセット"
                  disabled={isReadonly}
                >
                  <i className="bi bi-arrow-counterclockwise me-1" />
                  選択行のIDをリセット ({selectedIndices.size} 件)
                </button>
              )}
            </div>
            <datalist id="screen-items-type-list">
              {PRIMITIVE_TYPES.map((t) => <option key={t} value={t} />)}
            </datalist>
            <datalist id="screen-items-display-format-list">
              {DISPLAY_FORMAT_PRESETS.map((f) => <option key={f} value={f} />)}
            </datalist>
            <datalist id="screen-items-process-flow-list">
              {processFlows.map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
            </datalist>
          </div>
          </>
        )}
      </div>

      {pendingRename && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.45)" }} role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">ID リネームの確認</h5>
              </div>
              <div className="modal-body">
                <p>
                  <code className="me-1">{pendingRename.oldId}</code>
                  <span className="me-1">→</span>
                  <code>{pendingRename.newId}</code>
                </p>
                <p className="mb-1">
                  以下の処理フロー ({pendingRename.affectedGroups.length} 件、計 {pendingRename.totalRefs} 箇所) の参照が自動追従されます:
                </p>
                <ul className="mb-0">
                  {pendingRename.affectedGroups.map((ag) => (
                    <li key={ag.id}>{ag.name}（{ag.refCount} 箇所）</li>
                  ))}
                </ul>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCancelRename}>
                  キャンセル
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmRename}>
                  リネーム実行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingReset && (
        <div className="modal show d-block" style={{ background: "rgba(0,0,0,0.45)" }} role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">IDリセットの確認</h5>
              </div>
              <div className="modal-body">
                <p>以下の ID を自動採番形式にリセットします:</p>
                <ul className="mb-2">
                  {pendingReset.resets.map(({ oldId, newId }) => (
                    <li key={oldId}>
                      <code className="me-1">{oldId}</code>
                      <span className="me-1">→</span>
                      <code>{newId}</code>
                    </li>
                  ))}
                </ul>
                <p className="mb-1">
                  以下の処理フロー ({pendingReset.affectedGroups.length} 件、計 {pendingReset.totalRefs} 箇所) の参照が自動追従されます:
                </p>
                <ul className="mb-0">
                  {pendingReset.affectedGroups.map((ag) => (
                    <li key={ag.id}>{ag.name}（{ag.refCount} 箇所）</li>
                  ))}
                </ul>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCancelReset}>
                  キャンセル
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmReset}>
                  リセット実行
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ScreenItemCandidatesModal
        open={candidatesModalOpen}
        screenId={screenId ?? null}
        screenName={selectedScreenName}
        existingIds={existingIds}
        onClose={() => setCandidatesModalOpen(false)}
        onAddCandidates={handleAddCandidates}
      />
    </div>
  );
}
