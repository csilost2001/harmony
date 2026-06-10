/**
 * PageLayoutDesigner — ページレイアウト ビジュアルデザイン画面 (pl-3, #1024)
 *
 * DesignerTabHost.tsx と同等の wrap で editorKind ごとに GrapesJS / Puck を分岐。
 * pl-5 (#1026): GrapesJS 経路に region gadget injection (composition プレビュー) を追加。
 * pl-5 follow-up (#1026): Puck 経路に composition preview (RegionContext + Puck Editor) を追加。
 */

import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPageLayout, savePageLayout } from "../../store/pageLayoutStore";
import type { PageLayout } from "../../store/pageLayoutStore";
import type { ScreenId } from "../../types/v3";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { Designer } from "../Designer";
import type { Editor as GEditor } from "grapesjs";
import { injectGadgetPreviews, clearGadgetPreviews, extractGrapesHtml } from "../../utils/pageLayoutCompositionPreview";
import { RegionProvider } from "../../puck/primitives/RegionContext";
import { buildConfigWithCustomComponents } from "../../puck/buildConfig";
import { loadCustomPuckComponents } from "../../store/puckComponentsStore";
import type { RegionContextValue } from "../../puck/primitives/RegionContext";
import "../../styles/pageLayoutDesigner.css";

const GADGET_DATA_LOAD_CONCURRENCY = 4;

type ScreenNameIndex = Array<{ id: string; name: string }>;
type ScreenNameIndexLoader = () => Promise<ScreenNameIndex>;
type GadgetOption = { id: string; name: string };

const RESERVED_REGION_ORDER = ["header", "sidebar", "main", "footer"];

export function PageLayoutDesigner() {
  const { pageLayoutId } = useParams<{ pageLayoutId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [pl, setPl] = useState<PageLayout | null | undefined>(undefined); // undefined = loading
  const [gadgetOptions, setGadgetOptions] = useState<GadgetOption[]>([]);
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string>>({});
  const [assignmentDirty, setAssignmentDirty] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [externalPageLayoutChanged, setExternalPageLayoutChanged] = useState(false);

  // GrapesJS editor ref (region injection 用、pl-5)
  const grapesEditorRef = useRef<GEditor | null>(null);
  const plRef = useRef<PageLayout | null>(null);
  const assignmentDirtyRef = useRef(false);
  const screenNameIndexPromiseRef = useRef<Promise<ScreenNameIndex> | null>(null);
  // RFC #1021 pl-6 (Codex B-5): component:add listener cleanup ref
  const componentAddCleanupRef = useRef<(() => void) | null>(null);

  const getScreenNameIndex = useCallback(() => {
    if (!screenNameIndexPromiseRef.current) {
      screenNameIndexPromiseRef.current = loadProject()
        .then((project) => project.screens.map((s) => ({ id: s.id, name: s.name })))
        .catch((e) => {
          screenNameIndexPromiseRef.current = null;
          throw e;
        });
    }
    return screenNameIndexPromiseRef.current;
  }, []);

  // Puck composition preview 用: RegionContext の value (pl-5 follow-up)
  // RFC #1021 pl-6 (Codex H-2): puckConfig も Context に注入し、Region primitive が
  // nested Render できるようにする (循環依存回避: buildPuckConfig は PageLayoutDesigner
  // から import するが、Region primitive は Context 経由でしか参照しない)
  const puckConfig = useMemo(() => {
    try {
      return buildConfigWithCustomComponents([]);
    } catch { return null; }
  }, []);
  const [regionContextValue, setRegionContextValue] = useState<RegionContextValue>({
    assignments: {},
    gadgetData: {},
    puckConfig,
  });

  const refreshCompositionPreview = useCallback((data: PageLayout) => {
    plRef.current = data;
    if (grapesEditorRef.current) {
      clearGadgetPreviews(grapesEditorRef.current);
      _injectWithEditor(grapesEditorRef.current, data, getScreenNameIndex);
    }
    _loadGadgetData(data.assignments ?? {}).then((gadgetData) => {
      setRegionContextValue((prev) => ({
        ...prev,
        assignments: data.assignments ?? {},
        gadgetData,
      }));
    }).catch(console.warn);
  }, [getScreenNameIndex]);

  const reloadPuckConfig = useCallback(async () => {
    try {
      const customComponents = await loadCustomPuckComponents();
      const nextPuckConfig = buildConfigWithCustomComponents(customComponents);
      setRegionContextValue((prev) => ({ ...prev, puckConfig: nextPuckConfig }));
    } catch (e) {
      console.warn("[PageLayoutDesigner] custom puck components load failed:", e);
    }
  }, []);

  const loadCommittedPageLayoutDesign = useCallback(async () => {
    if (!pageLayoutId) return null;
    return await mcpBridge.request("loadPageLayoutDesign", { pageLayoutId });
  }, [pageLayoutId]);

  useEffect(() => {
    assignmentDirtyRef.current = assignmentDirty;
  }, [assignmentDirty]);

  const reloadGadgetOptions = useCallback(async () => {
    setGadgetOptions(await loadGadgetOptions());
  }, []);

  const reloadPageLayout = useCallback(async () => {
    if (!pageLayoutId) {
      setPl(null);
      return;
    }
    const data = await loadPageLayout(pageLayoutId);
    if (!data) {
      setPl(null);
      plRef.current = null;
      return;
    }
    setPl(data);
    setAssignmentDraft(data.assignments ?? {});
    setAssignmentDirty(false);
    setAssignmentError(null);
    setExternalPageLayoutChanged(false);
    refreshCompositionPreview(data);
  }, [pageLayoutId, refreshCompositionPreview]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- server-side custom Puck components are external state.
    void reloadPuckConfig();
    const unsubPuckComponentsChanged = mcpBridge.onBroadcast("puckComponentsChanged", () => {
      void reloadPuckConfig();
    });
    return () => unsubPuckComponentsChanged();
  }, [reloadPuckConfig]);

  useEffect(() => {
    if (!pageLayoutId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- route param absence immediately resolves the loading sentinel.
      setPl(null);
      return;
    }

    let mounted = true;

    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) {
        if (assignmentDirtyRef.current) {
          setExternalPageLayoutChanged(true);
          setAssignmentError("接続が復旧しました。未保存の割り当てがあります。再読み込みして最新 PageLayout を確認してください。");
        } else {
          void reloadPageLayout();
        }
        void reloadGadgetOptions();
      }
    });

    mcpBridge.startWithoutEditor();
    reloadPageLayout().catch(() => { if (mounted) setPl(null); });

    return () => {
      mounted = false;
      unsubStatus();
    };
  }, [pageLayoutId, reloadGadgetOptions, reloadPageLayout]);

  useEffect(() => {
    let mounted = true;
    loadGadgetOptions().then((options) => {
      if (!mounted) return;
      setGadgetOptions(options);
    }).catch(console.warn);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const unsubProjectChanged = mcpBridge.onBroadcast("projectChanged", () => {
      screenNameIndexPromiseRef.current = null;
      void reloadGadgetOptions();
      if (grapesEditorRef.current && plRef.current) {
        _injectWithEditor(grapesEditorRef.current, plRef.current, getScreenNameIndex);
      }
    });
    return () => unsubProjectChanged();
  }, [getScreenNameIndex, reloadGadgetOptions]);

  useEffect(() => {
    const unsubPageLayoutChanged = mcpBridge.onBroadcast("pageLayoutChanged", (data) => {
      if (!isTargetPageLayoutBroadcast(data, pageLayoutId)) return;
      if (assignmentDirty) {
        setExternalPageLayoutChanged(true);
        setAssignmentError("ページレイアウトが別セッションで更新されました。再読み込みしてから割り当てを保存してください。");
        return;
      }
      void reloadPageLayout();
    });
    return () => unsubPageLayoutChanged();
  }, [assignmentDirty, pageLayoutId, reloadPageLayout]);

  /**
   * GrapesJS editor ready 後に region injection を実行する。
   * component:add イベントで region が後から追加された場合にも再 inject する。
   */
  const handleGrapesEditorReady = useCallback((editor: GEditor) => {
    if (grapesEditorRef.current === editor) return;
    grapesEditorRef.current = editor;
    if (plRef.current) {
      // canvas 初期 load 完了を待ってから inject (component 描画が settleするまで少し待つ)
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          _injectWithEditor(grapesEditorRef.current, plRef.current, getScreenNameIndex);
        }
      }, 300);
    }

    // region ブロックが canvas に追加されたとき再 inject
    const onComponentAdd = () => {
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          clearGadgetPreviews(grapesEditorRef.current);
          _injectWithEditor(grapesEditorRef.current, plRef.current, getScreenNameIndex);
        }
      }, 50);
    };
    editor.on("component:add", onComponentAdd);
    // RFC #1021 pl-6 (Codex B-5): unmount/re-init 時の duplicate listener 防止
    if (componentAddCleanupRef.current) componentAddCleanupRef.current();
    componentAddCleanupRef.current = () => editor.off("component:add", onComponentAdd);
  }, [getScreenNameIndex]);

  // RFC #1021 pl-6 (Codex B-5): unmount 時に listener を解除
  useEffect(() => {
    return () => {
      componentAddCleanupRef.current?.();
      componentAddCleanupRef.current = null;
    };
  }, []);

  if (pl === undefined) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 16,
        fontFamily: "system-ui, sans-serif", color: "#64748b",
      }}>
        <div className="spinner" />
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!pageLayoutId || !pl) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 16,
        fontFamily: "system-ui, sans-serif", color: "#64748b",
      }}>
        <i className="bi bi-exclamation-triangle" style={{ fontSize: 48, color: "#f59e0b" }} />
        <h2 style={{ margin: 0, color: "#334155" }}>ページレイアウトが見つかりません</h2>
        <p>指定された ID のページレイアウトは存在しないか、削除されています。</p>
        <button
          onClick={() => navigate(wsPath("/page-layout/list"))}
          style={{
            padding: "8px 20px", border: "none", borderRadius: 6,
            background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 14,
          }}
        >
          <i className="bi bi-arrow-left" /> 一覧に戻る
        </button>
      </div>
    );
  }

  const editorKind = pl.design?.editorKind ?? "grapesjs";
  const cssFramework = pl.design?.cssFramework ?? "bootstrap";
  const visualRegions = buildVisualRegions(pl);
  const assignedGadgetIds = new Set(Object.values(assignmentDraft).filter(Boolean));
  const gadgetOptionMap = new Map(gadgetOptions.map((gadget) => [gadget.id, gadget.name]));
  const selectOptions = [
    ...gadgetOptions,
    ...[...assignedGadgetIds]
      .filter((id) => !gadgetOptionMap.has(id))
      .map((id) => ({ id, name: `不明な gadget (${id})` })),
  ];

  const handleAssignmentChange = (regionName: string, screenId: string) => {
    if (regionName === "main") return;
    setAssignmentDraft((prev) => {
      const next = { ...prev };
      if (screenId) {
        next[regionName] = screenId;
      } else {
        delete next[regionName];
      }
      return next;
    });
    setAssignmentDirty(true);
    if (!externalPageLayoutChanged) {
      setAssignmentError(null);
    }
  };

  const handleReloadPageLayout = () => {
    void reloadPageLayout();
  };

  const handleSaveAssignments = async () => {
    if (!assignmentDirty || assignmentSaving) return;
    if (externalPageLayoutChanged) {
      setAssignmentError("ページレイアウトが別セッションで更新されています。再読み込みしてから割り当てを保存してください。");
      return;
    }
    setAssignmentSaving(true);
    setAssignmentError(null);
    try {
      const latest = await loadPageLayout(pageLayoutId);
      if (!latest) throw new Error(`PageLayout not found: ${pageLayoutId}`);
      const next: PageLayout = {
        ...latest,
        assignments: assignmentDraft as Record<string, ScreenId>,
      };
      await savePageLayout(next);
      setPl(next);
      setAssignmentDirty(false);
      refreshCompositionPreview(next);
    } catch (e) {
      console.error("[PageLayoutDesigner] assignment save failed:", e);
      setAssignmentError("割り当てを保存できませんでした");
    } finally {
      setAssignmentSaving(false);
    }
  };

  const editor = (
    editorKind === "grapesjs"
      ? (
        <Designer
          screenId={`page-layout:${pageLayoutId}`}
          resourceKind="pageLayout"
          screenName={pl.name}
          editSessionResourceType="page-layout-design"
          editSessionResourceId={pageLayoutId}
          designEditorKind={editorKind}
          designCssFramework={cssFramework}
          loadCommittedDesign={loadCommittedPageLayoutDesign}
          onBack={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
          onGrapesEditorReady={handleGrapesEditorReady}
        />
      )
      : (
        <RegionProvider value={regionContextValue}>
          <Designer
            screenId={`page-layout:${pageLayoutId}`}
            resourceKind="pageLayout"
            screenName={pl.name}
            editSessionResourceType="page-layout-design"
            editSessionResourceId={pageLayoutId}
            designEditorKind={editorKind}
            designCssFramework={cssFramework}
            loadCommittedDesign={loadCommittedPageLayoutDesign}
            onBack={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
          />
        </RegionProvider>
      )
  );

  return (
    <div className="pld-page">
      <section className="pld-manager" aria-label="ページレイアウトマネージャ">
        <div className="pld-manager-header">
          <div>
            <div className="pld-kicker">PageLayout Manager</div>
            <h1>{pl.name}</h1>
            <div className="pld-meta">
              <span><i className="bi bi-layout-wtf" /> {visualRegions.length} slots</span>
              <span><i className="bi bi-puzzle" /> {Object.keys(assignmentDraft).length} assignments</span>
              <span><i className="bi bi-brush" /> {editorKind} / {cssFramework}</span>
            </div>
          </div>
          <div className="pld-manager-actions">
            <button
              type="button"
              className="pld-btn pld-btn-secondary"
              onClick={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
            >
              <i className="bi bi-diagram-3" /> 構造編集
            </button>
            <button
              type="button"
              className="pld-btn pld-btn-primary"
              onClick={handleSaveAssignments}
              disabled={!assignmentDirty || assignmentSaving || externalPageLayoutChanged}
            >
              <i className="bi bi-save" /> {assignmentSaving ? "保存中..." : "割り当て保存"}
            </button>
          </div>
        </div>

        {assignmentError && (
          <div className="pld-alert" role="alert">
            <span>
              <i className="bi bi-exclamation-triangle" /> {assignmentError}
            </span>
            {externalPageLayoutChanged && (
              <button type="button" className="pld-alert-action" onClick={handleReloadPageLayout}>
                <i className="bi bi-arrow-clockwise" /> 再読み込み
              </button>
            )}
          </div>
        )}

        <div className="pld-manager-grid">
          <div className="pld-canvas" data-testid="page-layout-manager-canvas">
            {visualRegions.map((region) => {
              const assignedId = assignmentDraft[region.name];
              const assignedName = assignedId ? gadgetOptionMap.get(assignedId) ?? assignedId : "";
              return (
                <section
                  key={region.name}
                  className={`pld-slot pld-slot-${region.role}`}
                  data-testid={`page-layout-slot-${region.name}`}
                >
                  <div className="pld-slot-head">
                    <span className="pld-slot-label">{region.label}</span>
                    <code>{region.name}</code>
                  </div>
                  {region.description && <p>{region.description}</p>}
                  {region.name === "main" ? (
                    <div className="pld-content-slot">
                      <i className="bi bi-window" />
                      <span>page Screen content</span>
                    </div>
                  ) : (
                    <div className={assignedId ? "pld-gadget-chip assigned" : "pld-gadget-chip"}>
                      <i className={assignedId ? "bi bi-puzzle-fill" : "bi bi-plus-square-dotted"} />
                      <span>{assignedName || "未割り当て"}</span>
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <aside className="pld-side-panel" aria-label="slot assignments">
            <div className="pld-side-title">
              <i className="bi bi-ui-checks-grid" />
              <span>Slot assignments</span>
            </div>
            <div className="pld-assignment-list">
              {visualRegions.map((region) => (
                <label key={region.name} className="pld-assignment-row">
                  <span>
                    <code>{region.name}</code>
                    <small>{region.label}</small>
                  </span>
                  {region.name === "main" ? (
                    <span className="pld-main-lock">
                      <i className="bi bi-lock" /> content slot
                    </span>
                  ) : (
                    <select
                      value={assignmentDraft[region.name] ?? ""}
                      onChange={(e) => handleAssignmentChange(region.name, e.target.value)}
                      data-testid={`page-layout-assignment-${region.name}`}
                    >
                      <option value="">未割り当て</option>
                      {selectOptions.map((gadget) => (
                        <option key={gadget.id} value={gadget.id}>{gadget.name}</option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="pld-designer-shell" aria-label="ページレイアウトデザイン詳細">
        {editor}
      </section>
    </div>
  );
}

function buildVisualRegions(pl: PageLayout) {
  const regions = pl.regions ?? [];
  return [...regions].sort((a, b) => {
    const ai = RESERVED_REGION_ORDER.indexOf(a.name);
    const bi = RESERVED_REGION_ORDER.indexOf(b.name);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }).map((region) => {
    const role = RESERVED_REGION_ORDER.includes(region.name) ? region.name : "custom";
    return {
      ...region,
      role,
      label: role === "header"
        ? "Header"
        : role === "sidebar"
        ? "Sidebar"
        : role === "main"
        ? "Main content"
        : role === "footer"
        ? "Footer"
        : "Custom slot",
    };
  });
}

function isTargetPageLayoutBroadcast(data: unknown, pageLayoutId: string | undefined): boolean {
  if (!pageLayoutId) return false;
  if (!data || typeof data !== "object") return true;
  const payload = data as { pageLayoutId?: unknown; id?: unknown };
  const broadcastId = payload.pageLayoutId ?? payload.id;
  return broadcastId === undefined || String(broadcastId) === pageLayoutId;
}

async function loadGadgetOptions(): Promise<GadgetOption[]> {
  const project = await loadProject();
  return (project.screens ?? [])
    .filter((screen) => screen.purpose === "gadget")
    .map((screen) => ({ id: screen.id, name: screen.name }));
}

// ---------------------------------------------------------------------------
// Internal: GrapesJS editor に gadget preview を inject する
// ---------------------------------------------------------------------------

async function _injectWithEditor(
  editor: GEditor,
  pl: PageLayout,
  loadScreenNameIndex: ScreenNameIndexLoader,
): Promise<void> {
  try {
    const screens = await loadScreenNameIndex();
    // RFC #1021 pl-6 (Codex A-3): assignments で参照される gadget の design HTML を抽出して inject
    const assignments = pl.assignments ?? {};
    const gadgetIds = [...new Set(Object.values(assignments).filter(Boolean))];
    const htmlMap = new Map<string, string>();
    await mapWithConcurrency(gadgetIds, GADGET_DATA_LOAD_CONCURRENCY, async (id) => {
      try {
        const design = await mcpBridge.request("loadScreen", { screenId: id });
        const html = extractGrapesHtml(design);
        if (html) htmlMap.set(id, html);
      } catch { /* gadget design 不在は無視、placeholder fallback */ }
    });
    injectGadgetPreviews(editor, assignments, screens, htmlMap);
  } catch (e) {
    console.warn("[PageLayoutDesigner] gadget inject failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Internal: Puck 経路 — 割り当て済み gadget の Puck data を全件ロードする
// ---------------------------------------------------------------------------

/**
 * assignments に含まれる gadget screenId ごとに Puck data をロードして返す。
 * ロード失敗した gadget は gadgetData から省略する (silent skip)。
 */
async function _loadGadgetData(
  assignments: Record<string, string>,
): Promise<Record<string, unknown>> {
  const gadgetScreenIds = Object.values(assignments).filter(Boolean);
  if (gadgetScreenIds.length === 0) return {};

  // 重複を排除しつつ、backend / WebSocket に一斉 I/O を投げないよう同時実行数を制限する。
  const uniqueIds = [...new Set(gadgetScreenIds)];
  const results = await mapWithConcurrency(uniqueIds, GADGET_DATA_LOAD_CONCURRENCY, async (screenId) => {
    const data = await mcpBridge.loadPuckData(screenId);
    return { screenId, data };
  });

  const gadgetData: Record<string, unknown> = {};
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data !== null) {
      gadgetData[result.value.screenId] = result.value.data;
    }
  }
  return gadgetData;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));

  return results;
}
