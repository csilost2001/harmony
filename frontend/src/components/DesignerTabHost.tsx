/**
 * DesignerTabHost — design tab 用の Designer wrapper。
 *
 * AppShell の designTabs.map() で render される。tab metadata (screenId/screenName) から
 * Screen entity を解決し、purpose='page' + pageLayoutId のときに PageLayout + gadget の
 * design HTML を pre-load して Designer に渡す。
 *
 * 本コンポーネントが design tab の表示元 (AppShell.tsx designTabs.map 内で render)。
 *
 * RFC #1021 pl-6 (Codex C-1): composition preview 用の prop wiring。
 */

import { useEffect, useState } from "react";
import { Designer } from "./Designer";
import { loadProject } from "../store/flowStore";
import { loadPageLayout } from "../store/pageLayoutStore";
import type { PageLayout } from "../store/pageLayoutStore";
import { mcpBridge } from "../mcp/mcpBridge";
import { extractGrapesHtml, extractGrapesCss } from "../utils/pageLayoutCompositionPreview";
import { loadScreenEntity } from "../store/screenStore";
import { ScreenLayoutDesigner } from "./screen-layout/ScreenLayoutDesigner";

export interface DesignerTabHostProps {
  screenId: string;
  screenName?: string;
  isActive?: boolean;
}

/**
 * 画面デザインタブ。
 * - layout (業務部品の木) を持つ画面 → 業務部品デザイナ
 * - 旧デザイン (GrapesJS / Puck) だけを持つ未移行の画面 → 旧デザイナ + 移行の案内帯
 * - どちらも持たない画面 → 業務部品デザイナ (開始画面)
 * 移行は案内帯から業務部品デザイナの開始画面に切り替えて行う (旧デザインからの自動変換)。
 */
export function DesignerTabHost(props: DesignerTabHostProps) {
  const { screenId, screenName, isActive } = props;
  const [view, setView] = useState<"loading" | "layout" | "legacy">("loading");
  const [hasLegacy, setHasLegacy] = useState(false);
  useEffect(() => {
    let alive = true;
    setView("loading");
    loadScreenEntity(screenId)
      .then((s) => {
        if (!alive) return;
        const legacy = !!s.design && !s.layout;
        setHasLegacy(legacy);
        setView(legacy ? "legacy" : "layout");
      })
      .catch(() => { if (alive) setView("layout"); });
    return () => { alive = false; };
  }, [screenId]);

  if (view === "loading") return <div className="sld-loading" style={{ padding: 24 }}>読み込み中…</div>;
  if (view === "layout") {
    return (
      <ScreenLayoutDesigner
        screenId={screenId}
        screenName={screenName}
        isActive={isActive}
        hasLegacyDesign={hasLegacy}
        onOpenLegacy={() => setView("legacy")}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="legacy-designer-banner" data-testid="legacy-designer-banner">
        <i className="bi bi-clock-history" />
        <span>この画面は旧形式 (HTML) のデザインです。業務部品形式に移行すると、部品の配置と画面項目の定義を 1 つの画面で編集できます。</span>
        <button type="button" onClick={() => setView("layout")} data-testid="legacy-back-to-layout">業務部品形式へ移行</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LegacyDesignerHost {...props} />
      </div>
    </div>
  );
}

function LegacyDesignerHost({ screenId, screenName, isActive }: DesignerTabHostProps) {
  const [pageLayout, setPageLayout] = useState<PageLayout | null>(null);
  const [pageLayoutId, setPageLayoutId] = useState<string | undefined>(undefined);
  const [pageLayoutHtml, setPageLayoutHtml] = useState<string | undefined>(undefined);
  const [gadgetHtmlMap, setGadgetHtmlMap] = useState<Map<string, string>>(new Map());
  // #1406: composition preview に PageLayout / gadget の project CSS も合成する
  const [pageLayoutCss, setPageLayoutCss] = useState<string | undefined>(undefined);
  const [gadgetCssMap, setGadgetCssMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!screenId) return;
    let mounted = true;

    const doLoad = async () => {
      try {
        const project = await loadProject();
        if (!mounted) return;
        const node = project.screens.find((s) => s.id === screenId);
        if (!node) return;

        if (node.purpose !== "page" || !node.pageLayoutId) {
          setPageLayoutId(undefined);
          setPageLayout(null);
          setPageLayoutHtml(undefined);
          setGadgetHtmlMap(new Map());
          setPageLayoutCss(undefined);
          setGadgetCssMap(new Map());
          return;
        }
        setPageLayoutId(node.pageLayoutId);

        // PageLayout 本体
        const pl = await loadPageLayout(node.pageLayoutId);
        if (!mounted) return;
        setPageLayout(pl);
        if (!pl) return;

        // PageLayout design HTML + CSS (composition preview 用) — dedicated handler
        try {
          const plDesign = await mcpBridge.request("loadPageLayoutDesign", { pageLayoutId: pl.id });
          const html = extractGrapesHtml(plDesign);
          if (mounted && html) setPageLayoutHtml(html);
          // #1406: PageLayout の project CSS も抽出して preview に合成
          const css = extractGrapesCss(plDesign);
          if (mounted && css) setPageLayoutCss(css);
        } catch { /* ignore */ }

        // gadget design HTML 並列 pre-load
        // Round 6 Phase C: assignments value は ScreenId brand (canonical 統一)。
        // string 受け渡しのため downcast。runtime guard も typeof string で維持。
        const gadgetIds = Object.values(pl.assignments ?? {})
          .filter((id) => typeof id === "string")
          .map((id) => id as string);
        const nextMap = new Map<string, string>();
        const nextCssMap = new Map<string, string>();
        await Promise.all(gadgetIds.map(async (gid) => {
          try {
            const gd = await mcpBridge.request("loadScreen", { screenId: gid });
            const html = extractGrapesHtml(gd);
            if (html) nextMap.set(gid, html);
            // #1406: gadget の project CSS も抽出
            const css = extractGrapesCss(gd);
            if (css) nextCssMap.set(gid, css);
          } catch { /* skip */ }
        }));
        if (mounted) {
          setGadgetHtmlMap(nextMap);
          setGadgetCssMap(nextCssMap);
        }
      } catch (e) {
        console.warn("[DesignerTabHost] pageLayout pre-load failed:", e);
      }
    };

    const unsubStatus = mcpBridge.onStatusChange((status) => {
      if (status === "connected" && mounted) doLoad();
    });
    doLoad();

    return () => { mounted = false; unsubStatus(); };
  }, [screenId]);

  return (
    <Designer
      screenId={screenId}
      screenName={screenName}
      isActive={isActive}
      pageLayoutId={pageLayoutId}
      pageLayoutName={pageLayout?.name}
      pageLayoutEditorKind={pageLayout?.design?.editorKind}
      pageLayoutCssFramework={pageLayout?.design?.cssFramework}
      pageLayoutHtml={pageLayoutHtml}
      pageLayoutAssignments={pageLayout?.assignments}
      gadgetHtmlMap={gadgetHtmlMap.size > 0 ? gadgetHtmlMap : undefined}
      pageLayoutCss={pageLayoutCss}
      gadgetCssMap={gadgetCssMap.size > 0 ? gadgetCssMap : undefined}
    />
  );
}
