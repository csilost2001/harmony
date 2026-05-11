/**
 * PageLayoutDesigner — ページレイアウト ビジュアルデザイン画面 (pl-3, #1024)
 *
 * ScreenDesigner.tsx を base に editorKind で GrapesJS / Puck を分岐。
 * pl-5 (#1026): GrapesJS 経路に region gadget injection (composition プレビュー) を追加。
 * pl-5 follow-up (#1026): Puck 経路に composition preview (RegionContext + Puck Editor) を追加。
 */

import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPageLayout } from "../../store/pageLayoutStore";
import type { PageLayout } from "../../store/pageLayoutStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { Designer } from "../Designer";
import type { Editor as GEditor } from "grapesjs";
import { injectGadgetPreviews, clearGadgetPreviews, extractGrapesHtml } from "../../utils/pageLayoutCompositionPreview";
import { RegionProvider } from "../../puck/primitives/RegionContext";
import { buildPuckConfig } from "../../puck/buildConfig";
import type { RegionContextValue } from "../../puck/primitives/RegionContext";

export function PageLayoutDesigner() {
  const { pageLayoutId } = useParams<{ pageLayoutId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [pl, setPl] = useState<PageLayout | null | undefined>(undefined); // undefined = loading

  // GrapesJS editor ref (region injection 用、pl-5)
  const grapesEditorRef = useRef<GEditor | null>(null);
  const plRef = useRef<PageLayout | null>(null);
  // RFC #1021 pl-6 (Codex B-5): component:add listener cleanup ref
  const componentAddCleanupRef = useRef<(() => void) | null>(null);

  // Puck composition preview 用: RegionContext の value (pl-5 follow-up)
  // RFC #1021 pl-6 (Codex H-2): puckConfig も Context に注入し、Region primitive が
  // nested Render できるようにする (循環依存回避: buildPuckConfig は PageLayoutDesigner
  // から import するが、Region primitive は Context 経由でしか参照しない)
  const puckConfig = useMemo(() => {
    try {
      return buildPuckConfig();
    } catch { return null; }
  }, []);
  const [regionContextValue, setRegionContextValue] = useState<RegionContextValue>({
    assignments: {},
    gadgetData: {},
    puckConfig: null,
  });
  // puckConfig が確定したら Context value にも注入
  useEffect(() => {
    setRegionContextValue((prev) => ({ ...prev, puckConfig }));
  }, [puckConfig]);

  useEffect(() => {
    if (!pageLayoutId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- route param absence immediately resolves the loading sentinel.
      setPl(null);
      return;
    }

    let mounted = true;

    const doLoad = () => {
      loadPageLayout(pageLayoutId).then((data) => {
        if (!mounted) return;
        setPl(data ?? null);
        plRef.current = data ?? null;
        // assignments が変わったら再 inject (GrapesJS)
        if (grapesEditorRef.current && data) {
          _injectWithEditor(grapesEditorRef.current, data);
        }
        // Puck composition preview: assignments が変わったら gadget data を再ロード
        // RFC #1021 pl-6 (Codex 2nd review Should-fix): setRegionContextValue で
        // assignments/gadgetData を入れ替える際、puckConfig も保持する (旧実装は puckConfig を omit して
        // 上書きしていたため H-2 nested Render が assignments load 後に壊れていた)
        if (data?.assignments) {
          _loadGadgetData(data.assignments).then((gadgetData) => {
            if (!mounted) return;
            setRegionContextValue((prev) => ({
              ...prev,
              assignments: data.assignments ?? {},
              gadgetData,
            }));
          }).catch(console.warn);
        }
      }).catch(() => { if (mounted) setPl(null); });
    };

    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) doLoad();
    });

    mcpBridge.startWithoutEditor();
    doLoad();

    return () => {
      mounted = false;
      unsubStatus();
    };
  }, [pageLayoutId]);

  /**
   * GrapesJS editor ready 後に region injection を実行する。
   * component:add イベントで region が後から追加された場合にも再 inject する。
   */
  const handleGrapesEditorReady = useCallback((editor: GEditor) => {
    grapesEditorRef.current = editor;
    if (plRef.current) {
      // canvas 初期 load 完了を待ってから inject (component 描画が settleするまで少し待つ)
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          _injectWithEditor(grapesEditorRef.current, plRef.current);
        }
      }, 300);
    }

    // region ブロックが canvas に追加されたとき再 inject
    const onComponentAdd = () => {
      setTimeout(() => {
        if (plRef.current && grapesEditorRef.current) {
          clearGadgetPreviews(grapesEditorRef.current);
          _injectWithEditor(grapesEditorRef.current, plRef.current);
        }
      }, 50);
    };
    editor.on("component:add", onComponentAdd);
    // RFC #1021 pl-6 (Codex B-5): unmount/re-init 時の duplicate listener 防止
    if (componentAddCleanupRef.current) componentAddCleanupRef.current();
    componentAddCleanupRef.current = () => editor.off("component:add", onComponentAdd);
  }, []);

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

  // editorKind='grapesjs': GrapesJS Designer に region drop slot ブロックを追加済み
  // (frontend/src/grapes/blocks.ts の CAT_REGIONS カテゴリ)
  // pl-5: onGrapesEditorReady で gadget injection を実行
  if (editorKind === "grapesjs") {
    return (
      <Designer
        screenId={`page-layout:${pageLayoutId}`}
        screenName={pl.name}
        onBack={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
        onGrapesEditorReady={handleGrapesEditorReady}
      />
    );
  }

  // editorKind='puck': Puck Editor + composition preview (pl-5 follow-up: feature parity)
  // RegionProvider で Designer を wrap し、Region primitives が assignments + gadget data を参照できるようにする。
  return (
    <RegionProvider value={regionContextValue}>
      <Designer
        screenId={`page-layout:${pageLayoutId}`}
        screenName={pl.name}
        onBack={() => navigate(wsPath(`/page-layout/edit/${encodeURIComponent(pageLayoutId)}`))}
      />
    </RegionProvider>
  );
}

// ---------------------------------------------------------------------------
// Internal: GrapesJS editor に gadget preview を inject する
// ---------------------------------------------------------------------------

async function _injectWithEditor(editor: GEditor, pl: PageLayout): Promise<void> {
  try {
    const project = await loadProject();
    const screens = project.screens.map((s) => ({ id: s.id, name: s.name }));
    // RFC #1021 pl-6 (Codex A-3): assignments で参照される gadget の design HTML を抽出して inject
    const assignments = pl.assignments ?? {};
    const gadgetIds = [...new Set(Object.values(assignments).filter(Boolean))];
    const htmlMap = new Map<string, string>();
    await Promise.all(gadgetIds.map(async (id) => {
      try {
        const design = await mcpBridge.request("loadScreen", { screenId: id });
        const html = extractGrapesHtml(design);
        if (html) htmlMap.set(id, html);
      } catch { /* gadget design 不在は無視、placeholder fallback */ }
    }));
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

  // 重複を排除して並列ロード
  const uniqueIds = [...new Set(gadgetScreenIds)];
  const results = await Promise.allSettled(
    uniqueIds.map(async (screenId) => {
      const data = await mcpBridge.loadPuckData(screenId);
      return { screenId, data };
    }),
  );

  const gadgetData: Record<string, unknown> = {};
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.data !== null) {
      gadgetData[result.value.screenId] = result.value.data;
    }
  }
  return gadgetData;
}
