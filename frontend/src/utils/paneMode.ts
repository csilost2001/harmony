/**
 * 並べて表示 (右ペイン) の中で動いているアプリか。右ペインは、同じアプリをもう 1 つ (iframe で) 開くので、
 * URL に `?pane=1` が付く。この場合、上部ヘッダー・タブバーは出さず、開いているタブの記録 (localStorage) は読まず・書かない
 * (左のアプリのタブを、上書きしないため)。
 */
export function isPaneMode(): boolean {
  try { return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pane") === "1"; } catch { return false; }
}

/** 右ペインから、左のアプリ (親) へ知らせる合図。同じオリジンの親だけが受け取る */
export type PaneMessage =
  | { type: "harmony-pane-dirty"; dirty: boolean }
  | { type: "harmony-pane-nav"; path: string };

export function postToParent(msg: PaneMessage): void {
  try { if (window.parent !== window) window.parent.postMessage(msg, window.location.origin); } catch { /* 親が無い・読めないときは何もしない */ }
}

/** 受け取った合図が、右ペインから来た正しい形か (形・オリジンを確かめる) */
export function parsePaneMessage(ev: { origin: string; data: unknown }, origin: string = window.location.origin): PaneMessage | null {
  if (ev.origin !== origin) return null;
  const d = ev.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  if (d.type === "harmony-pane-dirty" && typeof d.dirty === "boolean") return { type: "harmony-pane-dirty", dirty: d.dirty };
  if (d.type === "harmony-pane-nav" && typeof d.path === "string" && d.path.startsWith("/") && !d.path.startsWith("//") && d.path.length < 2000) return { type: "harmony-pane-nav", path: d.path };
  return null;
}
