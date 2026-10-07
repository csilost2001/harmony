/**
 * 業務部品デザイナ (画面デザイン)。
 *
 * 画面 JSON の layout (業務部品の木) と items (画面項目) を、同じ編集セッション
 * (resourceType: "screen-item") で編集・保存する。部品の配置はドラッグ & ドロップ、
 * 属性と項目定義は右パネルで編集する。
 *
 * 仕様: docs/spec/screen-layout.md
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  designToLayout, findNode, findParent, moveNode, updateNode, validateLayout, walkLayout,
  type LayoutNodeType,
} from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadScreenItems, saveScreenItems, type ScreenItemsDocument } from "../../store/screenItemsStore";
import { loadProject } from "../../store/flowStore";
import { listTables, loadTable } from "../../store/tableStore";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import { extractGrapesHtml } from "../../utils/pageLayoutCompositionPreview";
import type { Table } from "../../types/v3/table";
import type { ScreenItem } from "../../types/v3/screen-item";
import { EditorHeader } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import { DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog, AfterForceUnlockChoiceDialog } from "../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { htmlToSimple } from "../../screen-layout/domToSimple";
import { LayoutCanvas } from "./LayoutCanvas";
import { LayoutPalette } from "./LayoutPalette";
import { LayoutInspector } from "./LayoutInspector";
import type { DragPayload } from "./layoutDnd";
import {
  createNode, docDuplicate, docInsert, docRemove, docUpdateItem, emptyLayout, itemFromColumn,
  newFieldWithItem, nodeForItem, type LayoutDoc,
} from "./layoutModel";
import "../../styles/editMode.css";
import "../../styles/screenLayout.css";

const VIEWPORTS: Array<{ key: string; label: string; icon: string; width: number }> = [
  { key: "pc", label: "PC", icon: "bi-display", width: 1200 },
  { key: "tablet", label: "タブレット", icon: "bi-tablet", width: 820 },
  { key: "phone", label: "スマートフォン", icon: "bi-phone", width: 390 },
];

export interface ScreenLayoutDesignerProps {
  screenId: string;
  screenName?: string;
  isActive?: boolean;
  /** 旧デザイナで開く (旧デザインを持つ画面のみ) */
  onOpenLegacy?: () => void;
  hasLegacyDesign?: boolean;
}

export function ScreenLayoutDesigner({ screenId, screenName, isActive = true, onOpenLegacy, hasLegacyDesign }: ScreenLayoutDesignerProps) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const sessionId = mcpBridge.getSessionId();

  const { syncSessionToUrl, initialEditSessionId } = useSessionUrlSync({ resourceType: "screen-item", resourceId: screenId });
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "screen-item",
    resourceId: screenId,
    sessionId,
    editSessionId: initialEditSessionId,
  });

  const {
    state: doc, isDirty, isSaving, serverChanged,
    update, updateSilent, commit, undo, redo, canUndo, canRedo,
    postSave, handleReset, dismissServerBanner, reload,
  } = useResourceEditor<ScreenItemsDocument>({
    tabType: "design",
    mtimeKind: "screenEntity",
    draftKind: "screen-layout",
    id: screenId,
    load: loadScreenItems,
    save: saveScreenItems,
    broadcastName: "screenItemsChanged",
    broadcastIdField: "screenId",
    enableUndoKeyboard: isActive,
    onNotFound: () => navigate(wsPath("/screen/list"), { replace: true }),
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: "screen-item",
    viewerEditSessionId: editSession?.id,
  });

  const editable = mode.kind === "editing";
  const docRef = useRef<ScreenItemsDocument | null>(null);
  useEffect(() => { docRef.current = doc ?? null; }, [doc]);

  // ── 周辺データ ─────────────────────────────────────────────────────────
  const [screens, setScreens] = useState<Array<{ id: string; name: string; path?: string }>>([]);
  const [tables, setTables] = useState<Table[]>([]);
  useEffect(() => {
    let alive = true;
    loadProject().then((p) => { if (alive) setScreens(p.screens.map((s) => ({ id: s.id as string, name: s.name as string, path: (s as { path?: string }).path }))); }).catch(() => undefined);
    (async () => {
      const metas = await listTables();
      const full = (await Promise.all(metas.map((m) => loadTable(m.id)))).filter((t): t is Table => !!t);
      if (alive) setTables(full);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [screenId]);
  const title = screenName ?? screens.find((s) => s.id === screenId)?.name ?? screenId;

  // ── 表示設定 ───────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState(VIEWPORTS[0]);
  const [density, setDensity] = useState<"standard" | "compact">("standard");
  const [showNotes, setShowNotes] = useState(false);

  // ── 更新 (draft 同期付き) ───────────────────────────────────────────────
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (editSession?.id && docRef.current) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: docRef.current }).catch(console.error);
      }
    }, 300);
  }, [editSession]);

  const apply = useCallback((fn: (d: LayoutDoc) => LayoutDoc, commitNow = true) => {
    if (!editable) return;
    const mutate = (draft: ScreenItemsDocument) => {
      const next = fn({ items: draft.items, layout: draft.layout });
      draft.items = next.items;
      if (next.layout) draft.layout = next.layout; else delete draft.layout;
    };
    if (commitNow) update(mutate); else updateSilent(mutate);
    syncDraft();
  }, [editable, update, updateSilent, syncDraft]);

  const layout = doc?.layout;
  const nodes = useMemo(() => layout?.nodes ?? [], [layout]);
  const docItems = doc?.items;
  const items = useMemo(() => docItems ?? [], [docItems]);
  // 削除・取り消しで消えた部品の選択は自動的に外れる
  const selected = selectedId ? findNode(nodes, selectedId) : null;
  const issues = useMemo(() => validateLayout(doc?.layout, items), [doc?.layout, items]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) if (i.nodeId && i.severity !== "info" && m.get(i.nodeId) !== "error") m.set(i.nodeId, i.severity as "error" | "warning");
    return m;
  }, [issues]);

  /** 新しい部品を置く場所: 選択中の容器の末尾、または選択中の部品の直後 */
  const insertionPoint = useCallback((type: LayoutNodeType): { parentId: string | null; index?: number } => {
    if (!selected) return { parentId: null };
    const sel = selected;
    if (sel.children !== undefined && type !== "column" && type !== "tab") return { parentId: sel.id };
    const pos = findParent(nodes, sel.id);
    return { parentId: pos?.parent?.id ?? null, index: (pos?.index ?? -1) + 1 };
  }, [selected, nodes]);

  const addNode = useCallback((type: LayoutNodeType, at?: { parentId: string | null; index?: number }) => {
    const place = at ?? insertionPoint(type);
    let newId = "";
    apply((d) => {
      if (type === "field" || type === "table") {
        const { item, node } = newFieldWithItem(d, type);
        newId = node.id;
        return docInsert(d, place.parentId, node, place.index, [item]);
      }
      const node = createNode(type, d.layout?.nodes ?? []);
      newId = node.id;
      return docInsert(d, place.parentId, node, place.index);
    });
    if (newId) setSelectedId(newId);
  }, [apply, insertionPoint]);

  const placeItem = useCallback((itemId: string, at?: { parentId: string | null; index?: number }) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    let newId = "";
    apply((d) => {
      const node = nodeForItem(item, d.layout?.nodes ?? []);
      newId = node.id;
      const place = at ?? insertionPoint(node.type);
      return docInsert(d, place.parentId, node, place.index);
    });
    if (newId) setSelectedId(newId);
  }, [apply, items, insertionPoint]);

  const addColumnItem = useCallback((tableId: string, columnId: string, at?: { parentId: string | null; index?: number }) => {
    const table = tables.find((t) => t.id === tableId);
    const col = table?.columns.find((c) => c.id === columnId);
    if (!table || !col) return;
    let newId = "";
    apply((d) => {
      const item = itemFromColumn(table, col, d.items);
      const node = nodeForItem(item, d.layout?.nodes ?? []);
      newId = node.id;
      const place = at ?? insertionPoint("field");
      return docInsert(d, place.parentId, node, place.index, [item]);
    });
    if (newId) setSelectedId(newId);
  }, [apply, tables, insertionPoint]);

  const handleDrop = useCallback((payload: DragPayload, at: { parentId: string | null; index: number }) => {
    switch (payload.kind) {
      case "new-node": addNode(payload.nodeType, at); break;
      case "place-item": placeItem(payload.itemId, at); break;
      case "table-column": addColumnItem(payload.tableId, payload.columnId, at); break;
      case "move-node":
        apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], payload.nodeId, at.parentId, at.index) } }));
        setSelectedId(payload.nodeId);
        break;
    }
  }, [addNode, placeItem, addColumnItem, apply]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    apply((d) => docRemove(d, selectedId, true).doc);
    // 削除後は同じ親の近くの部品を選ぶ
    const siblings = pos?.parent ? pos.parent.children ?? [] : nodes;
    const near = siblings[pos ? pos.index + 1 : -1] ?? siblings[pos ? pos.index - 1 : -1];
    setSelectedId(near && near.id !== selectedId ? near.id : pos?.parent?.id ?? null);
  }, [selectedId, nodes, apply]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    let newId: string | null = null;
    apply((d) => { const r = docDuplicate(d, selectedId); newId = r.newId; return r.doc; });
    if (newId) setSelectedId(newId);
  }, [selectedId, apply]);

  const moveSelected = useCallback((dir: -1 | 1) => {
    if (!selectedId) return;
    const pos = findParent(nodes, selectedId);
    if (!pos) return;
    const siblings = pos.parent ? pos.parent.children ?? [] : nodes;
    const to = pos.index + dir;
    if (to < 0 || to >= siblings.length) return;
    apply((d) => ({ ...d, layout: { version: 1, nodes: moveNode(d.layout?.nodes ?? [], selectedId, pos.parent?.id ?? null, dir > 0 ? to + 1 : to) } }));
  }, [selectedId, nodes, apply]);

  const renameNode = useCallback((oldId: string, newId: string) => {
    apply((d) => ({ ...d, layout: { version: 1, nodes: updateNode(d.layout?.nodes ?? [], oldId, (n) => ({ ...n, id: newId })) } }));
    setSelectedId(newId);
  }, [apply]);

  const addChild = useCallback((type: "column" | "tab") => {
    if (!selectedId) return;
    addNode(type, { parentId: selectedId });
  }, [selectedId, addNode]);

  // ── 保存 / 破棄 ───────────────────────────────────────────────────────
  const [showDiscard, setShowDiscard] = useState(false);
  const [showForceRelease, setShowForceRelease] = useState(false);
  const [showResume, setShowResume] = useState(false);

  const handleSave = useCallback(async () => {
    if (!editable || isSaving) return;
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    if (editSession?.id && docRef.current) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: docRef.current });
    }
    const { conflicted, failed } = await actions.save();
    if (conflicted || failed) return;
    await postSave();
  }, [editable, isSaving, editSession, actions, postSave]);
  useSaveShortcut(() => { handleSave().catch(console.error); }, isActive && editable);

  useEffect(() => {
    setTabDirty(makeTabId("design", screenId), isDirtyForTab || isDirty);
  }, [screenId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (sessionLoading || mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", { resourceType: "screen-item", resourceId: screenId }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      const mine = mcpBridge.getSessionId();
      if ((res?.sessions ?? []).some((s) => s.state === "Active" && !!s.participants?.[mine])) setShowResume(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind, screenId]);

  // ── キーボード ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") { setSelectedId(null); return; }
      if (!editable || !selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); }
      else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); moveSelected(-1); }
      else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveSelected(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, editable, selectedId, deleteSelected, duplicateSelected, moveSelected]);

  // ── 旧デザインからの変換 / 新規作成 ───────────────────────────────────
  const [converting, setConverting] = useState(false);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);
  const ensureEditing = useCallback(async (): Promise<boolean> => {
    if (mode.kind === "editing") return true;
    await actions.startEditing();
    return true;
  }, [mode.kind, actions]);

  const [pendingInit, setPendingInit] = useState<null | { kind: "empty" } | { kind: "convert"; html: string }>(null);
  // 編集モードに入ってから初期レイアウトを適用する (startEditing は非同期に mode を切り替えるため)
  useEffect(() => {
    if (!pendingInit || !editable || !doc) return;
    if (pendingInit.kind === "empty") {
      apply((d) => ({ ...d, layout: emptyLayout(title) }));
      setConvertMessage("空のレイアウトを作りました。左の「部品」からドラッグして画面を組み立ててください。");
    } else {
      const screensByPath: Record<string, string> = Object.fromEntries(screens.filter((s) => s.path).map((s) => [s.path as string, s.id]));
      const res = designToLayout(htmlToSimple(pendingInit.html), doc.items, { screenIdByPath: screensByPath, screenId });
      apply((d) => ({ items: [...d.items, ...(res.newItems as unknown as ScreenItem[])], layout: res.layout }));
      setConvertMessage(`旧デザインから変換しました: 部品 ${res.stats.nodes} / 項目 ${res.stats.fields} / 一覧 ${res.stats.tables} / ボタン ${res.stats.buttons}${res.stats.html ? ` / 自由 HTML ${res.stats.html} (要置き換え)` : ""}。内容を確認して保存してください。`);
    }
    setPendingInit(null);
  }, [pendingInit, editable, doc, apply, title, screenId, screens]);

  const startEmpty = useCallback(async () => {
    await ensureEditing();
    setPendingInit({ kind: "empty" });
  }, [ensureEditing]);

  const startConvert = useCallback(async () => {
    setConverting(true);
    try {
      const design = await mcpBridge.request("loadScreen", { screenId });
      const html = extractGrapesHtml(design);
      if (!html) { setConvertMessage("旧デザインが見つかりませんでした。空の画面から作成してください。"); return; }
      await ensureEditing();
      setPendingInit({ kind: "convert", html });
    } catch (e) {
      setConvertMessage(`旧デザインを読み込めませんでした: ${(e as Error).message}`);
    } finally {
      setConverting(false);
    }
  }, [screenId, ensureEditing]);

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;
  const hasLayout = !!doc?.layout;
  const screenNameById = useMemo(() => new Map(screens.map((s) => [s.id, s.name])), [screens]);
  const counts = useMemo(() => { let n = 0; walkLayout(nodes, () => { n++; }); return n; }, [nodes]);

  return (
    <div className={`sld-root${editable ? "" : " readonly-mode"}`} data-testid="screen-layout-designer">
      {serverChanged && <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />}
      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={() => { handleSave().catch(console.error); }}
        onDiscardClick={() => setShowDiscard(true)}
        onForceReleaseClick={() => setShowForceRelease(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />
      {mode.kind === "force-released-pending" && <ForcedOutChoiceDialog previousDraftExists={mode.previousDraftExists} onChoice={(c) => actions.handleForcedOut(c)} />}
      {mode.kind === "after-force-unlock" && <AfterForceUnlockChoiceDialog previousOwner={mode.previousOwner} onChoice={(c) => actions.handleAfterForceUnlock(c)} />}
      {showResume && <ResumeOrDiscardDialog onResume={async () => { setShowResume(false); await actions.startEditing(); }} onDiscard={async () => { setShowResume(false); await actions.discard(); await reload(); }} onCancel={() => setShowResume(false)} />}
      {showDiscard && <DiscardConfirmDialog onConfirm={async () => { setShowDiscard(false); await actions.discard(); await reload(); }} onCancel={() => setShowDiscard(false)} />}
      {showForceRelease && lockedByOther && <ForceReleaseConfirmDialog ownerSessionId={lockedByOther.ownerSessionId} onConfirm={async () => { setShowForceRelease(false); await actions.forceReleaseOther(); }} onCancel={() => setShowForceRelease(false)} />}
      {saveConflict && <SaveConflictDialog conflict={saveConflict} onOverwrite={onSaveConflictOverwrite} onCancel={onSaveConflictCancel} />}

      <EditorHeader
        title={<span className="fw-semibold"><i className="bi bi-window-sidebar me-1" />{title} — 画面デザイン</span>}
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo }}
        centerTools={hasLayout ? (
          <div className="sld-toolbar">
            <div className="sld-segmented" role="group" aria-label="表示幅">
              {VIEWPORTS.map((v) => (
                <button key={v.key} type="button" className={viewport.key === v.key ? "active" : ""} title={`${v.label} (${v.width}px)`} onClick={() => setViewport(v)} data-testid={`layout-viewport-${v.key}`}>
                  <i className={`bi ${v.icon}`} />
                </button>
              ))}
            </div>
            <div className="sld-segmented" role="group" aria-label="密度">
              <button type="button" className={density === "standard" ? "active" : ""} onClick={() => setDensity("standard")}>標準</button>
              <button type="button" className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>詰める</button>
            </div>
            <button type="button" className={`sld-toggle${showNotes ? " active" : ""}`} onClick={() => setShowNotes((v) => !v)} title="項目 ID・型・桁数を表示" data-testid="layout-toggle-notes">
              <i className="bi bi-tags" /> 設計情報
            </button>
          </div>
        ) : undefined}
        extraRight={
          <>
            <button type="button" className="btn btn-sm btn-outline-secondary me-2" onClick={() => navigate(wsPath(`/screen/items/${encodeURIComponent(screenId)}`))} title="画面項目を表形式で一覧・編集">
              <i className="bi bi-list-columns me-1" />項目一覧
            </button>
            {hasLegacyDesign && onOpenLegacy && (
              <button type="button" className="btn btn-sm btn-outline-secondary me-2" onClick={onOpenLegacy} title="移行前の旧デザイナで開く" data-testid="layout-open-legacy">
                <i className="bi bi-clock-history me-1" />旧デザイン
              </button>
            )}
            <EditSessionDropdown
              resourceType="screen-item"
              resourceId={screenId}
              currentMode={mode}
              currentSessionId={sessionId}
              onStartEditing={() => { void actions.startEditing(); }}
              onViewerAttached={syncSessionToUrl}
              onAttachAsView={attach}
              onTakeOver={takeOver}
            />
          </>
        }
      />

      {convertMessage && (
        <div className="sld-notice" role="status">
          <i className="bi bi-info-circle" />
          <span>{convertMessage}</span>
          <button type="button" className="sld-icon-btn" onClick={() => setConvertMessage(null)} aria-label="閉じる"><i className="bi bi-x" /></button>
        </div>
      )}

      {!doc ? (
        <div className="sld-loading">読み込み中…</div>
      ) : !hasLayout ? (
        <div className="sld-start" data-testid="layout-start">
          <div className="sld-start-card">
            <h2>この画面はまだ業務部品形式になっていません</h2>
            <p>画面を「入力フォーム」「一覧表」「ボタン群」などの業務部品で組み立てる形式に切り替えます。画面項目 ({items.length} 件) はそのまま引き継がれ、保存するまで原本は変わりません。</p>
            <div className="sld-start-actions">
              {hasLegacyDesign && (
                <button type="button" className="sld-start-btn primary" onClick={() => { startConvert().catch(console.error); }} disabled={converting || mode.kind === "locked-by-other"} data-testid="layout-start-convert">
                  <i className="bi bi-magic" />
                  <b>旧デザインから自動変換</b>
                  <span>見出し・入力欄・一覧・ボタンを業務部品に置き換えます。変換できない部分は自由 HTML として残します。</span>
                </button>
              )}
              <button type="button" className={`sld-start-btn${hasLegacyDesign ? "" : " primary"}`} onClick={() => { startEmpty().catch(console.error); }} disabled={mode.kind === "locked-by-other"} data-testid="layout-start-empty">
                <i className="bi bi-file-earmark-plus" />
                <b>空の画面から作る</b>
                <span>見出しだけの画面から、部品をドラッグして組み立てます。</span>
              </button>
              {hasLegacyDesign && onOpenLegacy && (
                <button type="button" className="sld-start-btn" onClick={onOpenLegacy}>
                  <i className="bi bi-clock-history" />
                  <b>旧デザイナで開く</b>
                  <span>移行せずに、これまでのデザイナで編集します。</span>
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="sld-body">
          <LayoutPalette
            editable={editable}
            nodes={nodes}
            items={items}
            tables={tables}
            selectedId={selectedId}
            onAdd={(t) => addNode(t)}
            onPlaceItem={(id) => placeItem(id)}
            onAddColumn={(t, c) => addColumnItem(t, c)}
            onSelect={setSelectedId}
          />
          <main className="sld-center" aria-label={`${title} の画面 (${counts} 部品)`}>
            <LayoutCanvas
              nodes={nodes}
              items={items}
              width={viewport.width}
              density={density}
              showNotes={showNotes}
              selectedId={selected ? selectedId : null}
              editable={editable}
              screenNameById={screenNameById}
              issuesByNode={issuesByNode}
              onSelect={setSelectedId}
              onDrop={handleDrop}
            />
          </main>
          <LayoutInspector
            editable={editable}
            node={selected}
            nodes={nodes}
            items={items}
            issues={issues}
            screens={screens}
            onNodeChange={(id, fn, c) => apply((d) => ({ ...d, layout: { version: 1, nodes: updateNode(d.layout?.nodes ?? [], id, fn) } }), c)}
            onItemChange={(id, fn, c) => apply((d) => docUpdateItem(d, id, fn), c)}
            onRenameNode={renameNode}
            onMove={moveSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onAddChild={addChild}
            onSelect={setSelectedId}
            onCommit={commit}
          />
        </div>
      )}
    </div>
  );
}
