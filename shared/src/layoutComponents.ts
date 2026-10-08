/**
 * プロジェクト独自部品 (layout components) の型と純関数。
 *
 * 独自部品 = 部品の木の断片に名前と「差し込み口 (params)」を付けて登録したもの。
 * 画面には `type: "component"` の参照部品 (componentRef + args) として置き、
 * 描画・検証・設計書出力のときに定義を展開して通常の部品の木にする。
 *
 * 仕様: docs/spec/layout-components.md
 */
import {
  canContain, nextNodeId, validateLayout, walkLayout, LAYOUT_NODE_LABELS,
  type LayoutItemLike, type LayoutIssue, type LayoutNode, type LayoutNodeProps, type ScreenLayout,
} from "./screenLayout.js";

export type LayoutComponentParamKind = "text" | "item" | "screen";

export interface LayoutComponentParam {
  /** 差し込み口 ID (lowerCamelCase)。テンプレート内では `{{id}}` で参照する */
  id: string;
  label: string;
  kind: LayoutComponentParamKind;
  /** 既定値 (text: 文言 / screen: 画面 id / item: 画面項目 id)。args が無いとき使う */
  default?: string;
  description?: string;
}

export interface LayoutComponentDef {
  /** プロジェクト内で一意な ID (kebab-case) */
  id: string;
  label: string;
  description?: string;
  /** パレット上の分類名 */
  category?: string;
  params: LayoutComponentParam[];
  /** テンプレートの部品の木。文字列値と itemRef に `{{paramId}}` を書ける */
  nodes: LayoutNode[];
}

export interface LayoutComponentsFile {
  version: 1;
  components: LayoutComponentDef[];
}

/** 展開後の部品。via は展開元の参照部品 (画面上の部品 ID)。 */
export type ExpandedNode = Omit<LayoutNode, "children"> & { via?: string; children?: ExpandedNode[] };

export const MAX_COMPONENT_DEPTH = 5;

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const STRING_PROPS: ReadonlyArray<keyof LayoutNodeProps> = ["title", "text", "label", "screenRef", "html", "src", "alt"];

export function emptyComponentsFile(): LayoutComponentsFile {
  return { version: 1, components: [] };
}

export function findComponent(defs: readonly LayoutComponentDef[], id: string | undefined): LayoutComponentDef | undefined {
  return id ? defs.find((d) => d.id === id) : undefined;
}

// ── 展開 ───────────────────────────────────────────────────────────────────

export interface ExpandIssue {
  code: "unknown-component" | "component-cycle" | "component-depth" | "missing-arg";
  nodeId: string;
  message: string;
}

function resolveArg(def: LayoutComponentDef, args: Record<string, string> | undefined, paramId: string): string | undefined {
  const given = args?.[paramId];
  if (given !== undefined && given !== "") return given;
  return def.params.find((p) => p.id === paramId)?.default;
}

function substitute(str: string, def: LayoutComponentDef, args: Record<string, string> | undefined): string {
  return str.replace(PLACEHOLDER, (_m, id: string) => resolveArg(def, args, id) ?? "");
}

/** テンプレートの部品 1 つに args を差し込み、ID に参照部品の ID を前置する */
function instantiate(n: LayoutNode, def: LayoutComponentDef, args: Record<string, string> | undefined, instanceId: string, via: string): ExpandedNode {
  const out: ExpandedNode = { ...n, id: `${instanceId}__${n.id}`, via };
  if (n.itemRef !== undefined) {
    const v = substitute(n.itemRef, def, args);
    if (v) out.itemRef = v; else delete out.itemRef;
  }
  if (n.props) {
    const props: Record<string, unknown> = { ...n.props };
    for (const key of STRING_PROPS) {
      const cur = props[key];
      if (typeof cur === "string") props[key] = substitute(cur, def, args);
    }
    out.props = props as LayoutNodeProps;
  }
  // 入れ子の独自部品に渡す値にも、外側の差し込み口を差し込む
  if (n.args) out.args = Object.fromEntries(Object.entries(n.args).map(([k, v]) => [k, substitute(v, def, args)]));
  if (n.children) out.children = n.children.map((c) => instantiate(c, def, args, instanceId, via));
  return out;
}

/**
 * 参照部品 1 つを展開する。入れ子の独自部品も展開する。
 * 見つからない定義・循環・深すぎる入れ子は展開せず issues に積む。
 */
export function expandComponentNode(
  node: LayoutNode,
  defs: readonly LayoutComponentDef[],
  stack: readonly string[] = [],
  issues: ExpandIssue[] = [],
  via?: string,
): { nodes: ExpandedNode[]; issues: ExpandIssue[] } {
  const owner = via ?? node.id;
  const def = findComponent(defs, node.componentRef);
  if (!def) {
    issues.push({ code: "unknown-component", nodeId: owner, message: `独自部品「${node.componentRef ?? ""}」の定義が見つかりません (部品「${owner}」)` });
    return { nodes: [], issues };
  }
  if (stack.includes(def.id)) {
    issues.push({ code: "component-cycle", nodeId: owner, message: `独自部品「${def.id}」が自分自身を含んでいます (${[...stack, def.id].join(" → ")})` });
    return { nodes: [], issues };
  }
  if (stack.length >= MAX_COMPONENT_DEPTH) {
    issues.push({ code: "component-depth", nodeId: owner, message: `独自部品の入れ子が ${MAX_COMPONENT_DEPTH} 段を超えています (部品「${owner}」)` });
    return { nodes: [], issues };
  }
  for (const p of def.params) {
    if (p.kind !== "text" && resolveArg(def, node.args, p.id) === undefined) {
      issues.push({ code: "missing-arg", nodeId: owner, message: `独自部品「${def.label}」の差し込み口「${p.label}」が未設定です (部品「${owner}」)` });
    }
  }
  const instanced = def.nodes.map((n) => instantiate(n, def, node.args, node.id, owner));
  return { nodes: expandNodes(instanced, defs, [...stack, def.id], issues, owner), issues };
}

function expandNodes(nodes: readonly ExpandedNode[], defs: readonly LayoutComponentDef[], stack: readonly string[], issues: ExpandIssue[], via?: string): ExpandedNode[] {
  const out: ExpandedNode[] = [];
  for (const n of nodes) {
    if (n.type === "component") {
      out.push(...expandComponentNode(n as LayoutNode, defs, stack, issues, via ?? n.id).nodes);
      continue;
    }
    out.push(n.children ? { ...n, children: expandNodes(n.children, defs, stack, issues, via) } : n);
  }
  return out;
}

/** 画面の部品の木を、独自部品をすべて展開した木にする (元の木は変更しない) */
export function expandLayout(nodes: readonly LayoutNode[], defs: readonly LayoutComponentDef[]): { nodes: ExpandedNode[]; issues: ExpandIssue[] } {
  const issues: ExpandIssue[] = [];
  return { nodes: expandNodes(nodes, defs, [], issues), issues };
}

/** 展開後の木が参照する画面項目 id の集合 (独自部品の中の itemRef を含む) */
export function collectExpandedItemRefs(nodes: readonly LayoutNode[], defs: readonly LayoutComponentDef[]): Set<string> {
  const refs = new Set<string>();
  walkLayout(expandLayout(nodes, defs).nodes as LayoutNode[], (n) => { if (n.itemRef) refs.add(n.itemRef); });
  return refs;
}

/** 差し込み口の ID を変える。定義の中の `{{旧}}` も新しい ID に書き換える (args のキーは呼び出し側が扱う) */
export function renameComponentParam(def: LayoutComponentDef, oldId: string, newId: string): LayoutComponentDef {
  const re = new RegExp(`\\{\\{\\s*${oldId}\\s*\\}\\}`, "g");
  const sub = (v: string) => v.replace(re, `{{${newId}}}`);
  const mapNode = (n: LayoutNode): LayoutNode => {
    const out: LayoutNode = { ...n };
    if (n.itemRef) out.itemRef = sub(n.itemRef);
    if (n.props) {
      const props: Record<string, unknown> = { ...n.props };
      for (const key of STRING_PROPS) if (typeof props[key] === "string") props[key] = sub(props[key] as string);
      out.props = props as LayoutNodeProps;
    }
    if (n.args) out.args = Object.fromEntries(Object.entries(n.args).map(([k, v]) => [k, sub(v)]));
    if (n.children) out.children = n.children.map(mapNode);
    return out;
  };
  return { ...def, params: def.params.map((q) => (q.id === oldId ? { ...q, id: newId } : q)), nodes: def.nodes.map(mapNode) };
}

// ── 登録 (画面の部品 → 独自部品) ─────────────────────────────────────────────

export interface ParamCandidate {
  kind: LayoutComponentParamKind;
  /** item: 参照している画面項目 id / text,screen: 部品 id + 属性 */
  itemRef?: string;
  nodeId?: string;
  prop?: keyof LayoutNodeProps;
  label: string;
  /** 現在の値 (既定値になる) */
  value: string;
  /** 初期状態で差し込み口にするか (画面項目は既定で true、文言は false) */
  suggested: boolean;
}

const TEXT_PROPS: ReadonlyArray<keyof LayoutNodeProps> = ["title", "text", "label"];
const PROP_LABELS: Record<string, string> = { title: "表題", text: "本文", label: "表示文言" };

/** 登録しようとする部品の木から、差し込み口にできる箇所を洗い出す */
export function suggestParams(nodes: readonly LayoutNode[], items: readonly LayoutItemLike[]): ParamCandidate[] {
  const out: ParamCandidate[] = [];
  const seenItems = new Set<string>();
  walkLayout(nodes, (n) => {
    if (n.itemRef && !seenItems.has(n.itemRef)) {
      seenItems.add(n.itemRef);
      const item = items.find((i) => i.id === n.itemRef);
      out.push({ kind: "item", itemRef: n.itemRef, label: item?.label || n.itemRef, value: n.itemRef, suggested: true });
    }
    for (const prop of TEXT_PROPS) {
      const v = n.props?.[prop];
      if (typeof v === "string" && v.trim()) {
        out.push({ kind: "text", nodeId: n.id, prop, label: `${PROP_LABELS[prop]}: ${v.length > 14 ? `${v.slice(0, 14)}…` : v}`, value: v, suggested: false });
      }
    }
    const sr = n.props?.screenRef;
    if (sr) out.push({ kind: "screen", nodeId: n.id, prop: "screenRef", label: `遷移先画面: ${sr}`, value: sr, suggested: false });
  });
  return out;
}

export interface BuildComponentInput {
  id: string;
  label: string;
  description?: string;
  category?: string;
  nodes: readonly LayoutNode[];
  /** 差し込み口にする候補とその ID / 表示名 */
  params: Array<{ candidate: ParamCandidate; paramId: string; label: string }>;
}

/** 部品の木と差し込み口の選択から、定義と、置き換え用の参照部品の args を作る */
export function buildComponentDef(input: BuildComponentInput): { def: LayoutComponentDef; args: Record<string, string> } {
  const params: LayoutComponentParam[] = [];
  const args: Record<string, string> = {};
  const itemParam = new Map<string, string>();
  const propParam = new Map<string, string>();
  for (const { candidate: c, paramId, label } of input.params) {
    params.push({ id: paramId, label, kind: c.kind, default: c.kind === "item" ? undefined : c.value });
    args[paramId] = c.value;
    if (c.kind === "item" && c.itemRef) itemParam.set(c.itemRef, paramId);
    if (c.kind !== "item" && c.nodeId && c.prop) propParam.set(`${c.nodeId}\u0000${c.prop}`, paramId);
  }
  const template = (n: LayoutNode): LayoutNode => {
    const out: LayoutNode = { ...n };
    if (n.itemRef && itemParam.has(n.itemRef)) out.itemRef = `{{${itemParam.get(n.itemRef)}}}`;
    if (n.props) {
      const props: Record<string, unknown> = { ...n.props };
      for (const key of [...TEXT_PROPS, "screenRef" as const]) {
        const pid = propParam.get(`${n.id}\u0000${key}`);
        if (pid) props[key] = `{{${pid}}}`;
      }
      out.props = props as LayoutNodeProps;
    }
    if (n.children) out.children = n.children.map(template);
    return out;
  };
  const def: LayoutComponentDef = {
    id: input.id, label: input.label, params, nodes: input.nodes.map(template),
    ...(input.description ? { description: input.description } : {}),
    ...(input.category ? { category: input.category } : {}),
  };
  return { def, args };
}

/** 画面に置く参照部品を作る (ID は画面内で重ならないように振る) */
export function createComponentNode(def: LayoutComponentDef, screenNodes: readonly LayoutNode[], args?: Record<string, string>): LayoutNode {
  const initial: Record<string, string> = {};
  for (const p of def.params) {
    const v = args?.[p.id] ?? p.default;
    if (v !== undefined) initial[p.id] = v;
  }
  return {
    id: nextNodeId(screenNodes, def.id), type: "component", componentRef: def.id,
    ...(Object.keys(initial).length ? { args: initial } : {}),
  };
}

/** 参照部品を展開した通常の部品に置き換える (定義とのつながりを切る)。ID は画面内で重ならないよう振り直す */
export function detachComponentNode(node: LayoutNode, defs: readonly LayoutComponentDef[], screenNodes: readonly LayoutNode[]): LayoutNode[] {
  const { nodes } = expandComponentNode(node, defs);
  let pool: LayoutNode[] = [...screenNodes];
  const strip = (n: ExpandedNode): LayoutNode => {
    const id = nextNodeId(pool, n.id.slice(n.id.lastIndexOf("__") + 2));
    pool = [...pool, { id, type: n.type }];
    const { via: _via, children, ...rest } = n;
    return { ...rest, id, ...(children ? { children: children.map(strip) } : {}) };
  };
  return nodes.map(strip);
}

// ── 検証 ───────────────────────────────────────────────────────────────────

export interface ComponentDefIssue {
  severity: "error" | "warning";
  code: "duplicate-component" | "bad-component-id" | "duplicate-param" | "undeclared-param" | "unused-param" | "component-cycle" | "invalid-child";
  componentId: string;
  message: string;
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const LOWER_CAMEL = /^[a-z][A-Za-z0-9]*$/;

/** 独自部品の定義の整合を検査する (保存は妨げず警告として返す) */
export function validateComponentDefs(defs: readonly LayoutComponentDef[]): ComponentDefIssue[] {
  const issues: ComponentDefIssue[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) issues.push({ severity: "error", code: "duplicate-component", componentId: d.id, message: `独自部品 ID「${d.id}」が重複しています` });
    seen.add(d.id);
    if (!KEBAB.test(d.id)) issues.push({ severity: "error", code: "bad-component-id", componentId: d.id, message: `独自部品 ID「${d.id}」は小文字英数字とハイフン (kebab-case) にしてください` });
    const declared = new Set<string>();
    for (const p of d.params) {
      if (declared.has(p.id) || !LOWER_CAMEL.test(p.id)) issues.push({ severity: "error", code: "duplicate-param", componentId: d.id, message: `差し込み口 ID「${p.id}」が重複、または lowerCamelCase ではありません (独自部品「${d.id}」)` });
      declared.add(p.id);
    }
    const used = new Set<string>();
    const scan = (s: unknown) => { if (typeof s === "string") for (const m of s.matchAll(PLACEHOLDER)) used.add(m[1]); };
    walkLayout(d.nodes, (n, p) => {
      scan(n.itemRef);
      if (n.props) for (const k of STRING_PROPS) scan(n.props[k]);
      if (n.args) Object.values(n.args).forEach(scan);
      if (!canContain(p?.type ?? null, n.type) && p) {
        issues.push({ severity: "error", code: "invalid-child", componentId: d.id, message: `独自部品「${d.id}」の中で、${n.type} は ${p.type} の中に置けません` });
      }
    });
    for (const u of used) if (!declared.has(u)) issues.push({ severity: "error", code: "undeclared-param", componentId: d.id, message: `独自部品「${d.id}」が未定義の差し込み口「${u}」を使っています` });
    for (const p of declared) if (!used.has(p)) issues.push({ severity: "warning", code: "unused-param", componentId: d.id, message: `独自部品「${d.id}」の差し込み口「${p}」はどこにも使われていません` });
    // 循環 (定義どうしの参照)
    const probe: LayoutNode = { id: "probe", type: "component", componentRef: d.id };
    for (const i of expandComponentNode(probe, defs).issues) {
      if (i.code === "component-cycle") issues.push({ severity: "error", code: "component-cycle", componentId: d.id, message: i.message });
    }
  }
  return issues;
}

/**
 * 独自部品を展開した上で画面レイアウトと画面項目の整合を検査する。
 * 独自部品の中で見つかった問題は、画面上の参照部品 (via) の問題として返す。
 */
export function validateLayoutWithComponents(
  layout: ScreenLayout | undefined,
  items: readonly LayoutItemLike[],
  defs: readonly LayoutComponentDef[],
): LayoutIssue[] {
  if (!layout) return [];
  const issues: LayoutIssue[] = [];
  // 参照部品そのものを置ける場所か (展開後の検査では親が分からなくなるため、展開前に見る)
  walkLayout(layout.nodes, (n, p) => {
    if (n.type === "component" && !canContain(p?.type ?? null, "component")) {
      issues.push({ severity: "error", code: "invalid-child", nodeId: n.id, message: `${LAYOUT_NODE_LABELS.component}は${p ? LAYOUT_NODE_LABELS[p.type] : "画面の最上位"}の中に置けません` });
    }
  });
  const { nodes, issues: expandIssues } = expandLayout(layout.nodes, defs);
  for (const i of expandIssues) {
    issues.push({ severity: i.code === "missing-arg" ? "warning" : "error", code: i.code, nodeId: i.nodeId, message: i.message });
  }
  const via = new Map<string, string>();
  walkLayout(nodes as LayoutNode[], (n) => { const v = (n as ExpandedNode).via; if (v) via.set(n.id, v); });
  for (const i of validateLayout({ version: 1, nodes: nodes as LayoutNode[] }, items)) {
    issues.push(i.nodeId && via.has(i.nodeId) ? { ...i, nodeId: via.get(i.nodeId) } : i);
  }
  return issues;
}
