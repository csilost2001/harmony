/**
 * 業務フロー (business-flows/<id>.json) のストア。
 *
 * 一覧・編集画面・設計書ビューから共通に使う。保存は明示的 (編集画面の「保存」)。
 *
 * 仕様: docs/spec/business-flow.md
 */
import { useCallback, useEffect, useState } from "react";
import type { BusinessFlow } from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function listBusinessFlows(): Promise<BusinessFlow[]> {
  return ((await mcpBridge.request("listBusinessFlows")) as BusinessFlow[] | null) ?? [];
}

export async function loadBusinessFlow(flowId: string): Promise<BusinessFlow | null> {
  return ((await mcpBridge.request("loadBusinessFlow", { flowId })) as BusinessFlow | null) ?? null;
}

export async function saveBusinessFlow(flow: BusinessFlow): Promise<BusinessFlow> {
  const saved = (await mcpBridge.request("saveBusinessFlow", { flowId: flow.id, data: flow })) as BusinessFlow;
  notify();
  return saved;
}

export async function deleteBusinessFlow(flowId: string): Promise<void> {
  await mcpBridge.request("deleteBusinessFlow", { flowId });
  notify();
}

/** 新しい業務フロー (開始と終了だけを持つ) */
export function buildDefaultBusinessFlow(id: string, name: string): BusinessFlow {
  return {
    version: 1, id, name, maturity: "draft",
    lanes: [{ id: "lane1", name: "担当者", kind: "person" }],
    steps: [
      { id: "start", lane: "lane1", kind: "start", name: "開始", next: [{ to: "end" }] },
      { id: "end", lane: "lane1", kind: "end", name: "終了" },
    ],
  };
}

/** 業務フローの一覧。保存・削除 (自分 / 他のブラウザ) のたびに読み直す */
export function useBusinessFlows(): { flows: BusinessFlow[]; loaded: boolean; reload: () => Promise<void> } {
  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setFlows(await listBusinessFlows());
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    reload().catch(console.error);
    const onLocal = () => { reload().catch(console.error); };
    listeners.add(onLocal);
    const off = mcpBridge.onBroadcast("businessFlowChanged", onLocal);
    return () => { listeners.delete(onLocal); off(); };
  }, [reload]);
  return { flows, loaded, reload };
}
