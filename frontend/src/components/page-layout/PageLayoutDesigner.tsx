/**
 * PageLayoutDesigner — ページレイアウト ビジュアルデザイン画面 (pl-3, #1024)
 *
 * ScreenDesigner.tsx を base に editorKind で GrapesJS / Puck を分岐。
 * pl-5 (#1026): GrapesJS 経路に region gadget injection (composition プレビュー) を追加。
 * pl-5 follow-up (#1026): Puck 経路に composition preview (RegionContext + Puck Editor) を追加。
 */

import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPageLayout } from "../../store/pageLayoutStore";
import type { PageLayout } from "../../store/pageLayoutStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { Designer } from "../Designer";
import type { Editor as GEditor } from "grapesjs";
import { injectGadgetPreviews, clearGadgetPreviews } from "../../utils/pageLayoutCompositionPreview";
import { RegionProvider } from "../../puck/primitives/RegionContext";
import type { RegionContextValue } from "../../puck/primitives/RegionContext";

export function PageLayoutDesigner() {
  const { pageLayoutId } = useParams<{ pageLayoutId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [pl, setPl] = useState<PageLayout | null | undefined>(undefined); // undefined = loading

  // GrapesJS editor ref (region injection 用、pl-5)
  const grapesEditorRef = useRef<GEditor | null>(null);
  const plRef = useRef<PageLayout | null>(null);

  // Puck composition preview 用: RegionContext の value (pl-5 follow-up)
  const [regionContextValue, setRegionContextValue] = useState<RegionContextValue>({
    assignments: {},
    gadgetData: {},
  });

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
        if (data?.assignments) {
          _loadGadgetData(data.assignments).then((gadgetData) => {
            if (!mounted) return;
            setRegionContextValue({
              assignments: data.assignments ?? {},
              gadgetData,
            });
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
    // cleanup は Designer の unmount 時に editor も unmount されるので editor.off は不要だが念のため
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
    injectGadgetPreviews(editor, pl.assignments ?? {}, screens);
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
