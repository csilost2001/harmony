/**
 * 業務フロー (business-flows/<id>.json) のストア。
 *
 * 一覧・編集画面・設計書ビューから共通に使う。保存は明示的 (編集画面の「保存」)。
 *
 * 仕様: docs/spec/business-flow.md
 */
import { useCallback, useEffect, useState } from "react";
import { DOC_CONFLICT_MARK, DOC_EXISTS_MARK, type BusinessFlow } from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** 一覧と、読めなかったファイル名 (JSON が壊れているもの) */
export async function listBusinessFlowsDetailed(): Promise<{ flows: BusinessFlow[]; unreadable: string[] }> {
  const res = (await mcpBridge.request("listBusinessFlows")) as { flows?: BusinessFlow[]; unreadable?: string[] } | null;
  return { flows: res?.flows ?? [], unreadable: res?.unreadable ?? [] };
}

export async function listBusinessFlows(): Promise<BusinessFlow[]> {
  return (await listBusinessFlowsDetailed()).flows;
}

export async function loadBusinessFlow(flowId: string): Promise<BusinessFlow | null> {
  return ((await mcpBridge.request("loadBusinessFlow", { flowId })) as BusinessFlow | null) ?? null;
}

/** 開いたあとに他で更新されていて、保存を断られたときのエラーかどうか */
export const isSaveConflict = (e: unknown): boolean => e instanceof Error && e.message.includes(DOC_CONFLICT_MARK);

/** 作成専用の保存で、同じ ID がすでにあったときのエラーかどうか */
export const isAlreadyExists = (e: unknown): boolean => e instanceof Error && e.message.includes(DOC_EXISTS_MARK);

/** エラーメッセージから先頭の印を取り除く (画面に出す文) */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^\[[A-Z_]+\]\s*/, "");

/** 保存する。既定では「開いたときの更新日時」と照合し、他で更新されていたら保存しない (force で上書き)。createOnly はすでにあれば失敗 (新規作成・複製用) */
export async function saveBusinessFlow(flow: BusinessFlow, opts: { force?: boolean; createOnly?: boolean } = {}): Promise<BusinessFlow> {
  const saved = (await mcpBridge.request("saveBusinessFlow", { flowId: flow.id, data: flow, expectedUpdatedAt: opts.force || opts.createOnly ? undefined : flow.updatedAt, createOnly: opts.createOnly })) as BusinessFlow;
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
export function useBusinessFlows(): { flows: BusinessFlow[]; unreadable: string[]; loaded: boolean; reload: () => Promise<void> } {
  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await listBusinessFlowsDetailed();
      setFlows(res.flows);
      setUnreadable(res.unreadable);
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
  return { flows, unreadable, loaded, reload };
}
