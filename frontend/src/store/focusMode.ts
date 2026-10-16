/**
 * 入力専用モード (UI 改善提案 第 5 弾 #98): ヘッダー・タブなどの周りの表示を畳み、編集の画面だけにする。
 * モニターが小さいとき・集中して入力するときのため。このブラウザのタブの中だけ (sessionStorage)。原本・設計には関係しない。
 */
import { useSyncExternalStore } from "react";

const KEY = "harmony.focusMode";
const listeners = new Set<() => void>();

function read(): boolean {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}
let on = read();

function apply(): void {
  document.documentElement.classList.toggle("hm-focus-mode", on);
}

export function isFocusMode(): boolean { return on; }

export function setFocusMode(next: boolean): void {
  if (on === next) return;
  on = next;
  try { if (on) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* 保存できなくても、この画面の中では効く */ }
  apply();
  listeners.forEach((l) => l());
}

export const toggleFocusMode = (): void => setFocusMode(!on);

/** 起動時に、前の状態を反映する (同じブラウザのタブで、ページを読み直したとき) */
export function installFocusMode(): void { apply(); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useFocusMode = (): boolean => useSyncExternalStore(subscribe, () => on, () => on);
