/**
 * 図の書き出し (Mermaid / PlantUML)。ER 図・画面遷移図・処理フロー図・業務フロー図の、テキストの図を作る。
 * 他のドキュメント (Markdown・Wiki・設計書) へそのまま貼れる。SVG は、処理フロー・業務フローのものを設計書と同じ描画で出せる (diagramToSvg / businessFlowToSvg)。
 * 計算は設計の原本 (DesignDocInput) だけから。画面の配置 (座標) は使わない。
 */
import type { BusinessFlow } from "./businessFlow.js";
import type { DesignDocInput, DocFlow, DocTable } from "./designDocument.js";
import { kindLabel, stepText, branchConditionText, layoutFlow, type FlowStep } from "./flowStructure.js";
import { businessFlowToSvg } from "./businessFlow.js";
import { DESIGN_DOC_CSS, diagramToSvg } from "./designDocument.js";

export type DiagramFormat = "mermaid" | "plantuml";
export type DiagramKind = "er" | "screenFlow" | "processFlow" | "businessFlow";
export const DIAGRAM_KIND_LABELS: Record<DiagramKind, string> = { er: "ER 図", screenFlow: "画面遷移図", processFlow: "処理フロー図", businessFlow: "業務フロー図" };
export const DIAGRAM_FORMAT_LABELS: Record<DiagramFormat, string> = { mermaid: "Mermaid", plantuml: "PlantUML" };

// ── 中間の表現 (ノードと矢印。ER 以外) ────────────────────────────────────────

type Shape = "rect" | "decision" | "terminal";
interface GNode { id: string; label: string; shape: Shape }
interface GEdge { from: string; to: string; label?: string; dashed?: boolean }
interface GGroup { id: string; label: string; nodeIds: string[] }
interface Graph { direction: "TD" | "LR"; nodes: GNode[]; edges: GEdge[]; groups: GGroup[] }

const clean = (s: unknown, max = 60): string => {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().replace(/"/g, "'").replace(/\|/g, "｜"); // 引用符と縦線は、図の記法を壊すので置き換える
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const ident = (s: string): string => {
  const t = s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  return t || "_";
};

function graphToMermaid(g: Graph): string {
  const lines = [`flowchart ${g.direction}`];
  const grouped = new Set(g.groups.flatMap((x) => x.nodeIds));
  const node = (n: GNode) => {
    const l = n.label;
    return n.shape === "decision" ? `${n.id}{"${l}"}` : n.shape === "terminal" ? `${n.id}(["${l}"])` : `${n.id}["${l}"]`;
  };
  for (const n of g.nodes) if (!grouped.has(n.id)) lines.push(`  ${node(n)}`);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const grp of g.groups) {
    lines.push(`  subgraph ${grp.id}["${grp.label}"]`);
    for (const id of grp.nodeIds) { const n = byId.get(id); if (n) lines.push(`    ${node(n)}`); }
    lines.push("  end");
  }
  for (const e of g.edges) lines.push(`  ${e.from} ${e.dashed ? "-.->" : "-->"}${e.label ? `|"${e.label}"|` : ""} ${e.to}`);
  if (g.nodes.length === 0) lines.push('  empty["(なし)"]');
  return lines.join("\n");
}

function graphToPlantUml(g: Graph): string {
  const lines = ["@startuml", `${g.direction === "LR" ? "left to right direction" : "top to bottom direction"}`, "skinparam shadowing false"];
  const decl = (n: GNode, indent: string) => `${indent}${n.shape === "decision" ? "hexagon" : n.shape === "terminal" ? "queue" : "rectangle"} "${n.label.replace(/<br\/>/g, "\\n")}" as ${n.id}`;
  const grouped = new Set(g.groups.flatMap((x) => x.nodeIds));
  for (const n of g.nodes) if (!grouped.has(n.id)) lines.push(decl(n, ""));
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const grp of g.groups) {
    lines.push(`package "${grp.label}" {`);
    for (const id of grp.nodeIds) { const n = byId.get(id); if (n) lines.push(decl(n, "  ")); }
    lines.push("}");
  }
  for (const e of g.edges) lines.push(`${e.from} ${e.dashed ? "..>" : "-->"} ${e.to}${e.label ? ` : ${e.label}` : ""}`);
  lines.push("@enduml");
  return lines.join("\n");
}

const render = (g: Graph, f: DiagramFormat): string => (f === "mermaid" ? graphToMermaid(g) : graphToPlantUml(g));

// ── 画面遷移図 ────────────────────────────────────────────────────────────────

export function screenFlowGraph(input: Pick<DesignDocInput, "screens" | "transitions">): Graph {
  const ids = new Map<string, string>();
  const nodes: GNode[] = input.screens.filter((s) => s.purpose !== "gadget").map((s, i) => {
    const id = `s${i + 1}`;
    ids.set(s.id, id);
    return { id, label: s.path ? `${clean(s.name ?? s.id)}<br/>${clean(s.path, 40)}` : clean(s.name ?? s.id), shape: "rect" as const };
  });
  const edges: GEdge[] = [];
  for (const t of input.transitions ?? []) {
    const a = ids.get(t.sourceScreenId), b = ids.get(t.targetScreenId);
    if (a && b) edges.push({ from: a, to: b, ...(t.label || t.trigger ? { label: clean(t.label ?? t.trigger, 30) } : {}) });
  }
  return { direction: "LR", nodes, edges, groups: [] };
}

// ── 業務フロー図 ──────────────────────────────────────────────────────────────

export function businessFlowGraph(flow: Pick<BusinessFlow, "lanes" | "steps">): Graph {
  const ids = new Map(flow.steps.map((s, i) => [s.id, `b${i + 1}`]));
  const nodes: GNode[] = flow.steps.map((s) => ({ id: ids.get(s.id)!, label: clean(s.name || s.id), shape: s.kind === "decision" ? "decision" : s.kind === "start" || s.kind === "end" ? "terminal" : "rect" }));
  const edges: GEdge[] = [];
  for (const s of flow.steps) for (const n of s.next ?? []) { const to = ids.get(n.to); if (to) edges.push({ from: ids.get(s.id)!, to, ...(n.label ? { label: clean(n.label, 30) } : {}) }); }
  const groups: GGroup[] = flow.lanes.map((l, i) => ({ id: `lane${i + 1}`, label: clean(l.name || l.id), nodeIds: flow.steps.filter((s) => s.lane === l.id).map((s) => ids.get(s.id)!) })).filter((g) => g.nodeIds.length);
  return { direction: "TD", nodes, edges, groups };
}

// ── 処理フロー図 ──────────────────────────────────────────────────────────────

/** 1 つの処理 (action) の、工程の流れ。分岐は判断の菱形と、条件ごとの矢印。繰り返しは本体のあとに戻る矢印 */
export function processFlowGraph(actions: DocFlow["actions"], opts: { tableName?: (id: string) => string | undefined; screenName?: (id: string) => string | undefined } = {}): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  let seq = 0;
  const mk = (label: string, shape: Shape): string => { const id = `p${++seq}`; nodes.push({ id, label: clean(label), shape }); return id; };
  /** 入口 (どこから入るか: [前のノード, 矢印の文字]) を受けて、出口 (次へつなぐ [ノード, 文字]) を返す。return で終わる経路は出口なし */
  type Port = [string, string | undefined];
  const link = (from: Port[], to: string) => { for (const [f, l] of from) edges.push({ from: f, to, ...(l ? { label: l } : {}) }); };
  const walk = (steps: readonly FlowStep[], entry: Port[]): Port[] => {
    let cur = entry;
    for (const step of steps) {
      const s = step as FlowStep & Record<string, unknown>;
      if (s.kind === "branch") {
        const d = mk(stepText(step), "decision");
        link(cur, d);
        const out: Port[] = [];
        for (const b of (s.branches as Array<{ code: string; label?: string; condition: unknown; steps: FlowStep[] }> | undefined) ?? []) {
          out.push(...walk(b.steps ?? [], [[d, clean(`${b.code}: ${b.label ?? branchConditionText(b.condition) ?? ""}`, 24)]]));
        }
        const e = s.elseBranch as { code: string; label?: string; steps: FlowStep[] } | undefined;
        out.push(...walk(e?.steps ?? [], [[d, clean(e ? `${e.code}: ${e.label ?? "上記以外"}` : "上記以外", 24)]]));
        cur = out;
      } else if (s.kind === "loop") {
        const head = mk(`繰り返し: ${stepText(step)}`, "decision");
        link(cur, head);
        const bodyOut = walk((s.steps as FlowStep[]) ?? [], [[head, "繰り返す"]]);
        for (const [f] of bodyOut) edges.push({ from: f, to: head, dashed: true });
        cur = [[head, "終わり"]];
      } else if (s.kind === "transactionScope") {
        const start = mk(`トランザクション開始`, "rect");
        link(cur, start);
        const inner = walk((s.steps as FlowStep[]) ?? [], [[start, undefined]]);
        const end = mk("コミット", "rect");
        link(inner, end);
        cur = [[end, undefined]];
      } else if (s.kind === "return") {
        const t = mk(`${kindLabel(step)}: ${stepText(step)}`, "terminal");
        link(cur, t);
        cur = [];
      } else {
        const label = `${kindLabel(step)}: ${stepText(step)}`;
        const n = mk(label, "rect");
        link(cur, n);
        cur = [[n, undefined]];
      }
      // 配下の工程 (subSteps) は、本体の流れには含めない (処理記述表と同じ扱い)
    }
    return cur;
  };
  for (const a of actions) {
    const start = mk(a.name ?? "処理", "terminal");
    walk(a.steps ?? [], [[start, undefined]]);
  }
  void opts;
  return { direction: "TD", nodes, edges, groups: [] };
}

// ── ER 図 ─────────────────────────────────────────────────────────────────────

const typeWord = (t: string | undefined): string => (t ?? "").replace(/\(.*$/, "").replace(/[^A-Za-z0-9_]/g, "") || "string";

interface ErRel { parent: string; child: string; label: string }
function erRelations(tables: readonly DocTable[]): ErRel[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const rels: ErRel[] = [];
  for (const t of tables) {
    for (const c of t.constraints ?? []) {
      if (c.kind !== "foreignKey" || !c.referencedTableId || c.noConstraint || !byId.has(c.referencedTableId)) continue;
      const cols = (c.columnIds ?? []).map((id) => (t.columns ?? []).find((x) => x.id === id)?.physicalName ?? id).join(", ");
      rels.push({ parent: c.referencedTableId, child: t.id, label: cols || "FK" });
    }
  }
  return rels;
}
const tableIdent = (t: DocTable): string => ident(t.physicalName ?? t.id);

export function erToMermaid(tables: readonly DocTable[]): string {
  const lines = ["erDiagram"];
  const used = new Map<string, string>();
  const nameOf = (t: DocTable): string => {
    let n = tableIdent(t);
    if (used.has(n) && used.get(n) !== t.id) n = `${n}_${used.size}`;
    used.set(n, t.id);
    return n;
  };
  const names = new Map(tables.map((t) => [t.id, nameOf(t)]));
  const fkCols = new Set<string>();
  for (const t of tables) for (const c of t.constraints ?? []) if (c.kind === "foreignKey" && !c.noConstraint) for (const id of c.columnIds ?? []) fkCols.add(`${t.id}:${id}`);
  for (const t of tables) {
    lines.push(`  ${names.get(t.id)} {`);
    for (const c of t.columns ?? []) {
      const keys = [c.primaryKey ? "PK" : "", fkCols.has(`${t.id}:${c.id}`) ? "FK" : "", c.unique && !c.primaryKey ? "UK" : ""].filter(Boolean).join(",");
      const comment = clean(c.name ?? c.comment ?? "", 40);
      lines.push(`    ${typeWord(c.dataType)} ${ident(c.physicalName)}${keys ? ` ${keys}` : ""}${comment ? ` "${comment}"` : ""}`);
    }
    lines.push("  }");
  }
  for (const r of erRelations(tables)) lines.push(`  ${names.get(r.parent)} ||--o{ ${names.get(r.child)} : "${clean(r.label, 40)}"`);
  return lines.join("\n");
}

export function erToPlantUml(tables: readonly DocTable[]): string {
  const lines = ["@startuml", "hide circle", "skinparam linetype ortho"];
  const names = new Map(tables.map((t) => [t.id, tableIdent(t)]));
  const fkCols = new Set<string>();
  for (const t of tables) for (const c of t.constraints ?? []) if (c.kind === "foreignKey" && !c.noConstraint) for (const id of c.columnIds ?? []) fkCols.add(`${t.id}:${id}`);
  for (const t of tables) {
    lines.push(`entity "${clean(t.physicalName ?? t.id, 40)}${t.name ? `\\n(${clean(t.name, 30)})` : ""}" as ${names.get(t.id)} {`);
    const cols = t.columns ?? [];
    for (const c of cols.filter((x) => x.primaryKey)) lines.push(`  * ${ident(c.physicalName)} : ${clean(c.dataType ?? "", 30)} <<PK>>`);
    if (cols.some((x) => x.primaryKey) && cols.some((x) => !x.primaryKey)) lines.push("  --");
    for (const c of cols.filter((x) => !x.primaryKey)) lines.push(`  ${c.notNull ? "* " : ""}${ident(c.physicalName)} : ${clean(c.dataType ?? "", 30)}${fkCols.has(`${t.id}:${c.id}`) ? " <<FK>>" : ""}`);
    lines.push("}");
  }
  for (const r of erRelations(tables)) lines.push(`${names.get(r.parent)} ||--o{ ${names.get(r.child)} : ${clean(r.label, 40)}`);
  lines.push("@enduml");
  return lines.join("\n");
}

// ── まとめて ──────────────────────────────────────────────────────────────────

export interface DiagramTarget { kind: DiagramKind; /** processFlow / businessFlow のとき、その id。er / screenFlow は不要 */ id?: string }

/** 図の対象の候補 (画面で選ばせる) */
export function diagramTargets(input: Pick<DesignDocInput, "flows" | "businessFlows" | "tables" | "screens">): Array<DiagramTarget & { label: string }> {
  return [
    { kind: "er", label: `ER 図 (全テーブル ${input.tables.length} 件)` },
    { kind: "screenFlow", label: "画面遷移図 (全画面)" },
    ...input.flows.map((f) => ({ kind: "processFlow" as const, id: f.meta.id, label: `処理フロー図: ${f.meta.name ?? f.meta.id}` })),
    ...(input.businessFlows ?? []).map((b) => ({ kind: "businessFlow" as const, id: b.id, label: `業務フロー図: ${b.name ?? b.id}` })),
  ];
}

/** 図のテキスト。対象が見つからなければ null */
export function buildDiagramText(input: DesignDocInput, target: DiagramTarget, format: DiagramFormat): string | null {
  switch (target.kind) {
    case "er": return format === "mermaid" ? erToMermaid(input.tables) : erToPlantUml(input.tables);
    case "screenFlow": return render(screenFlowGraph(input), format);
    case "processFlow": {
      const flow = input.flows.find((f) => f.meta.id === target.id);
      return flow ? render(processFlowGraph(flow.actions), format) : null;
    }
    case "businessFlow": {
      const bf = (input.businessFlows ?? []).find((b) => b.id === target.id);
      return bf ? render(businessFlowGraph(bf), format) : null;
    }
  }
}

/** ファイル名に使う英数字の部分 */
export function diagramFileStem(target: DiagramTarget): string {
  return [target.kind, target.id].filter(Boolean).join("-").replace(/[^A-Za-z0-9_-]+/g, "") || "diagram";
}

// ── SVG (処理フロー・業務フロー。設計書と同じ描画) ─────────────────────────────

/** SVG 単体のファイルに入れる CSS: 設計書の CSS から、図 (fd-* / bf-*) の規則と、その色の変数だけを取り出す */
export function diagramSvgCss(): string {
  const vars = "svg{--d-ink:#1d2433;--d-muted:#5d677a;--d-line:#d3d9e2;--d-fill:#f3f5f8;--d-accent:#2c56c9;--d-err:#c23b3b;--d-ok:#24804f;font-family:\"BIZ UDPGothic\",\"Hiragino Sans\",\"Yu Gothic UI\",Meiryo,sans-serif}";
  const rules = DESIGN_DOC_CSS.split("\n").filter((l) => /^\.(fd|bf)-/.test(l) && !l.includes("@media"));
  return [vars, ...rules].join("\n");
}

/** 単体で開ける SVG ファイルにする (名前空間・背景・CSS を足す)。すでに xmlns があればそのまま */
export function standaloneSvg(svg: string): string {
  const withNs = /xmlns=/.test(svg) ? svg : svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const withBg = withNs.replace(/(<svg [^>]*>)/, `$1<style>${diagramSvgCss().replace(/<\//g, "<\\/")}</style><rect width="100%" height="100%" fill="#ffffff"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${withBg}`;
}

/** 処理フローの action 1 つの図 (SVG)。見つからなければ null */
export function processFlowSvg(input: DesignDocInput, flowId: string, actionIndex = 0): string | null {
  const flow = input.flows.find((f) => f.meta.id === flowId);
  const action = flow?.actions[actionIndex];
  if (!flow || !action) return null;
  const name = new Map(input.tables.map((t) => [t.id, t.name ?? t.physicalName ?? t.id]));
  const scr = new Map(input.screens.map((x) => [x.id, x.name ?? x.id]));
  return standaloneSvg(diagramToSvg(layoutFlow(action, { tableName: (id) => name.get(id), screenName: (id) => scr.get(id) }), `${flow.meta.name ?? flow.meta.id} / ${action.name ?? ""}`));
}

export function businessFlowSvg(input: DesignDocInput, flowId: string): string | null {
  const bf = (input.businessFlows ?? []).find((b) => b.id === flowId);
  return bf ? standaloneSvg(businessFlowToSvg(bf, { showRefs: true })) : null;
}
