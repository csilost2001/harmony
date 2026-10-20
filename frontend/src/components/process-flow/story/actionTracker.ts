/**
 * 「流れ」表示が見ている、編集中のアクション (下書き) の、いまの版。
 * 消したあとの「元に戻す」が、そのあとの別の操作 (Ctrl+Z・ほかの表示での編集・AI の反映) を巻き込まないかの確かめに使う。
 * 画面の状態ではなく、「いまの版はどれか」の記録なので、画面の外に持つ。
 */
let latest: unknown = null;
let waiting: Array<(a: unknown) => void> = [];

/** 画面が、いまのアクションを見せたとき (版が変わるたび) に呼ぶ */
export function noteAction(action: unknown): void {
  latest = action;
  const w = waiting;
  waiting = [];
  for (const f of w) f(action);
}

export const latestAction = (): unknown => latest;

/** 次に版が変わったとき、その版を受け取る (直す操作のあとの版を覚えるため) */
export function captureNextAction(cb: (a: unknown) => void): void {
  waiting.push(cb);
}
