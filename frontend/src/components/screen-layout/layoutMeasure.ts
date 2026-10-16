/**
 * 選んだ部品の寸法と、まわりとのすき間 (UI 改善提案 続編 第 8 弾 #143)。画面に依存しない純関数。
 * 座標は、紙面の左上を原点にした px。すき間は、直前・直後の兄弟との間と、入れ物の内側の余白 (上下左右)。
 */
export interface Box { x: number; y: number; w: number; h: number }
export type MeasureLabel =
  | { kind: "size"; x: number; y: number; text: string }
  | { kind: "gap"; box: Box; text: string };

const r = (n: number) => Math.round(n);

/** 兄弟 (直前 / 直後) との、すき間の領域。縦に並んでいれば上下の、横に並んでいれば左右のすき間。重なっていれば無し */
function gapBetween(a: Box, b: Box): Box | null {
  // a の下に b (縦に並ぶ)
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX > 0 && a.y + a.h <= b.y) return { x: Math.max(a.x, b.x), y: a.y + a.h, w: overlapX, h: b.y - (a.y + a.h) };
  if (overlapX > 0 && b.y + b.h <= a.y) return { x: Math.max(a.x, b.x), y: b.y + b.h, w: overlapX, h: a.y - (b.y + b.h) };
  if (overlapY > 0 && a.x + a.w <= b.x) return { x: a.x + a.w, y: Math.max(a.y, b.y), w: b.x - (a.x + a.w), h: overlapY };
  if (overlapY > 0 && b.x + b.w <= a.x) return { x: b.x + b.w, y: Math.max(a.y, b.y), w: a.x - (b.x + b.w), h: overlapY };
  return null;
}

export function measureSelection(sel: Box, siblings: readonly Box[], parent: Box | null): MeasureLabel[] {
  const out: MeasureLabel[] = [{ kind: "size", x: sel.x, y: sel.y + sel.h, text: `${r(sel.w)} × ${r(sel.h)}` }];
  for (const s of siblings) {
    const g = gapBetween(sel, s);
    if (g && (g.w > 0 && g.h > 0)) out.push({ kind: "gap", box: g, text: `${r(g.w > g.h ? g.h : g.w)}` });
  }
  if (parent) {
    const left = sel.x - parent.x, right = parent.x + parent.w - (sel.x + sel.w), top = sel.y - parent.y, bottom = parent.y + parent.h - (sel.y + sel.h);
    if (left > 0) out.push({ kind: "gap", box: { x: parent.x, y: sel.y, w: left, h: sel.h }, text: `${r(left)}` });
    if (right > 0) out.push({ kind: "gap", box: { x: sel.x + sel.w, y: sel.y, w: right, h: sel.h }, text: `${r(right)}` });
    if (top > 0) out.push({ kind: "gap", box: { x: sel.x, y: parent.y, w: sel.w, h: top }, text: `${r(top)}` });
    if (bottom > 0) out.push({ kind: "gap", box: { x: sel.x, y: sel.y + sel.h, w: sel.w, h: bottom }, text: `${r(bottom)}` });
  }
  return out;
}
