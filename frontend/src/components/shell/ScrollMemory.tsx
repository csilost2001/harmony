import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { recalledScroll, recordScroll, scrollTargetKey } from "../../utils/scrollMemory";

const INPUT_WINDOW_MS = 1500;
const RESTORE_TRIES = 15;

function findTarget(key: string): HTMLElement | null {
  if (key === "#doc") return (document.scrollingElement as HTMLElement | null) ?? null;
  const v = key.slice(2);
  if (key.startsWith("t:")) return document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(v)}"]`);
  if (key.startsWith("i:")) return document.getElementById(v);
  return document.querySelector<HTMLElement>(`.${CSS.escape(v)}`);
}

/**
 * 画面を開き直したとき、前回のスクロール位置から始める (続編 第 8 弾 #157)。画面は何も描かない。
 * 覚えるのは、利用者がホイール・キー・つまみで動かしたときだけ (画面を作り直したときの先頭への戻りを、覚えてしまわないため)。
 * 戻すのは、中身が読み込まれて動かせる高さになってから最大 1.5 秒。その間に利用者が操作したら、やめる。
 */
export function ScrollMemory() {
  const { pathname, search, hash } = useLocation();
  const route = useRef(pathname);
  const lastInput = useRef(0);

  useEffect(() => { route.current = pathname; }, [pathname]);

  useEffect(() => {
    const touch = () => { lastInput.current = Date.now(); };
    const onScroll = (e: Event) => {
      if (Date.now() - lastInput.current > INPUT_WINDOW_MS) return;
      const t = e.target as Element | Document;
      const key = scrollTargetKey(t, document.scrollingElement);
      if (!key) return;
      const top = t instanceof Document ? (document.scrollingElement?.scrollTop ?? 0) : (t as Element).scrollTop;
      recordScroll(route.current, key, top);
    };
    const inputs = ["wheel", "keydown", "pointerdown", "touchmove"] as const;
    inputs.forEach((n) => window.addEventListener(n, touch, { capture: true, passive: true }));
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      inputs.forEach((n) => window.removeEventListener(n, touch, { capture: true }));
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, []);

  useEffect(() => {
    // 直接のリンク (? や #) で来たときは、そちらの位置を優先する
    if (search || hash) return;
    const spots = recalledScroll(pathname);
    const pending = new Set(Object.keys(spots));
    if (pending.size === 0) return;
    const cancel = () => { cancelled = true; };
    let cancelled = false;
    const cancelEvents = ["wheel", "keydown", "pointerdown", "touchmove"] as const;
    cancelEvents.forEach((n) => window.addEventListener(n, cancel, { capture: true, passive: true, once: true }));
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      if (cancelled || tries > RESTORE_TRIES) { window.clearInterval(timer); return; }
      for (const key of [...pending]) {
        const el = findTarget(key);
        if (!el) continue;
        const want = spots[key];
        if (el.scrollHeight - el.clientHeight < want - 1) continue; // まだ中身が足りない
        el.scrollTop = want;
        pending.delete(key);
      }
      if (pending.size === 0) window.clearInterval(timer);
    }, 100);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      cancelEvents.forEach((n) => window.removeEventListener(n, cancel, { capture: true }));
    };
  }, [pathname, search, hash]);

  return null;
}
