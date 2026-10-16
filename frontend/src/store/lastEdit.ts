/**
 * 最後に編集した場所 (UI 改善提案 続編 第 8 弾 #158)。入力したとき、その欄を含む「直接のリンクの印」(工程・項目・カラム・部品) の位置を、タブごとに覚える。
 * Ctrl+Alt+Backspace で、直前に編集した場所へ戻る (続けて押すと、さらに前の場所へ)。長い設計で、別の所を見たあと、元の場所に戻るために使う。
 * このブラウザの、いまのページの中だけで覚える (保存しない)。
 */
export interface EditSpot { tabId: string; key: string; at: number }

const MAX = 12;
let spots: EditSpot[] = [];
let cursor = 0;
let lastJumpAt = 0;
const CHAIN_MS = 4000;

/** 入力した場所を覚える。同じ場所が続けば、時刻だけ更新する。新しい順 */
export function recordEdit(tabId: string, key: string, now: number = Date.now()): void {
  if (!tabId || !key) return;
  const head = spots[0];
  if (head && head.tabId === tabId && head.key === key) { head.at = now; return; }
  spots = [{ tabId, key, at: now }, ...spots.filter((s) => !(s.tabId === tabId && s.key === key))].slice(0, MAX);
  cursor = 0;
}

export function getEditSpots(): readonly EditSpot[] { return spots; }

/**
 * 戻る先を 1 つ決める。短い間に続けて呼ぶと、さらに前の場所へ。場所が無ければ null。
 * 前の場所へ進む起点は「いま、その場所にいるか」でなく時間で決める (画面の読み込みを待たずに、続けて押せるように)。
 */
export function nextEditSpot(now: number = Date.now()): EditSpot | null {
  if (spots.length === 0) return null;
  cursor = now - lastJumpAt <= CHAIN_MS ? (cursor + 1) % spots.length : 0;
  lastJumpAt = now;
  return spots[cursor];
}

/** 覚えた場所を消す (ワークスペースの切り替え・テスト) */
export function clearEditSpots(): void { spots = []; cursor = 0; lastJumpAt = 0; }
