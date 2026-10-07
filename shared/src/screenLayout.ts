/**
 * 画面レイアウト (業務部品の木) の型と純関数。
 *
 * schemas/v3/screen.v3.schema.json の ScreenLayout / LayoutNode と 1:1 対応する。
 * frontend (業務部品デザイナ) と backend (MCP / 変換処理) の両方から使うため、
 * ここには副作用のない関数だけを置く。すべての更新関数は新しい配列を返す (immutable)。
 *
 * 仕様: docs/spec/screen-layout.md
 */

export type LayoutNodeType =
  | "section" | "form" | "search-panel" | "columns" | "column" | "tabs" | "tab" | "button-bar"
  | "heading" | "text" | "field" | "table" | "button" | "link" | "message-area" | "image" | "divider" | "html";

export interface LayoutNodeProps {
  title?: string;
  text?: string;
  label?: string;
  level?: 1 | 2 | 3;
  columns?: 1 | 2 | 3 | 4;
  span?: number;
  align?: "left" | "center" | "right" | "between";
  variant?: "primary" | "secondary" | "danger" | "link" | "plain" | "card" | "panel";
  tone?: "normal" | "muted" | "note" | "warning";
  collapsible?: boolean;
  screenRef?: string;
  html?: string;
  src?: string;
  alt?: string;
}

export interface LayoutNode {
  id: string;
  type: LayoutNodeType;
  itemRef?: string;
  props?: LayoutNodeProps;
  children?: LayoutNode[];
  note?: string;
}

export interface ScreenLayout {
  version: 1;
  nodes: LayoutNode[];
}

/** 部品種別ごとの日本語名 (UI 表示用) */
export const LAYOUT_NODE_LABELS: Record<LayoutNodeType, string> = {
  section: "区画",
  form: "入力フォーム",
  "search-panel": "検索条件",
  columns: "段組",
  column: "段",
  tabs: "タブ群",
  tab: "タブ",
  "button-bar": "ボタン群",
  heading: "見出し",
  text: "文章",
  field: "項目",
  table: "一覧表",
  button: "ボタン",
  link: "リンク",
  "message-area": "メッセージ領域",
  image: "画像",
  divider: "区切り線",
  html: "自由 HTML",
};

export const LAYOUT_NODE_TYPES = Object.keys(LAYOUT_NODE_LABELS) as LayoutNodeType[];

/** 子を持てる部品 */
export const CONTAINER_TYPES: ReadonlySet<LayoutNodeType> = new Set([
  "section", "form", "search-panel", "columns", "column", "tabs", "tab", "button-bar",
]);

/** 画面項目 (items[]) を参照する部品 */
export const ITEM_BOUND_TYPES: ReadonlySet<LayoutNodeType> = new Set(["field", "table", "button"]);

/** itemRef が必須の部品 */
export const ITEM_REQUIRED_TYPES: ReadonlySet<LayoutNodeType> = new Set(["field", "table"]);

/**
 * parent の直下に child を置けるか。
 * - columns の子は column のみ、tabs の子は tab のみ
 * - column / tab は columns / tabs の直下のみ
 * - button-bar の子は button / link のみ
 * - form / search-panel には field / button / text / divider / html / columns / message-area / table 等を置ける
 * - parent が null (最上位) には column / tab 以外を置ける
 */
export function canContain(parentType: LayoutNodeType | null, childType: LayoutNodeType): boolean {
  if (childType === "column") return parentType === "columns";
  if (childType === "tab") return parentType === "tabs";
  if (parentType === null) return true;
  if (!CONTAINER_TYPES.has(parentType)) return false;
  switch (parentType) {
    case "columns": return false; // column のみ (上で判定済み)
    case "tabs": return false; // tab のみ
    case "button-bar": return childType === "button" || childType === "link";
    case "form":
    case "search-panel":
      return ["field", "button", "text", "divider", "html", "columns", "button-bar", "heading", "message-area", "table", "section"].includes(childType);
    default:
      return true;
  }
}

// ── 走査 ───────────────────────────────────────────────────────────────────

export type LayoutVisitor = (node: LayoutNode, parent: LayoutNode | null, depth: number, index: number) => void;

export function walkLayout(nodes: readonly LayoutNode[], visit: LayoutVisitor, parent: LayoutNode | null = null, depth = 0): void {
  nodes.forEach((n, i) => {
    visit(n, parent, depth, i);
    if (n.children?.length) walkLayout(n.children, visit, n, depth + 1);
  });
}

export function findNode(nodes: readonly LayoutNode[], id: string): LayoutNode | null {
  let hit: LayoutNode | null = null;
  walkLayout(nodes, (n) => { if (!hit && n.id === id) hit = n; });
  return hit;
}

/** id の親 (最上位なら null) と兄弟内 index を返す。見つからなければ undefined。 */
export function findParent(nodes: readonly LayoutNode[], id: string): { parent: LayoutNode | null; index: number } | undefined {
  let res: { parent: LayoutNode | null; index: number } | undefined;
  walkLayout(nodes, (n, p, _d, i) => { if (!res && n.id === id) res = { parent: p, index: i }; });
  return res;
}

export function isDescendant(nodes: readonly LayoutNode[], ancestorId: string, id: string): boolean {
  const anc = findNode(nodes, ancestorId);
  if (!anc?.children) return false;
  return findNode(anc.children, id) !== null;
}

export function collectNodeIds(nodes: readonly LayoutNode[]): Set<string> {
  const ids = new Set<string>();
  walkLayout(nodes, (n) => ids.add(n.id));
  return ids;
}

export function collectItemRefs(nodes: readonly LayoutNode[]): Set<string> {
  const refs = new Set<string>();
  walkLayout(nodes, (n) => { if (n.itemRef) refs.add(n.itemRef); });
  return refs;
}

// ── 更新 (immutable) ─────────────────────────────────────────────────────

function mapTree(nodes: readonly LayoutNode[], fn: (n: LayoutNode) => LayoutNode | null): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (const n of nodes) {
    const mapped = fn(n);
    if (!mapped) continue;
    out.push(mapped.children ? { ...mapped, children: mapTree(mapped.children, fn) } : mapped);
  }
  return out;
}

export function updateNode(nodes: readonly LayoutNode[], id: string, patch: (n: LayoutNode) => LayoutNode): LayoutNode[] {
  return mapTree(nodes, (n) => (n.id === id ? patch(n) : n));
}

export function removeNode(nodes: readonly LayoutNode[], id: string): { nodes: LayoutNode[]; removed: LayoutNode | null } {
  const removed = findNode(nodes, id);
  if (!removed) return { nodes: [...nodes], removed: null };
  return { nodes: mapTree(nodes, (n) => (n.id === id ? null : n)), removed };
}

/** parentId (null=最上位) の index 位置に node を差し込む。index 省略で末尾。 */
export function insertNode(nodes: readonly LayoutNode[], parentId: string | null, node: LayoutNode, index?: number): LayoutNode[] {
  const place = (list: readonly LayoutNode[]): LayoutNode[] => {
    const next = [...list];
    const at = index === undefined || index < 0 || index > next.length ? next.length : index;
    next.splice(at, 0, node);
    return next;
  };
  if (parentId === null) return place(nodes);
  return mapTree(nodes, (n) => (n.id === parentId ? { ...n, children: place(n.children ?? []) } : n));
}

/**
 * id の部品を parentId の index 位置へ移動する。自分自身・子孫への移動や
 * canContain に反する移動は行わず、元の配列を返す。
 */
export function moveNode(nodes: readonly LayoutNode[], id: string, parentId: string | null, index: number): LayoutNode[] {
  if (id === parentId) return [...nodes];
  if (parentId !== null && isDescendant(nodes, id, parentId)) return [...nodes];
  const target = findNode(nodes, id);
  if (!target) return [...nodes];
  const parentNode = parentId === null ? null : findNode(nodes, parentId);
  if (parentId !== null && !parentNode) return [...nodes];
  if (!canContain(parentNode?.type ?? null, target.type)) return [...nodes];
  const from = findParent(nodes, id)!;
  // 同じ親の中で後ろへ動かす場合は、取り除いた分 index を詰める
  let at = index;
  if ((from.parent?.id ?? null) === parentId && from.index < index) at = index - 1;
  const { nodes: without } = removeNode(nodes, id);
  return insertNode(without, parentId, target, at);
}

/** base を元に、画面内で未使用の部品 ID (lowerCamelCase) を返す。 */
export function nextNodeId(nodes: readonly LayoutNode[], base: string): string {
  const used = collectNodeIds(nodes);
  const clean = base.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^[^a-z]+/, "") || "node";
  const stem = clean.charAt(0).toLowerCase() + clean.slice(1);
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i++) if (!used.has(`${stem}${i}`)) return `${stem}${i}`;
}

/** 部品を複製する (子孫含め ID を振り直す。itemRef はそのまま)。 */
export function cloneNode(nodes: readonly LayoutNode[], node: LayoutNode): LayoutNode {
  let pool: LayoutNode[] = [...nodes];
  const copy = (n: LayoutNode): LayoutNode => {
    const id = nextNodeId(pool, n.id.replace(/\d+$/, ""));
    const c: LayoutNode = { ...n, id, ...(n.props ? { props: { ...n.props } } : {}) };
    pool = [...pool, { id, type: n.type }];
    if (n.children) c.children = n.children.map(copy);
    return c;
  };
  return copy(node);
}

// ── 検証 ───────────────────────────────────────────────────────────────────

export interface LayoutIssue {
  severity: "error" | "warning" | "info";
  code: "duplicate-id" | "missing-item" | "item-required" | "invalid-child" | "unplaced-item" | "empty-container" | "html-node";
  message: string;
  nodeId?: string;
  itemId?: string;
}

export interface LayoutItemLike {
  id: string;
  label?: string;
  presentation?: { kind?: string } | undefined;
}

/**
 * レイアウトと画面項目の整合を検査する。draft-state 方針に従い、保存は妨げず警告として返す。
 */
export function validateLayout(layout: ScreenLayout | undefined, items: readonly LayoutItemLike[]): LayoutIssue[] {
  if (!layout) return [];
  const issues: LayoutIssue[] = [];
  const itemIds = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  walkLayout(layout.nodes, (n, p) => {
    if (seen.has(n.id)) issues.push({ severity: "error", code: "duplicate-id", nodeId: n.id, message: `部品 ID「${n.id}」が重複しています` });
    seen.add(n.id);
    if (!canContain(p?.type ?? null, n.type)) {
      issues.push({ severity: "error", code: "invalid-child", nodeId: n.id, message: `${LAYOUT_NODE_LABELS[n.type]}は${p ? LAYOUT_NODE_LABELS[p.type] : "画面の最上位"}の中に置けません` });
    }
    if (ITEM_REQUIRED_TYPES.has(n.type) && !n.itemRef) {
      issues.push({ severity: "warning", code: "item-required", nodeId: n.id, message: `${LAYOUT_NODE_LABELS[n.type]}「${n.id}」に画面項目が割り当てられていません` });
    }
    if (n.itemRef && !itemIds.has(n.itemRef)) {
      issues.push({ severity: "error", code: "missing-item", nodeId: n.id, itemId: n.itemRef, message: `画面項目「${n.itemRef}」が存在しません (部品「${n.id}」)` });
    }
    if (CONTAINER_TYPES.has(n.type) && !n.children?.length && n.type !== "column" && n.type !== "tab") {
      issues.push({ severity: "info", code: "empty-container", nodeId: n.id, message: `${LAYOUT_NODE_LABELS[n.type]}「${n.id}」が空です` });
    }
    if (n.type === "html") {
      issues.push({ severity: "info", code: "html-node", nodeId: n.id, message: `自由 HTML「${n.id}」は業務部品への置き換え候補です` });
    }
  });
  const placed = collectItemRefs(layout.nodes);
  for (const it of items) {
    if (!placed.has(it.id)) issues.push({ severity: "info", code: "unplaced-item", itemId: it.id, message: `画面項目「${it.label || it.id}」が画面に配置されていません` });
  }
  return issues;
}
