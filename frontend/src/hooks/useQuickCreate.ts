/**
 * クイックオープン (Ctrl+K) の「新しく作る」から、一覧画面の追加ダイアログを開く。
 * クイックオープンが sessionStorage に旗を立てて一覧へ移動し、一覧がマウントされたとき (または、
 * すでに開いているときは通知イベントで) 旗を見つけたら、追加ダイアログを開いて旗を消す。
 */
import { useEffect, useRef } from "react";

export const QUICK_CREATE_EVENT = "harmony:quick-create";
export const quickCreateKey = (kind: string) => `harmony-quick-create:${kind}`;

/** クイックオープン側: 旗を立てる (一覧がすでに開いているときのため、通知も送る) */
export function requestQuickCreate(kind: string): void {
  try { sessionStorage.setItem(quickCreateKey(kind), "1"); } catch { /* 使えなければ、一覧が開くだけ */ }
  // 一覧への移動が済んでから通知する (まだ開いていない一覧は、マウント時に旗を見つける)
  setTimeout(() => window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT, { detail: kind })), 0);
}

export function useQuickCreate(kind: string, open: () => void): void {
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  useEffect(() => {
    const consume = () => {
      try {
        if (sessionStorage.getItem(quickCreateKey(kind)) !== "1") return;
        sessionStorage.removeItem(quickCreateKey(kind));
      } catch { return; }
      openRef.current();
    };
    consume();
    window.addEventListener(QUICK_CREATE_EVENT, consume);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, consume);
  }, [kind]);
}
