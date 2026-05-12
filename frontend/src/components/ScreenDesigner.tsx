import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../hooks/useWorkspacePath";
import { useEffect, useState } from "react";
import { Designer } from "./Designer";
import { loadProject, screenExists } from "../store/flowStore";
import { loadPageLayout } from "../store/pageLayoutStore";
import type { PageLayout } from "../store/pageLayoutStore";
import { mcpBridge } from "../mcp/mcpBridge";
import { extractGrapesHtml } from "../utils/pageLayoutCompositionPreview";
import type { ScreenNode } from "../types/flow";

export function ScreenDesigner() {
  const { screenId } = useParams<{ screenId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [screen, setScreen] = useState<ScreenNode | null | undefined>(undefined); // undefined = loading
  // pl-5 #1026: page Screen の場合に PageLayout メタを読み込む
  const [pageLayout, setPageLayout] = useState<PageLayout | null>(null);
  // RFC #1021 pl-6 (Codex C-1): composition preview 用に PageLayout 自身の design HTML +
  // assignments で参照される gadget の design HTML を pre-load して Designer に渡す
  const [pageLayoutHtml, setPageLayoutHtml] = useState<string | null>(null);
  const [gadgetHtmlMap, setGadgetHtmlMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!screenId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- route param absence immediately resolves the loading sentinel.
      setScreen(null);
      return;
    }

    let mounted = true;

    const doLoad = () => {
      loadProject().then(async (project) => {
        if (!mounted) return;
        if (!screenExists(project, screenId)) {
          setScreen(null);
          return;
        }
        const node = project.screens.find((s) => s.id === screenId) ?? null;
        setScreen(node);

        // pl-5 #1026 / pl-6 (Codex C-2): purpose='page' かつ pageLayoutId がある場合は PageLayout を取得
        // load 競合で失敗するケース (ワークスペース未確定 等) は status change で retry される (useEffect 上部の onStatusChange)
        if (node?.purpose === "page" && node?.pageLayoutId) {
          try {
            const pl = await loadPageLayout(node.pageLayoutId);
            if (mounted) setPageLayout(pl);
            if (!pl) {
              console.warn(`[ScreenDesigner] PageLayout ${node.pageLayoutId} の load が null を返しました (ファイル不在 / workspace 未確定)。再試行は onStatusChange/connected で実行されます。`);
            }
            // RFC #1021 pl-6 (Codex C-1): composition preview 用に PageLayout 自身の design HTML 取得
            if (pl) {
              try {
                const plDesign = await mcpBridge.request("loadScreen", { screenId: `page-layout:${pl.id}` });
                const plHtml = extractGrapesHtml(plDesign);
                if (mounted && plHtml) setPageLayoutHtml(plHtml);
              } catch { /* design file 不在は無視、banner のみで OK */ }
              // 各 gadget の design HTML も並列ロードして map に
              const gadgetIds = Object.values(pl.assignments ?? {}).filter((id): id is string => typeof id === "string");
              const nextMap = new Map<string, string>();
              await Promise.all(gadgetIds.map(async (gid) => {
                try {
                  const gd = await mcpBridge.request("loadScreen", { screenId: gid });
                  const h = extractGrapesHtml(gd);
                  if (h) nextMap.set(gid, h);
                } catch { /* skip */ }
              }));
              if (mounted) setGadgetHtmlMap(nextMap);
            }
          } catch (e) {
            console.warn(`[ScreenDesigner] loadPageLayout 失敗 (再試行は onStatusChange/connected で実行):`, e);
          }
        } else {
          if (mounted) {
            setPageLayout(null);
            setPageLayoutHtml(null);
            setGadgetHtmlMap(new Map());
          }
        }
      }).catch(() => { if (mounted) setScreen(null); });
    };

    // WS 接続完了時にファイルから再ロード
    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) doLoad();
    });

    // エディターなしで WebSocket 接続を開始
    mcpBridge.startWithoutEditor();

    // 初回ロード（WS 未接続時は localStorage フォールバック）
    doLoad();

    return () => {
      mounted = false;
      unsubStatus();
    };
  }, [screenId]);

  if (screen === undefined) {
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

  if (!screenId || !screen) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", flexDirection: "column", gap: 16,
        fontFamily: "system-ui, sans-serif", color: "#64748b",
      }}>
        <i className="bi bi-exclamation-triangle" style={{ fontSize: 48, color: "#f59e0b" }} />
        <h2 style={{ margin: 0, color: "#334155" }}>画面が見つかりません</h2>
        <p>指定された画面ID は存在しないか、削除されています。</p>
        <button
          onClick={() => navigate(wsPath("/screen/flow"))}
          style={{
            padding: "8px 20px", border: "none", borderRadius: 6,
            background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 14,
          }}
        >
          <i className="bi bi-arrow-left" /> フロー図に戻る
        </button>
      </div>
    );
  }

  return (
    <Designer
      screenId={screenId}
      screenName={screen.name}
      onBack={() => navigate(wsPath("/screen/flow"))}
      // pl-5 #1026: PageLayout 連動表示 (purpose='page' かつ pageLayoutId 設定時のみ)
      pageLayoutId={screen.purpose === "page" ? (screen.pageLayoutId ?? undefined) : undefined}
      pageLayoutName={pageLayout?.name}
      pageLayoutEditorKind={pageLayout?.design?.editorKind}
      pageLayoutCssFramework={pageLayout?.design?.cssFramework}
      // RFC #1021 pl-6 (Codex C-1): composition preview 用 HTML を pre-load
      pageLayoutHtml={pageLayoutHtml ?? undefined}
      pageLayoutAssignments={pageLayout?.assignments}
      gadgetHtmlMap={gadgetHtmlMap.size > 0 ? gadgetHtmlMap : undefined}
    />
  );
}
