/**
 * 「この設計が使っているもの」(UI 改善提案 続編 第 6 弾 #113)。設計どうしの参照のつながり (shared の buildDesignGraph) から、
 * ある設計が頼っている先を、種類ごとにまとめる。参照元 (この設計を使っている側) は、backend の findEntityReferences が受け持つ。
 * つながりに含まれる種類 (画面・処理フロー・テーブル・業務フロー・帳票・独自部品・メッセージなど) だけが対象。
 */
import { NODE_KIND_LABELS, buildDesignGraph, type DesignDocInput, type DesignGraph, type NodeKind } from "@harmony/shared";

export type GraphKind = "screen" | "processFlow" | "table";

/** 参照元ダイアログの種類 (ReferenceTargetType) のうち、つながりを持つもの → グラフの種類 */
export function graphKindOf(entityType: string): GraphKind | null {
  return entityType === "screen" || entityType === "processFlow" || entityType === "table" ? entityType : null;
}

export interface UsedItem { kind: NodeKind; kindLabel: string; id: string; name: string; /** どういうつながりか (重複は「、」で連ねる) */ how: string; route: string | null }

export const ROUTES: Partial<Record<NodeKind, (id: string) => string>> = {
  screen: (id) => `/screen/design/${encodeURIComponent(id)}`,
  processFlow: (id) => `/process-flow/edit/${encodeURIComponent(id)}`,
  table: (id) => `/table/edit/${encodeURIComponent(id)}`,
  businessFlow: (id) => `/business-flow/edit/${encodeURIComponent(id)}`,
  report: (id) => `/report/edit/${encodeURIComponent(id)}`,
};

/** kind/id の設計が頼っている先。同じ相手は 1 件にまとめる (つながりの説明は連ねる) */
export function usesOf(graph: DesignGraph, kind: GraphKind, id: string): UsedItem[] {
  const out = new Map<string, UsedItem>();
  for (const e of graph.dependencies.get(`${kind}:${id}`) ?? []) {
    const node = graph.nodes.get(e.to);
    if (!node || node.key === `${kind}:${id}`) continue;
    const cur = out.get(node.key);
    if (cur) { if (!cur.how.split("、").includes(e.label)) cur.how += `、${e.label}`; continue; }
    out.set(node.key, { kind: node.kind, kindLabel: NODE_KIND_LABELS[node.kind], id: node.id, name: node.name, how: e.label, route: ROUTES[node.kind]?.(node.id) ?? null });
  }
  return [...out.values()].sort((a, b) => a.kindLabel.localeCompare(b.kindLabel, "ja") || a.name.localeCompare(b.name, "ja"));
}

export function usesFromInput(input: DesignDocInput, kind: GraphKind, id: string): UsedItem[] {
  return usesOf(buildDesignGraph(input), kind, id);
}
