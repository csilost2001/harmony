/**
 * プロジェクト独自部品 (layout-components.json) のストア。
 *
 * 画面デザイナ・独自部品の管理画面・設計書ビューから共通に使う。保存は 1 件ずつ
 * (backend が読んで・差し替えて・書くを直列に行う) ため、別の部品の編集を上書きしない。
 *
 * 仕様: docs/spec/layout-components.md
 */
import { useCallback, useEffect, useState } from "react";
import type { LayoutComponentDef } from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";

export interface LayoutComponentUsages { screens: string[]; components: string[] }

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function loadLayoutComponents(): Promise<LayoutComponentDef[]> {
  const doc = (await mcpBridge.request("loadLayoutComponents")) as { components?: LayoutComponentDef[] } | null;
  return doc?.components ?? [];
}

export async function saveLayoutComponent(component: LayoutComponentDef): Promise<void> {
  await mcpBridge.request("saveLayoutComponent", { component });
  notify();
}

export async function deleteLayoutComponent(componentId: string, force = false): Promise<{ deleted: boolean; usages: LayoutComponentUsages }> {
  const res = (await mcpBridge.request("deleteLayoutComponent", { componentId, force })) as { deleted: boolean; usages: LayoutComponentUsages };
  if (res.deleted) notify();
  return res;
}

export async function findLayoutComponentUsages(componentId: string): Promise<LayoutComponentUsages> {
  return (await mcpBridge.request("findLayoutComponentUsages", { componentId })) as LayoutComponentUsages;
}

/** 独自部品の一覧。保存・削除 (自分 / 他のブラウザ) のたびに読み直す */
export function useLayoutComponents(): { components: LayoutComponentDef[]; loaded: boolean; reload: () => Promise<void> } {
  const [components, setComponents] = useState<LayoutComponentDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setComponents(await loadLayoutComponents());
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    reload().catch(console.error);
    const onLocal = () => { reload().catch(console.error); };
    listeners.add(onLocal);
    const off = mcpBridge.onBroadcast("layoutComponentsChanged", onLocal);
    return () => { listeners.delete(onLocal); off(); };
  }, [reload]);
  return { components, loaded, reload };
}
