/**
 * 未使用の定義の検出。どこからも使われていないテーブル・メッセージ・正規表現・上限値・独自部品・画面・処理・汎用定義を一覧にして、整理を促す。
 * 使われているかどうかは、参照のつながり (graph.ts) で決める。
 */
import type { DesignDocInput, DocIssueRef } from "../designDocument.js";
import { buildDesignGraph, NODE_KIND_LABELS, type DesignGraph, type NodeKind } from "./graph.js";
import { forEachStep } from "./common.js";

export interface UnusedItem {
  kind: NodeKind;
  id: string;
  name: string;
  reason: string;
  /** 設計として開けるもの (画面・テーブル・処理・業務フロー・帳票) */
  ref?: DocIssueRef;
}

/** 参照の形 (パス) が決まっていて、使われているかどうかを決められる汎用定義の種類 */
const PATH_REFERENCED_GENERIC = new Set(["component-definition", "exception-type", "global"]);

const REF_KIND: Partial<Record<NodeKind, DocIssueRef["kind"]>> = { screen: "screen", table: "table", processFlow: "processFlow", businessFlow: "businessFlow", report: "report" };

export function findUnused(input: DesignDocInput, graph: DesignGraph = buildDesignGraph(input)): UnusedItem[] {
  const out: UnusedItem[] = [];
  const used = (key: string) => (graph.dependents.get(key)?.length ?? 0) > 0;
  const push = (kind: NodeKind, id: string, name: string, reason: string) => out.push({ kind, id, name, reason, ...(REF_KIND[kind] ? { ref: { kind: REF_KIND[kind]!, id } } : {}) });

  // テーブル: 処理・画面項目・帳票から使われていなければ未使用。他のテーブルの外部キーの参照先であるだけなら、その旨を添える
  for (const t of input.tables) {
    const inbound = graph.dependents.get(`table:${t.id}`) ?? [];
    if (inbound.some((e) => !e.from.startsWith("table:"))) continue;
    push("table", t.id, t.name ?? t.physicalName ?? t.id, inbound.length ? "どの処理・画面項目・帳票からも使われていません (他のテーブルの外部キーの参照先としてだけ使われています)" : "どの処理・画面項目・帳票・外部キーからも使われていません");
  }
  for (const [k, m] of Object.entries(input.messages ?? {})) if (!used(`message:${k}`)) push("message", k, k, `どこからも使われていません${m.template ? ` (文面: ${m.template.length > 40 ? `${m.template.slice(0, 40)}…` : m.template})` : ""}`);
  for (const k of Object.keys(input.regex ?? {})) if (!used(`regex:${k}`)) push("regex", k, k, "どこからも使われていません");
  for (const k of Object.keys(input.limits ?? {})) if (!used(`limit:${k}`)) push("limit", k, k, "どこからも使われていません");
  for (const c of input.layoutComponents ?? []) if (!used(`component:${c.id}`)) push("component", c.id, c.label ?? c.id, "どの画面でも使われていません");

  // 画面: 画面遷移・業務フロー・帳票・処理の画面遷移のどれからも辿れない (入口の画面なら、問題ありません)
  for (const s of input.screens.filter((x) => x.purpose !== "gadget")) {
    if (!used(`screen:${s.id}`)) push("screen", s.id, s.name ?? s.id, "どの画面遷移・業務フロー・帳票からも辿れません (入口の画面なら問題ありません)");
  }
  // 処理: 画面のイベント・業務フロー・共通処理・購読から呼ばれない。バッチ・定期・外部から呼ぶもの (httpRoute) は除く
  const entry = (f: DesignDocInput["flows"][number]) => f.meta.flowType === "batch" || f.meta.flowType === "scheduled" || f.actions.some((a) => a.httpRoute) || !!f.meta.screenId;
  const subscribes = (f: DesignDocInput["flows"][number]) => { let hit = false; for (const a of f.actions) forEachStep(a.steps, (s) => { if (s.kind === "eventSubscribe") hit = true; }); return hit; };
  for (const f of input.flows) {
    if (!used(`processFlow:${f.meta.id}`) && !entry(f) && !subscribes(f)) push("processFlow", f.meta.id, f.meta.name ?? f.meta.id, "どの画面のイベント・業務フロー・共通処理の呼び出しからも使われていません");
  }
  for (const g of input.genericDefinitions ?? []) {
    if (PATH_REFERENCED_GENERIC.has(g.kind) && !used(`genericDefinition:${g.kind}/${g.name}`)) push("genericDefinition", `${g.kind}/${g.name}`, `${g.name} (${g.kind})`, "どこからも参照されていません");
  }
  return out;
}

export function unusedSummary(items: readonly UnusedItem[]): Array<{ kind: NodeKind; label: string; count: number }> {
  const m = new Map<NodeKind, number>();
  for (const i of items) m.set(i.kind, (m.get(i.kind) ?? 0) + 1);
  return [...m.entries()].map(([kind, count]) => ({ kind, label: NODE_KIND_LABELS[kind], count }));
}
