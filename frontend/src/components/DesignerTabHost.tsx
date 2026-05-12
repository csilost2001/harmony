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
import { extractGrapesHtml } from "../utils/pageLayoutCompositionPreview";

export interface DesignerTabHostProps {
  screenId: string;
  screenName?: string;
  isActive?: boolean;
}

export function DesignerTabHost({ screenId, screenName, isActive }: DesignerTabHostProps) {
  const [pageLayout, setPageLayout] = useState<PageLayout | null>(null);
  const [pageLayoutId, setPageLayoutId] = useState<string | undefined>(undefined);
  const [pageLayoutHtml, setPageLayoutHtml] = useState<string | undefined>(undefined);
  const [gadgetHtmlMap, setGadgetHtmlMap] = useState<Map<string, string>>(new Map());

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
          return;
        }
        setPageLayoutId(node.pageLayoutId);

        // PageLayout 本体
        const pl = await loadPageLayout(node.pageLayoutId);
        if (!mounted) return;
        setPageLayout(pl);
        if (!pl) return;

        // PageLayout design HTML (composition preview 用) — dedicated handler
        try {
          const plDesign = await mcpBridge.request("loadPageLayoutDesign", { pageLayoutId: pl.id });
          const html = extractGrapesHtml(plDesign);
          if (mounted && html) setPageLayoutHtml(html);
        } catch { /* ignore */ }

        // gadget design HTML 並列 pre-load
        const gadgetIds = Object.values(pl.assignments ?? {}).filter((id): id is string => typeof id === "string");
        const nextMap = new Map<string, string>();
        await Promise.all(gadgetIds.map(async (gid) => {
          try {
            const gd = await mcpBridge.request("loadScreen", { screenId: gid });
            const html = extractGrapesHtml(gd);
            if (html) nextMap.set(gid, html);
          } catch { /* skip */ }
        }));
        if (mounted) setGadgetHtmlMap(nextMap);
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
    />
  );
}
