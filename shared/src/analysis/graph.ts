/**
 * 設計どうしの参照のつながり (グラフ)。影響分析・対応表・未使用の検出が、同じつながりを使う。
 *
 * 辺は「from が to に頼っている (to を変えると from に影響する)」向き。
 * 画面項目 → 列、画面 → 処理 (イベント)、処理 → テーブル / 画面 / 別の処理、業務フロー → 画面・処理、帳票 → 画面・処理・列、
 * テーブル → 外部キーの参照先、画面 → 独自部品、設計 → メッセージ・正規表現・上限値・汎用定義 (文字列の `@conv.*` / `generic-definitions/*` の参照)。
 * 入力 (`DesignDocInput`) に含まれる種類だけが対象 (シーケンス・ビュー・ページレイアウトは含まれない)。
 */
import type { DesignDocInput } from "../designDocument.js";
import type { FlowStep } from "../flowStructure.js";
import { parseSource } from "../report.js";
import { walkLayout } from "../screenLayout.js";
import { bindingColumnRef, convRefs, forEachStep, genericDefinitionRefs, jsonText, nodeKey } from "./common.js";

export type NodeKind = "screen" | "processFlow" | "table" | "businessFlow" | "report" | "component" | "message" | "regex" | "limit" | "genericDefinition";

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  screen: "画面", processFlow: "処理フロー", table: "テーブル", businessFlow: "業務フロー", report: "帳票", component: "独自部品",
  message: "メッセージ", regex: "正規表現", limit: "上限値", genericDefinition: "汎用定義",
};

export interface DesignNode { key: string; kind: NodeKind; id: string; name: string }
export interface DesignEdge {
  /** 頼っている側 */
  from: string;
  /** 頼られている側 (これを変えると from に影響する) */
  to: string;
  /** どういうつながりか (人が読む短い文) */
  label: string;
  /** 列単位のつながり (列の Column.id か物理名) */
  column?: string;
  /** 列単位のつながり (複数の列。外部キーが指す親の列) */
  columns?: string[];
}

/** 画面 ← その画面の処理 (`meta.screenId`) の辺のラベル。画面が「使われている」ことには数えない */
export const OWN_FLOW_LABEL = "この画面の処理";

export interface DesignGraph {
  nodes: Map<string, DesignNode>;
  edges: DesignEdge[];
  /** to → その to に頼っている辺 */
  dependents: Map<string, DesignEdge[]>;
  /** from → その from が頼っている辺 */
  dependencies: Map<string, DesignEdge[]>;
}

const flowIdOf = (f: { meta: { id: string } }) => f.meta.id;

export function buildDesignGraph(input: DesignDocInput): DesignGraph {
  const nodes = new Map<string, DesignNode>();
  const addNode = (kind: NodeKind, id: string, name: string) => { nodes.set(nodeKey(kind, id), { key: nodeKey(kind, id), kind, id, name }); };
  for (const s of input.screens) addNode("screen", s.id, s.name ?? s.id);
  for (const f of input.flows) addNode("processFlow", flowIdOf(f), f.meta.name ?? flowIdOf(f));
  for (const t of input.tables) addNode("table", t.id, t.name ?? t.physicalName ?? t.id);
  for (const b of input.businessFlows ?? []) addNode("businessFlow", b.id, b.name);
  for (const r of input.reports ?? []) addNode("report", r.id, r.name);
  for (const c of input.layoutComponents ?? []) addNode("component", c.id, c.label ?? c.id);
  for (const k of Object.keys(input.messages ?? {})) addNode("message", k, k);
  for (const k of Object.keys(input.regex ?? {})) addNode("regex", k, k);
  for (const k of Object.keys(input.limits ?? {})) addNode("limit", k, k);
  for (const g of input.genericDefinitions ?? []) addNode("genericDefinition", `${g.kind}/${g.name}`, `${g.name} (${g.kind})`);

  const edges: DesignEdge[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string, label: string, column?: string, columns?: string[]) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const k = `${from}\u0000${to}\u0000${label}\u0000${column ?? ""}\u0000${(columns ?? []).join(",")}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ from, to, label, ...(column ? { column } : {}), ...(columns?.length ? { columns } : {}) });
  };
  const tableNameOf = (id: string) => nodes.get(nodeKey("table", id))?.name ?? id;

  // 画面
  for (const s of input.screens) {
    const me = nodeKey("screen", s.id);
    for (const it of s.items ?? []) {
      const ref = bindingColumnRef(it);
      if (ref) link(me, nodeKey("table", ref.tableId), `画面項目「${it.label ?? it.id}」が ${tableNameOf(ref.tableId)} の列に結び付いている`, ref.columnId);
      for (const e of it.events ?? []) if (e.handlerFlowId) link(me, nodeKey("processFlow", e.handlerFlowId), `画面項目「${it.label ?? it.id}」のイベントから呼ぶ`);
    }
    walkLayout(s.layout?.nodes ?? [], (n) => { if (n.type === "component" && n.componentRef) link(me, nodeKey("component", n.componentRef), "独自部品を置いている"); });
  }
  for (const t of input.transitions ?? []) link(nodeKey("screen", t.sourceScreenId), nodeKey("screen", t.targetScreenId), `画面遷移${t.label ? `「${t.label}」` : ""}`);

  // 処理フロー
  const publishers = new Map<string, string[]>();
  const subscribers: Array<{ flow: string; topic: string }> = [];
  for (const f of input.flows) {
    const me = nodeKey("processFlow", flowIdOf(f));
    if (f.meta.screenId) link(me, nodeKey("screen", f.meta.screenId), OWN_FLOW_LABEL);
    const visit = (st: FlowStep) => {
      const x = st as Record<string, unknown>;
      if (st.kind === "dbAccess" && typeof x.tableId === "string") link(me, nodeKey("table", x.tableId), `${String(x.operation ?? "アクセス")} で使う`);
      else if (st.kind === "screenTransition" && typeof x.targetScreenId === "string") link(me, nodeKey("screen", x.targetScreenId), "画面遷移する");
      else if (st.kind === "commonProcess" && typeof x.refId === "string") link(me, nodeKey("processFlow", x.refId), "共通処理として呼ぶ");
      const topic = String(x.topic ?? "");
      if (st.kind === "eventPublish" && topic) (publishers.get(topic) ?? publishers.set(topic, []).get(topic)!).push(me);
      if (st.kind === "eventSubscribe" && topic) subscribers.push({ flow: me, topic });
    };
    for (const a of f.actions) forEachStep(a.steps, visit);
  }
  for (const sub of subscribers) for (const pub of publishers.get(sub.topic) ?? []) link(sub.flow, pub, `イベント「${sub.topic}」を購読する`);

  // テーブル (外部キー)
  for (const t of input.tables) {
    for (const c of t.constraints ?? []) {
      if (c.kind === "foreignKey" && c.referencedTableId) link(nodeKey("table", t.id), nodeKey("table", c.referencedTableId), "外部キーで参照している", undefined, c.referencedColumnIds);
    }
  }

  // 業務フロー・帳票
  for (const b of input.businessFlows ?? []) {
    const me = nodeKey("businessFlow", b.id);
    for (const st of b.steps) {
      if (st.screenRef) link(me, nodeKey("screen", st.screenRef), `工程「${st.name}」の画面`);
      if (st.processFlowRef) link(me, nodeKey("processFlow", st.processFlowRef), `工程「${st.name}」の処理`);
    }
  }
  for (const r of input.reports ?? []) {
    const me = nodeKey("report", r.id);
    if (r.trigger?.screenRef) link(me, nodeKey("screen", r.trigger.screenRef), "出力の契機の画面");
    if (r.trigger?.processFlowRef) link(me, nodeKey("processFlow", r.trigger.processFlowRef), "出力の契機の処理");
    for (const sec of r.sections) for (const fld of sec.fields) {
      if (!fld.source) continue;
      const p = parseSource(fld.source);
      if (p.kind === "column") link(me, nodeKey("table", p.table), `項目「${fld.label || fld.id}」の出どころ`, p.column);
    }
  }

  // 文字列の参照 (@conv.* / generic-definitions/*)
  const scan = (from: string, value: unknown) => {
    const text = jsonText(value);
    if (!text.includes("@conv.") && !text.includes("generic-definitions/")) return;
    for (const k of convRefs(text, "msg")) link(from, nodeKey("message", k), "メッセージを使っている");
    for (const k of convRefs(text, "regex")) link(from, nodeKey("regex", k), "正規表現を使っている");
    for (const k of convRefs(text, "limit")) link(from, nodeKey("limit", k), "上限値を使っている");
    for (const k of genericDefinitionRefs(text)) link(from, nodeKey("genericDefinition", k), "汎用定義を参照している");
  };
  for (const s of input.screens) scan(nodeKey("screen", s.id), s);
  for (const f of input.flows) scan(nodeKey("processFlow", flowIdOf(f)), f);
  for (const t of input.tables) scan(nodeKey("table", t.id), t);
  for (const b of input.businessFlows ?? []) scan(nodeKey("businessFlow", b.id), b);
  for (const r of input.reports ?? []) scan(nodeKey("report", r.id), r);
  for (const c of input.layoutComponents ?? []) scan(nodeKey("component", c.id), c);
  for (const g of input.genericDefinitions ?? []) scan(nodeKey("genericDefinition", `${g.kind}/${g.name}`), g);

  const dependents = new Map<string, DesignEdge[]>();
  const dependencies = new Map<string, DesignEdge[]>();
  for (const e of edges) {
    (dependents.get(e.to) ?? dependents.set(e.to, []).get(e.to)!).push(e);
    (dependencies.get(e.from) ?? dependencies.set(e.from, []).get(e.from)!).push(e);
  }
  return { nodes, edges, dependents, dependencies };
}
