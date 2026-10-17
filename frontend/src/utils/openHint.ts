/**
 * 一覧の「ダブルクリック (または Enter) で開きます」の案内 (ISSUE #1528 a)。
 * 一覧の行・カードは、1 回のクリックでは「選択」だけで、ダブルクリックで開く。画面上に手がかりが無いので、
 * 一覧の上に 1 行の案内を出す。一度でも開いた (または消した) ら、このブラウザでは、以後出さない。
 */
import { useSyncExternalStore } from "react";

const KEY = "harmony.listOpenHintSeen";
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
let seen = read();

/** 案内を、以後出さない (開いた・閉じたとき) */
export function markOpenHintSeen(): void {
  if (seen) return;
  seen = true;
  try { localStorage.setItem(KEY, "1"); } catch { /* 保存できなくても、この画面の中では止まる */ }
  listeners.forEach((l) => l());
}

/** 試験用: 案内を、また出す */
export function resetOpenHintForTest(): void {
  seen = false;
  try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** 案内を出すか (まだ開いたことも閉じたこともないとき) */
export const useOpenHint = (): boolean => !useSyncExternalStore(subscribe, () => seen, () => true);
