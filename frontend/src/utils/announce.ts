/**
 * 画面の変化を、スクリーンリーダーへ控えめに伝える (UI 改善提案 続編 第 10 弾 #187)。通知 (トースト) は role=status で伝わるので、
 * ここで扱うのは、トーストにならない変化 (タブの切り替え・一覧の絞り込みの件数・検査の件数)。連続した知らせは、短い間にまとめて 1 回で読み上げる。
 */
type Listener = (text: string) => void;
const listeners = new Set<Listener>();

export const ANNOUNCE_DELAY_MS = 700;
const MAX_JOINED = 3;

let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** 読み上げの知らせを出す。同じ文が続けて来たら 1 つにし、短い間の知らせは、新しい 3 件までまとめる */
export function announce(text: string): void {
  const t = text.trim();
  if (!t) return;
  if (pending.at(-1) === t) return;
  pending.push(t);
  clearTimeout(timer);
  timer = setTimeout(flush, ANNOUNCE_DELAY_MS);
}

function flush(): void {
  timer = undefined;
  const joined = pending.slice(-MAX_JOINED).join("。");
  pending = [];
  if (joined) listeners.forEach((l) => l(joined));
}

export function subscribeAnnouncements(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** テスト用: 待ちを捨てる */
export function _resetAnnouncer(): void { clearTimeout(timer); timer = undefined; pending = []; }
