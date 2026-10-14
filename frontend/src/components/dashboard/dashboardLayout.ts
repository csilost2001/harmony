/**
 * ダッシュボードのパネルを、キーボードで動かす・大きさを変えるための純関数 (ドラッグ / リサイズの代わり)。
 * 位置は列・行の 1 マスずつ。範囲 (0 以上・列数まで) と、パネルごとの最小 / 最大の大きさに収める。
 * 重なりは、react-grid-layout が詰め直す (上へ詰める)。
 */
export interface PanelItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** パネルを (dx, dy) マス動かす。動かせなければ (端) 同じ配列を返す */
export function movePanel<T extends PanelItem>(layout: readonly T[], id: string, dx: number, dy: number, cols: number): T[] {
  return layout.map((p) => {
    if (p.i !== id) return p;
    const x = clamp(p.x + dx, 0, cols - p.w);
    const y = Math.max(0, p.y + dy);
    return x === p.x && y === p.y ? p : { ...p, x, y };
  });
}

/** パネルの大きさを (dw, dh) マス変える。最小 / 最大と、右端 (列数) を越えない */
export function resizePanel<T extends PanelItem>(layout: readonly T[], id: string, dw: number, dh: number, cols: number): T[] {
  return layout.map((p) => {
    if (p.i !== id) return p;
    const w = clamp(p.w + dw, p.minW ?? 1, Math.min(p.maxW ?? cols, cols - p.x));
    const h = clamp(p.h + dh, p.minH ?? 1, p.maxH ?? Number.MAX_SAFE_INTEGER);
    return w === p.w && h === p.h ? p : { ...p, w, h };
  });
}

/** 押されたキーを、動かす / 大きさを変える操作にする。Alt+矢印 = 移動、Alt+Shift+矢印 = 大きさ。それ以外は null */
export function panelKeyAction(e: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey">): { kind: "move" | "resize"; dx: number; dy: number } | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const d = e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowUp" ? [0, -1] : e.key === "ArrowDown" ? [0, 1] : null;
  if (!d) return null;
  return { kind: e.shiftKey ? "resize" : "move", dx: d[0], dy: d[1] };
}
