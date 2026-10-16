import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * タッチ・ペンの長押しで、右クリックと同じメニューを開く (UI 改善提案 第 3 弾 #59)。
 * マウスは対象外 (右クリックがある)。指が少しでも動いたら (スクロール・ドラッグ) 取りやめる。
 * Android のブラウザは長押しで contextmenu を出すが、iOS は出さないため、そろえる。
 */
const HOLD_MS = 550;
// 入れ子の要素 (部品の中の部品) で、内側と外側の両方が反応しないように、同じ操作は、最も内側の 1 つだけが受ける
const claimed = new WeakSet<Event>();
const MOVE_PX = 10;

export function useLongPress(onLongPress: (x: number, y: number) => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!enabled || e.pointerType === "mouse" || !e.isPrimary || claimed.has(e.nativeEvent)) return;
    claimed.add(e.nativeEvent);
    cancel();
    const p = { x: e.clientX, y: e.clientY };
    start.current = p;
    timer.current = setTimeout(() => { timer.current = null; onLongPress(p.x, p.y); }, HOLD_MS);
  }, [enabled, onLongPress, cancel]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const s = start.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_PX) cancel();
  }, [cancel]);

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel };
}
