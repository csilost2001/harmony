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
  autoPlaceItems, designToLayout, detachComponentNode, findNode, findParent, removeNode, updateNode, validateLayoutWithComponents, walkLayout,
  type LayoutComponentDef,
} from "@harmony/shared";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadScreenItems, saveScreenItems, type ScreenItemsDocument } from "../../store/screenItemsStore";
import { loadProject } from "../../store/flowStore";
import { loadScreenEntity } from "../../store/screenStore";
import { hasLegacyDesignContent } from "../../utils/legacyDesign";
import { saveLayoutComponent, useLayoutComponents } from "../../store/layoutComponentStore";
import { loadAllTables } from "../../store/tableStore";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import { extractGrapesHtml } from "../../utils/legacyDesign";
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
import { GROUPS as PALETTE_GROUPS } from "./layoutPaletteGroups";
import { QuickPickMenu, type QuickPickItem } from "../common/QuickPickMenu";
import { LAYOUT_NODE_LABELS } from "@harmony/shared";
import { LayoutInspector } from "./LayoutInspector";
import { LayoutMultiPanel } from "./LayoutMultiPanel";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { applyInline, inlineIds, inlineTarget } from "./layoutInline";
import { columnPairOf, resizeColumnPair } from "./layoutResize";
import { WRAP_TYPES, canWrap, rangeSelect, sharedParentId } from "./layoutSelection";
import { RegisterComponentDialog } from "./RegisterComponentDialog";
import { ComponentManager } from "./ComponentManager";
import { ReferencesButton } from "../common/ReferencesButton";
import { useLayoutOps } from "./useLayoutOps";
import { docReplaceNode, docUpdateItem, emptyLayout, setComponentArg, type LayoutDoc } from "./layoutModel";
import "../../styles/editMode.css";
import "../../styles/screenLayout.css";
import { reportFailure, runReporting } from "../../utils/failureToast";
import { useResyncDraftOnReconnect } from "../../hooks/useResyncDraftOnReconnect";
import { firstChildId, neighborId, parentId } from "./layoutKeyboard";
import { showToast } from "../../utils/toast";
import { HelpHint } from "../help/HelpHint";

const VIEWPORTS: Array<{ key: string; label: string; icon: string; width: number }> = [
  { key: "pc", label: "PC", icon: "bi-display", width: 1200 },
  { key: "tablet", label: "タブレット", icon: "bi-tablet", width: 820 },
  { key: "phone", label: "スマートフォン", icon: "bi-phone", width: 390 },
];

export interface ScreenLayoutDesignerProps {
  screenId: string;
  screenName?: string;
  isActive?: boolean;
}

/** 旧形式 (廃止した GrapesJS / Puck) のデザインの有無。自動変換の案内に使う */
function useLegacyDesign(screenId: string, enabled: boolean): { hasLegacyDesign: boolean; legacyKind: "grapesjs" | "puck" } {
  const [state, setState] = useState<{ hasLegacyDesign: boolean; legacyKind: "grapesjs" | "puck" }>({ hasLegacyDesign: false, legacyKind: "grapesjs" });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      const entity = await loadScreenEntity(screenId).catch(() => null);
      if (!entity || entity.layout || !entity.design) return;
      if (entity.design.editorKind === "puck") {
        if (alive) setState({ hasLegacyDesign: true, legacyKind: "puck" });
        return;
      }
      // design 参照があっても中身 (HTML) が空なら旧形式とはみなさない (新規作成した画面は参照だけを持つ)
      const d = await mcpBridge.request("loadScreen", { screenId }).catch(() => null);
      if (alive) setState({ hasLegacyDesign: hasLegacyDesignContent(d), legacyKind: "grapesjs" });
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [screenId, enabled]);
  return state;
}

export function ScreenLayoutDesigner({ screenId, screenName, isActive = true }: ScreenLayoutDesignerProps) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const sessionId = mcpBridge.getSessionId();

  const { syncSessionToUrl, initialEditSessionId } = useSessionUrlSync({ resourceType: "screen-item", resourceId: screenId });
  const { editSession, mode, loading: sessionLoading, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "screen-item",
    resourceId: screenId,
    sessionId,
    editSessionId: initialEditSessionId,
  });

  const {
    state: doc, isDirty, isSaving, serverChanged,
    update, updateSilent, commit, undo, redo, canUndo, canRedo, history, jumpTo,
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
  const { components } = useLayoutComponents();
  useEffect(() => {
    let alive = true;
    loadProject().then((p) => { if (alive) setScreens(p.screens.map((s) => ({ id: s.id as string, name: s.name as string, path: (s as { path?: string }).path }))); }).catch(() => undefined);
    (async () => {
      const full = await loadAllTables(); // 全テーブルを 1 回の問い合わせで
      if (alive) setTables(full);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [screenId]);
  const title = screenName ?? screens.find((s) => s.id === screenId)?.name ?? screenId;

  // ── 表示設定 ───────────────────────────────────────────────────────────
  // 選択: 末尾が「主の選択」(右パネルに詳細を出す部品)。2 つ以上あれば複数選択 (一括の操作)
  const [selection, setSelection] = useState<string[]>([]);
  const setSelectedId = useCallback((id: string | null) => setSelection(id ? [id] : []), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState(VIEWPORTS[0]);
  const [density, setDensity] = useState<"standard" | "compact">("standard");
  const [showNotes, setShowNotes] = useState(false);

  // ── 更新 (draft 同期付き) ───────────────────────────────────────────────
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      if (editSession?.id && docRef.current) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: docRef.current }).catch((err) => reportFailure(err, "下書きの保存"));
      }
    }, 300);
  }, [editSession]);

  // 接続が切れて戻ったとき、編集中の内容を下書きへ送り直す
  useResyncDraftOnReconnect(editable && !!editSession?.id, isDirty, () => {
    if (editSession?.id && docRef.current) mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: docRef.current }).catch((err) => reportFailure(err, "下書きの保存"));
  });

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
  const liveSelection = useMemo(() => selection.filter((id) => !!findNode(nodes, id)), [selection, nodes]);
  const selectedId = liveSelection.length ? liveSelection[liveSelection.length - 1] : null;
  const selectedSet = useMemo(() => new Set(liveSelection), [liveSelection]);
  const selected = selectedId ? findNode(nodes, selectedId) : null;
  // 遷移先の画面一覧を読み込むまでは遷移先の存在確認をしない (読み込み前に警告が出ないように)
  const screenIds = useMemo(() => (screens.length ? new Set(screens.map((s) => s.id)) : undefined), [screens]);
  const issues = useMemo(() => validateLayoutWithComponents(doc?.layout, items, components, screenIds), [doc?.layout, items, components, screenIds]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) if (i.nodeId && i.severity !== "info" && m.get(i.nodeId) !== "error") m.set(i.nodeId, i.severity as "error" | "warning");
    return m;
  }, [issues]);

  const {
    multi, wrapSelected, insertionPoint, addNode, addComponent, placeItem, addColumnItem, handleDrop,
    deleteSelected, duplicateSelected, moveSelected, outdentSelected, indentSelected, renameNode, addChild,
  } = useLayoutOps({ apply, nodes, items, tables, components, selectedId, setSelectedId, selectedIds: liveSelection, setSelection });
  void insertionPoint;

  /** 紙面のクリック: Ctrl / Cmd = 選択に入れる・外す、Shift = 範囲 */
  const handleSelect = useCallback((id: string | null, mod?: "toggle" | "range") => {
    if (!id) { setSelection([]); return; }
    if (mod === "toggle") setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else if (mod === "range" && selectedId) setSelection([...rangeSelect(nodes, selectedId, id).filter((x) => x !== id), id]);
    else setSelection([id]);
  }, [nodes, selectedId]);

  // ── 文言をその場で直す (ダブルクリック / F2) ──────────────────────────────
  const startInline = useCallback((id: string) => {
    if (!editable) return;
    const n = findNode(nodes, id);
    if (!n || !inlineTarget(n, n.itemRef ? items.find((i) => i.id === n.itemRef) : undefined)) return;
    setSelectedId(id);
    setEditingId(id);
  }, [editable, nodes, items, setSelectedId]);
  const commitInline = useCallback((id: string, value: string, move: -1 | 0 | 1 = 0) => {
    const n = findNode(nodes, id);
    const before = n ? inlineTarget(n, n.itemRef ? items.find((i) => i.id === n.itemRef) : undefined)?.value : undefined;
    if (before !== undefined && before !== value) apply((d) => applyInline(d, id, value));
    if (move === 0) { setEditingId(null); return; }
    const order = inlineIds(nodes, items);
    const next = order[order.indexOf(id) + move];
    if (next) { setSelectedId(next); setEditingId(next); } else setEditingId(null);
  }, [nodes, items, apply, setSelectedId]);

  // ── 段の幅を、境界のドラッグ・キーで変える ──────────────────────────────
  const resizeColumns = useCallback((leftId: string, rightId: string, leftSpan: number, rightSpan: number, final: boolean) => {
    apply((d) => ({
      ...d,
      layout: { version: 1, nodes: updateNode(updateNode(d.layout?.nodes ?? [], leftId, (n) => ({ ...n, props: { ...(n.props ?? {}), span: leftSpan } })), rightId, (n) => ({ ...n, props: { ...(n.props ?? {}), span: rightSpan } })) },
    }), false);
    if (final) commit();
  }, [apply, commit]);

  // ── 独自部品 ───────────────────────────────────────────────────────────
  const [registering, setRegistering] = useState(false);
  const [managing, setManaging] = useState<{ editId?: string } | null>(null);
  // 部品を追加するメニュー (/ または Insert。種類を打ち込んで選ぶ)
  const [showPartMenu, setShowPartMenu] = useState(false);

  const registerSelected = useCallback(async (def: LayoutComponentDef, args: Record<string, string>) => {
    if (!selectedId) return;
    await saveLayoutComponent(def);
    // 登録した部品の位置に、参照部品を置く (元の部品の ID を引き継ぐので選択も保たれる)
    apply((d) => {
      const ref = { id: selectedId, type: "component" as const, componentRef: def.id, ...(Object.keys(args).length ? { args } : {}) };
      return docReplaceNode(d, selectedId, [ref]);
    });
    setRegistering(false);
    setConvertMessage(`独自部品「${def.label}」を登録し、この部品を置き換えました。他の画面でも左の「独自部品」から使えます。`);
  }, [selectedId, apply]);

  const autoPlaceUnplaced = useCallback(() => {
    if (!doc?.layout) return;
    const count = autoPlaceItems(doc.layout, doc.items as never, components).placements.length;
    if (count === 0) return;
    apply((d) => (d.layout ? { ...d, layout: autoPlaceItems(d.layout, d.items as never, components).layout } : d));
    setConvertMessage(`未配置の項目 ${count} 件を配置しました。紙面や左の「構成」で位置を確認し、必要なら動かしてください。`);
  }, [doc, components, apply]);

  const detachSelected = useCallback(() => {
    if (!selected || selected.type !== "component") return;
    apply((d) => {
      const rest = removeNode(d.layout?.nodes ?? [], selected.id).nodes;
      return docReplaceNode(d, selected.id, detachComponentNode(selected, components, rest));
    });
    setSelectedId(null);
  }, [selected, components, apply, setSelectedId]);

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
  useSaveShortcut(() => { runReporting(handleSave, "画面デザイナの保存"); }, isActive && editable);

  useEffect(() => {
    setTabDirty(makeTabId("design", screenId), isDirty);
  }, [screenId, isDirty]);

  useEffect(() => {
    if (sessionLoading || mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", { resourceType: "screen-item", resourceId: screenId }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      const mine = mcpBridge.getSessionId();
      if ((res?.sessions ?? []).some((s) => s.state === "Active" && !!s.participants?.[mine])) setShowResume(true);
    })().catch((err) => reportFailure(err, "編集セッションの確認"));
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind, screenId]);

  // ── キーボード ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") { setSelection([]); return; }
      // F2: 選んでいる部品の文言を、その場で直す
      if (e.key === "F2" && selectedId && editable) { e.preventDefault(); startInline(selectedId); return; }
      // Shift+F10 / メニューキー: 右クリックのメニュー (選んでいる部品の位置に)
      if (selectedId && ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu")) {
        e.preventDefault();
        const r = document.querySelector(`[data-node-id="${CSS.escape(selectedId)}"]`)?.getBoundingClientRect();
        setMenuAt({ x: (r?.left ?? 200) + 12, y: (r?.top ?? 200) + 12 });
        return;
      }
      // Ctrl+A: 選んでいる部品と同じ入れ物の中の部品を、すべて選ぶ
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && selectedId && !(t && t.closest('[role="listbox"], [role="menu"], dialog, [aria-modal="true"]'))) {
        e.preventDefault();
        const pos = findParent(nodes, selectedId);
        const sibs = pos ? (pos.parent ? pos.parent.children ?? [] : nodes) : [];
        setSelection([...sibs.map((n) => n.id).filter((x) => x !== selectedId), selectedId]);
        return;
      }
      // Shift+↑↓: 選択を、見た目の順の前後へ広げる
      if (selectedId && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !(t && t.closest('[role="tab"], [role="listbox"], [role="combobox"], [role="menu"], dialog, [aria-modal="true"]'))) {
        const to = neighborId(nodes, selectedId, e.key === "ArrowUp" ? -1 : 1);
        if (to) { e.preventDefault(); setSelection((s) => [...s.filter((x) => x !== to), to]); }
        return;
      }
      // Alt+Shift+←→: 選んでいる段の幅を、隣の段とのあいだで 1 つぶん動かす
      if (editable && selectedId && e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const pair = columnPairOf(nodes, selectedId);
        const r = resizeColumnPair(nodes, selectedId, e.key === "ArrowRight" ? 1 : -1);
        if (!pair || !r) showToast("段の幅は、段 (右に次の段があるもの) を選んで動かせます", "info");
        else if (r.leftSpan !== pair.baseLeft) resizeColumns(r.leftId, r.rightId, r.leftSpan, r.rightSpan, true);
        return;
      }
      // / または Insert: 部品を追加するメニュー (選んでいる部品の後ろに追加する。パレットのクリックと同じ)
      if (editable && (e.key === "/" || e.key === "Insert") && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && t.closest('[aria-modal="true"]'))) {
        e.preventDefault();
        setShowPartMenu(true);
        return;
      }
      // 部品の木の中の移動: ↑↓ = 前後の部品、← = 親、→ = 最初の子 (閲覧のみでも使える)
      if (selectedId && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !(t && t.closest('[role="tab"], [role="listbox"], [role="combobox"], [role="menu"], dialog, [aria-modal="true"]'))) {
        const to = e.key === "ArrowUp" ? neighborId(nodes, selectedId, -1)
          : e.key === "ArrowDown" ? neighborId(nodes, selectedId, 1)
          : e.key === "ArrowLeft" ? parentId(nodes, selectedId)
          : e.key === "ArrowRight" ? firstChildId(nodes, selectedId)
          : null;
        if (to) {
          e.preventDefault();
          setSelectedId(to);
          requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(to)}"]`)?.scrollIntoView({ block: "nearest" }));
          return;
        }
      }
      if (!editable || !selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); }
      else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); moveSelected(-1); }
      else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveSelected(1); }
      else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); if (!outdentSelected()) showToast("これ以上、外へは出せません (最上位、または外に置けない部品です)", "info"); }
      else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); if (!indentSelected()) showToast("直前の部品の中へは入れられません (直前に、この部品を置ける入れ物がありません)", "info"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, editable, selectedId, nodes, deleteSelected, duplicateSelected, moveSelected, outdentSelected, indentSelected, startInline, resizeColumns, setSelectedId]);

  // ── 右クリック / Shift+F10 のメニュー ─────────────────────────────────
  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const ids = multi.length > 1 ? multi : selectedId ? [selectedId] : [];
    const many = ids.length > 1;
    const single = !many && selected ? selected : null;
    const ro = editable ? undefined : "閲覧のみのため、変更できません";
    const items: ContextMenuItem[] = [];
    if (single && inlineTarget(single, single.itemRef ? docItems?.find((i) => i.id === single.itemRef) : undefined)) {
      items.push({ key: "inline", label: "文言を直す", icon: "bi-pencil", shortcut: "F2", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); (() => startInline(single.id))(); } });
    }
    items.push(
      { key: "dup", label: many ? `${ids.length} 件を複製` : "複製", icon: "bi-copy", shortcut: "Ctrl+D", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); duplicateSelected(); } },
      { key: "up", label: "前へ", icon: "bi-arrow-up", shortcut: "Alt+↑", disabled: !editable || (many && !sharedParentId(nodes, ids).ok), disabledReason: ro ?? "違う入れ物の部品が混ざっています", onClick: () => { setMenuAt(null); (() => moveSelected(-1))(); } },
      { key: "down", label: "後ろへ", icon: "bi-arrow-down", shortcut: "Alt+↓", disabled: !editable || (many && !sharedParentId(nodes, ids).ok), disabledReason: ro ?? "違う入れ物の部品が混ざっています", onClick: () => { setMenuAt(null); (() => moveSelected(1))(); } },
    );
    if (!many) {
      items.push(
        { key: "out", label: "親の外へ出す", icon: "bi-box-arrow-in-left", shortcut: "Alt+←", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); (() => { if (!outdentSelected()) showToast("これ以上、外へは出せません (最上位、または外に置けない部品です)", "info"); })(); } },
        { key: "in", label: "直前の部品の中へ入れる", icon: "bi-box-arrow-in-right", shortcut: "Alt+→", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); (() => { if (!indentSelected()) showToast("直前の部品の中へは入れられません (直前に、この部品を置ける入れ物がありません)", "info"); })(); } },
      );
    }
    items.push({ key: "sep1", separator: true });
    for (const w of WRAP_TYPES) {
      const ok = canWrap(nodes, ids, w.type);
      items.push({ key: `wrap-${w.type}`, label: `${w.label}で包む`, icon: "bi-box", disabled: !editable || !ok, disabledReason: ro ?? "この組み合わせは、その入れ物で包めません", onClick: () => { setMenuAt(null); (() => { wrapSelected(w.type); })(); } });
    }
    if (single && single.type !== "component") {
      items.push({ key: "register", label: "独自部品として登録…", icon: "bi-puzzle", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); (() => setRegistering(true))(); } });
    }
    if (single?.type === "component") {
      // eslint-disable-next-line react-hooks/refs -- 操作は、押されたときにだけ呼ぶ (描画のあいだに、ref は読まない)
      items.push({ key: "detach", label: "展開して通常の部品に戻す", icon: "bi-box-arrow-up-right", disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); detachSelected(); } });
    }
    items.push({ key: "sep2", separator: true }, { key: "del", label: many ? `${ids.length} 件を削除` : "削除", icon: "bi-trash", shortcut: "Delete", danger: true, disabled: !editable, disabledReason: ro, onClick: () => { setMenuAt(null); deleteSelected(); } });
    return items;
  }, [multi, selectedId, selected, editable, docItems, nodes, startInline, duplicateSelected, moveSelected, outdentSelected, indentSelected, wrapSelected, detachSelected, deleteSelected]);

  // 部品を追加するメニューの候補 (標準の部品 + プロジェクト独自の部品)
  const partMenuItems = useMemo<QuickPickItem[]>(() => [
    ...PALETTE_GROUPS.flatMap((g) => g.types.map((t) => ({ value: `type:${t.type}`, label: LAYOUT_NODE_LABELS[t.type] ?? t.type, hint: `${g.title} ・ ${t.hint}`, icon: `bi ${t.icon}` }))),
    ...components.map((c) => ({ value: `component:${c.id}`, label: c.label, hint: c.category ? `独自部品 ・ ${c.category}` : "独自部品", icon: "bi bi-puzzle" })),
  ], [components]);
  const pickPart = (value: string) => {
    setShowPartMenu(false);
    if (value.startsWith("component:")) addComponent(value.slice("component:".length));
    else addNode(value.slice("type:".length) as Parameters<typeof addNode>[0]);
  };

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
  }, [screenId, ensureEditing, setConverting, setConvertMessage, setPendingInit]);

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;
  const hasLayout = !!doc?.layout;
  const { hasLegacyDesign, legacyKind } = useLegacyDesign(screenId, !!doc && !doc.layout);
  const screenNameById = useMemo(() => new Map(screens.map((s) => [s.id, s.name])), [screens]);
  const counts = useMemo(() => { let n = 0; walkLayout(nodes, () => { n++; }); return n; }, [nodes]);

  return (
    <div className={`sld-root${editable ? "" : " readonly-mode"}`} data-testid="screen-layout-designer">
      {serverChanged && <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />}
      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={() => { runReporting(handleSave, "画面デザイナの保存"); }}
        onDiscardClick={() => setShowDiscard(true)}
        onForceReleaseClick={() => setShowForceRelease(true)}
        saving={isSaving}
        dirty={isDirty}
        ownerLabel={lockedByOther?.ownerSessionId}
      />
      {mode.kind === "force-released-pending" && <ForcedOutChoiceDialog previousDraftExists={mode.previousDraftExists} onChoice={(c) => actions.handleForcedOut(c)} />}
      {mode.kind === "after-force-unlock" && <AfterForceUnlockChoiceDialog previousOwner={mode.previousOwner} onChoice={(c) => actions.handleAfterForceUnlock(c)} />}
      {showResume && <ResumeOrDiscardDialog onResume={async () => { setShowResume(false); await actions.startEditing(); }} onDiscard={async () => { setShowResume(false); await actions.discard(); await reload(); }} onCancel={() => setShowResume(false)} />}
      {showDiscard && <DiscardConfirmDialog onConfirm={async () => { setShowDiscard(false); await actions.discard(); await reload(); }} onCancel={() => setShowDiscard(false)} />}
      {showForceRelease && lockedByOther && <ForceReleaseConfirmDialog ownerSessionId={lockedByOther.ownerSessionId} onConfirm={async () => { setShowForceRelease(false); await actions.forceReleaseOther(); }} onCancel={() => setShowForceRelease(false)} />}
      {saveConflict && <SaveConflictDialog conflict={saveConflict} onOverwrite={onSaveConflictOverwrite} onCancel={onSaveConflictCancel} />}

      <EditorHeader
        title={<span className="fw-semibold"><i className="bi bi-window-sidebar me-1" />{title} — 画面デザイン<HelpHint topic="layout.overview" /></span>}
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo, history, present: doc, onJump: jumpTo }}
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
            <ReferencesButton entityType="screen" id={screenId} name={title} className="btn btn-sm btn-outline-secondary me-2" />
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
            {hasLegacyDesign && legacyKind === "puck" && (
              <p className="sld-hint" data-testid="layout-start-puck-note">
                この画面は旧エディタ (Puck) で作成されたもので、自動変換には対応していません。「空の画面から作る」で作り直してください。元のデザインのファイルは削除されません。
              </p>
            )}
            <div className="sld-start-actions">
              {hasLegacyDesign && legacyKind === "grapesjs" && (
                <button type="button" className="sld-start-btn primary" onClick={() => { startConvert().catch((err) => reportFailure(err, "画面デザイナの画面の作成")); }} disabled={converting || mode.kind === "locked-by-other"} data-testid="layout-start-convert">
                  <i className="bi bi-magic" />
                  <b>旧デザインから自動変換</b>
                  <span>見出し・入力欄・一覧・ボタンを業務部品に置き換えます。変換できない部分は自由 HTML として残します。</span>
                </button>
              )}
              <button type="button" className={`sld-start-btn${hasLegacyDesign && legacyKind === "grapesjs" ? "" : " primary"}`} onClick={() => { startEmpty().catch((err) => reportFailure(err, "画面デザイナの画面の作成")); }} disabled={mode.kind === "locked-by-other"} data-testid="layout-start-empty">
                <i className="bi bi-file-earmark-plus" />
                <b>空の画面から作る</b>
                <span>見出しだけの画面から、部品をドラッグして組み立てます。</span>
              </button>
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
            components={components}
            onAddComponent={(id) => addComponent(id)}
            onManageComponents={() => setManaging({})}
            onAutoPlace={autoPlaceUnplaced}
          />
          <section className="sld-center" aria-label={`${title} の画面 (${counts} 部品)`}>
            <LayoutCanvas
              nodes={nodes}
              items={items}
              width={viewport.width}
              density={density}
              showNotes={showNotes}
              selectedId={selected ? selectedId : null}
              selectedIds={selectedSet}
              editable={editable}
              screenNameById={screenNameById}
              issuesByNode={issuesByNode}
              components={components}
              onSelect={handleSelect}
              onDrop={handleDrop}
              editingId={editingId}
              onStartInline={startInline}
              onInlineCommit={commitInline}
              onInlineCancel={() => setEditingId(null)}
              onContextMenu={(id, x, y) => { if (!selectedSet.has(id)) setSelectedId(id); setMenuAt({ x, y }); }}
              onResizeColumns={resizeColumns}
            />
          </section>
          {liveSelection.length > 1 ? (
            <aside className="sld-right" aria-label="詳細 (複数選択)">
              <LayoutMultiPanel
                editable={editable}
                ids={multi.length ? multi : liveSelection}
                nodes={nodes}
                items={items}
                onSelect={setSelection}
                onDuplicate={duplicateSelected}
                onDelete={deleteSelected}
                onMove={moveSelected}
                onWrap={(t) => { if (!wrapSelected(t)) showToast("この組み合わせは、その入れ物で包めません", "info"); }}
                onPatchItems={(ids, patch) => apply((d) => ({ ...d, items: d.items.map((i) => (ids.includes(i.id as string) ? patch(i) : i)) }))}
                onPatchNodes={(ids, patch) => apply((d) => ({ ...d, layout: { version: 1, nodes: ids.reduce((acc, id) => updateNode(acc, id, patch), d.layout?.nodes ?? []) } }))}
              />
            </aside>
          ) : (
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
            onOutdent={outdentSelected}
            onIndent={indentSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onAddChild={addChild}
            onSelect={setSelectedId}
            onCommit={commit}
            components={components}
            onSetArg={(id, paramId, value, c) => apply((d) => ({ ...d, layout: { version: 1, nodes: setComponentArg(d.layout?.nodes ?? [], id, paramId, value) } }), c)}
            onEditComponent={(id) => setManaging({ editId: id })}
            onDetachComponent={detachSelected}
            onRegisterComponent={() => setRegistering(true)}
          />
          )}
        </div>
      )}

      {registering && selected && (
        <RegisterComponentDialog node={selected} items={items} existing={components} onRegister={registerSelected} onCancel={() => setRegistering(false)} />
      )}
      {showPartMenu && editable && (
        <QuickPickMenu title="部品を追加" where={selectedId ? "選んだ部品の後ろに" : "末尾に"} placeholder="部品の種類を入力 (例: フォーム、ボタン、一覧)" items={partMenuItems} onPick={pickPart} onClose={() => setShowPartMenu(false)} />
      )}
      {menuAt && selectedId && (
        <ListContextMenu items={menuItems} x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} />
      )}
      {managing && (
        <ComponentManager initialEditId={managing.editId} screens={screens} onClose={() => setManaging(null)} />
      )}
    </div>
  );
}
