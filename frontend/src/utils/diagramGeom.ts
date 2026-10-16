/**
 * 図 (ER 図・画面フロー) の、ノードの整列・等間隔・ガイド・自動配置・つながりの探索・検索 (UI 改善提案 続編 第 7 弾)。
 * 画面に依存しない純関数。座標は React Flow のノードの position (左上) と、幅・高さ。
 */
export interface GeomNode { id: string; x: number; y: number; w: number; h: number }
export interface GeomEdge { source: string; target: string }

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export const ALIGN_LABELS: Record<AlignMode, string> = { left: "左をそろえる", center: "左右の中央をそろえる", right: "右をそろえる", top: "上をそろえる", middle: "上下の中央をそろえる", bottom: "下をそろえる" };

/** 選んだノードを、端・中央にそろえる。動いたノードだけを返す (id → 新しい左上) */
export function alignNodes(nodes: readonly GeomNode[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 2) return out;
  const left = Math.min(...nodes.map((n) => n.x));
  const right = Math.max(...nodes.map((n) => n.x + n.w));
  const top = Math.min(...nodes.map((n) => n.y));
  const bottom = Math.max(...nodes.map((n) => n.y + n.h));
  for (const n of nodes) {
    let x = n.x, y = n.y;
    if (mode === "left") x = left;
    else if (mode === "right") x = right - n.w;
    else if (mode === "center") x = (left + right) / 2 - n.w / 2;
    else if (mode === "top") y = top;
    else if (mode === "bottom") y = bottom - n.h;
    else y = (top + bottom) / 2 - n.h / 2;
    x = Math.round(x); y = Math.round(y);
    if (x !== n.x || y !== n.y) out.set(n.id, { x, y });
  }
  return out;
}

/** 3 つ以上のノードを、両端を動かさず、すき間が等しくなるよう並べる (axis x = 横に並べる / y = 縦に並べる)。動いたものだけ返す */
export function distributeNodes(nodes: readonly GeomNode[], axis: "x" | "y"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 3) return out;
  const pos = (n: GeomNode) => (axis === "x" ? n.x : n.y);
  const size = (n: GeomNode) => (axis === "x" ? n.w : n.h);
  const sorted = [...nodes].sort((a, b) => pos(a) - pos(b) || a.id.localeCompare(b.id));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((s, n) => s + size(n), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first) + size(first) + gap;
  for (const n of sorted.slice(1, -1)) {
    const p = Math.round(cursor);
    if (p !== pos(n)) out.set(n.id, axis === "x" ? { x: p, y: n.y } : { x: n.x, y: p });
    cursor += size(n) + gap;
  }
  return out;
}

export interface SnapResult {
  /** 吸い付いたあとの左上 */
  x: number;
  y: number;
  /** ガイド線 (図の座標。縦線は x、横線は y) */
  vertical: number[];
  horizontal: number[];
}

/**
 * ドラッグ中のノードを、ほかのノードの端・中央に吸い付かせる。しきい値 (図の座標) 以内の最も近い位置にそろえ、そろった線を返す。
 * 左・中央・右 (上・中央・下) のどれが、ほかのノードのどれと合うかを見る。
 */
export function snapToOthers(dragged: GeomNode, others: readonly GeomNode[], threshold = 6): SnapResult {
  const xs = (n: GeomNode) => [n.x, n.x + n.w / 2, n.x + n.w];
  const ys = (n: GeomNode) => [n.y, n.y + n.h / 2, n.y + n.h];
  const best = (mine: number[], theirs: number[]) => {
    let d = Infinity, line = NaN;
    for (const a of mine) for (const b of theirs) if (Math.abs(a - b) < Math.abs(d)) { d = b - a; line = b; }
    return Math.abs(d) <= threshold ? { d, line } : null;
  };
  const allX = others.flatMap(xs), allY = others.flatMap(ys);
  const bx = best(xs(dragged), allX), by = best(ys(dragged), allY);
  const x = dragged.x + (bx?.d ?? 0), y = dragged.y + (by?.d ?? 0);
  const snapped = { ...dragged, x, y };
  // 吸い付いたあとの位置で、実際に重なっている線を集める
  const vertical = [...new Set(xs(snapped).filter((a) => allX.some((b) => Math.abs(a - b) < 0.5)).map((a) => Math.round(a)))];
  const horizontal = [...new Set(ys(snapped).filter((a) => allY.some((b) => Math.abs(a - b) < 0.5)).map((a) => Math.round(a)))];
  return { x: Math.round(x), y: Math.round(y), vertical, horizontal };
}

/** start から、つながりを depth 段まで (向きを問わず) たどった先のノード。start 自身を含む */
export function neighborhood(edges: readonly GeomEdge[], start: Iterable<string>, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
  }
  const seen = new Set<string>(start);
  let frontier = [...seen];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return seen;
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 名前・ID などの文字列から、検索語 (空白区切りは AND) に合うノードの id を、渡した順に返す */
export function searchNodeIds(items: ReadonlyArray<{ id: string; texts: readonly string[] }>, query: string): string[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return items.filter((it) => { const hay = it.texts.map(fold).join("\n"); return tokens.every((t) => hay.includes(t)); }).map((it) => it.id);
}

export interface LayeredOptions { dx?: number; dy?: number }

/**
 * 階層配置 (左から右へ)。つながりの向きに沿って層に分け、層の中は、前の層での位置の平均 (重心) の順に並べる。
 * 輪になっている辺は、層を決めるときに無視する (深さ優先で戻る辺)。ノードの大きさは、層の間隔・段の間隔に足す。
 * 戻り値: id → 左上。つながりの無いノードは、いちばん左の層に縦に並べる。
 */
export function layeredLayout(nodes: readonly GeomNode[], edges: readonly GeomEdge[], opts: LayeredOptions = {}): Map<string, { x: number; y: number }> {
  const dx = opts.dx ?? 80, dy = opts.dy ?? 40;
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const e of edges) if (known.has(e.source) && known.has(e.target) && e.source !== e.target) out.get(e.source)!.push(e.target);

  // 戻る辺を除く (深さ優先)
  const state = new Map<string, 0 | 1 | 2>();
  const dag = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      if (state.get(v) === 1) continue; // 戻る辺
      dag.get(u)!.push(v);
      if (!state.get(v)) visit(v);
    }
    state.set(u, 2);
  };
  // 入ってくる辺が無いノードから始める (あれば)
  const hasIn = new Set([...out.values()].flat());
  for (const id of ids.filter((i) => !hasIn.has(i))) if (!state.get(id)) visit(id);
  for (const id of ids) if (!state.get(id)) visit(id);

  // 最長の道で層を決める
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const vs of dag.values()) for (const v of vs) indeg.set(v, indeg.get(v)! + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of dag.get(u)!) {
      layer.set(v, Math.max(layer.get(v)!, layer.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }

  const byLayer: string[][] = [];
  for (const id of ids) (byLayer[layer.get(id)!] ??= []).push(id);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [u, vs] of dag) for (const v of vs) preds.get(v)!.push(u);
  const order = new Map<string, number>();
  byLayer.forEach((col) => col?.forEach((id, i) => order.set(id, i)));
  for (let pass = 0; pass < 2; pass++) {
    byLayer.forEach((col, li) => {
      if (!col || li === 0) return;
      const bary = (id: string) => { const p = preds.get(id)!; return p.length ? p.reduce((s, q) => s + order.get(q)!, 0) / p.length : order.get(id)!; };
      col.sort((a, b) => bary(a) - bary(b) || order.get(a)! - order.get(b)!);
      col.forEach((id, i) => order.set(id, i));
    });
  }

  const size = new Map(nodes.map((n) => [n.id, n]));
  const res = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const col of byLayer) {
    if (!col) continue;
    const colW = Math.max(...col.map((id) => size.get(id)!.w));
    let y = 0;
    for (const id of col) { res.set(id, { x: Math.round(x), y: Math.round(y) }); y += size.get(id)!.h + dy; }
    x += colW + dx;
  }
  return res;
}

/** 覚えた表示位置 (vp) のとき、図の全体 (bounds) の一部でも、画面 (size) に見えるか。見えなければ、覚えた位置を使わず全体を収める */
export function viewportShows(vp: { x: number; y: number; zoom: number }, bounds: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }): boolean {
  const left = bounds.x * vp.zoom + vp.x, top = bounds.y * vp.zoom + vp.y;
  const right = left + bounds.width * vp.zoom, bottom = top + bounds.height * vp.zoom;
  return right > 0 && bottom > 0 && left < size.width && top < size.height;
}

/** id と直接つながっているノード (向きを問わない。重複なし)。渡した順 (order) があればその順、無ければ id の昇順 */
export function neighborIds(edges: readonly GeomEdge[], id: string, order?: readonly string[]): string[] {
  const set = new Set<string>();
  for (const e of edges) { if (e.source === id && e.target !== id) set.add(e.target); else if (e.target === id && e.source !== id) set.add(e.source); }
  const list = [...set];
  if (order) { const rank = new Map(order.map((x, i) => [x, i])); return list.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9)); }
  return list.sort();
}

export interface GroupedGeomNode extends GeomNode { /** 入っているグループの id (無ければ最上位) */ parentId?: string; /** グループの枠か */ isGroup?: boolean }

export interface GroupedLayout {
  /** id → 位置 (最上位は図の座標・グループの中の画面は、グループの左上からの位置) */
  positions: Map<string, { x: number; y: number }>;
  /** 中の画面が入りきらないために、広げたグループの大きさ (広げていないグループは含まない) */
  sizes: Map<string, { w: number; h: number }>;
}

/**
 * グループのある図の自動配置 (画面フロー)。
 * 1) 各グループの中の画面を、グループの左上を基準に階層配置する。画面は縮めない。入りきらないときは、まず画面どうしのすき間を詰め、
 *    それでも入らなければ、グループの枠を広げる (広げた大きさを sizes に返す)
 * 2) 最上位 (グループに入っていない画面 + グループの枠) を、グループ内の遷移も、グループ単位につないで階層配置する (広げた枠の大きさで)
 * 原点は、いまの最上位の左上に合わせる
 */
export function layoutWithGroups(nodes: readonly GroupedGeomNode[], edges: readonly GeomEdge[], opts: { dx?: number; dy?: number; groupPadding?: { x: number; top: number; bottom: number } } = {}): GroupedLayout {
  const dx = opts.dx ?? 100, dy = opts.dy ?? 50;
  const pad = opts.groupPadding ?? { x: 24, top: 40, bottom: 24 };
  const positions = new Map<string, { x: number; y: number }>();
  const sizes = new Map<string, { w: number; h: number }>();
  const rep = new Map<string, string>(nodes.map((n) => [n.id, n.parentId ?? n.id]));
  const top = nodes.filter((n) => !n.parentId);
  if (top.length === 0) return { positions, sizes };

  // 1) グループの中
  const extent = (kids: readonly GroupedGeomNode[], inner: Map<string, { x: number; y: number }>) => ({
    w: Math.max(...kids.map((k) => inner.get(k.id)!.x + k.w)),
    h: Math.max(...kids.map((k) => inner.get(k.id)!.y + k.h)),
  });
  const finalTop: GroupedGeomNode[] = top.map((n) => ({ ...n }));
  for (const g of nodes.filter((n) => n.isGroup)) {
    const kids = nodes.filter((n) => n.parentId === g.id);
    if (kids.length === 0) continue;
    const ids = new Set(kids.map((k) => k.id));
    const innerEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const availW = g.w - pad.x * 2, availH = g.h - pad.top - pad.bottom;
    const fits = (inner: Map<string, { x: number; y: number }>) => { const e = extent(kids, inner); return e.w <= availW && e.h <= availH; };
    let inner = layeredLayout(kids, innerEdges, { dx: Math.round(dx * 0.5), dy: Math.round(dy * 0.5) });
    if (!fits(inner)) {
      const tight = layeredLayout(kids, innerEdges, { dx: 16, dy: 12 });
      if (fits(tight)) inner = tight;
      else {
        // 入りきらない: 標準の間隔のまま、枠を広げる
        const e = extent(kids, inner);
        const size = { w: Math.max(g.w, Math.ceil(e.w + pad.x * 2)), h: Math.max(g.h, Math.ceil(e.h + pad.top + pad.bottom)) };
        sizes.set(g.id, size);
        const t = finalTop.find((x) => x.id === g.id);
        if (t) { t.w = size.w; t.h = size.h; }
      }
    }
    for (const k of kids) { const p = inner.get(k.id)!; positions.set(k.id, { x: Math.round(pad.x + p.x), y: Math.round(pad.top + p.y) }); }
  }

  // 2) 最上位 (広げた枠の大きさで)
  const lifted: GeomEdge[] = [];
  for (const e of edges) {
    const a = rep.get(e.source), b = rep.get(e.target);
    if (a && b && a !== b) lifted.push({ source: a, target: b });
  }
  const topPos = layeredLayout(finalTop, lifted, { dx, dy });
  const ox = Math.min(...top.map((n) => n.x)), oy = Math.min(...top.map((n) => n.y));
  for (const n of top) { const p = topPos.get(n.id)!; positions.set(n.id, { x: p.x + ox, y: p.y + oy }); }
  return { positions, sizes };
}
