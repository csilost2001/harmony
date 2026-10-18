/** 「流れ」表示の、その場で直すための小さな窓。印のそばに出て、外をクリックするか Esc で閉じる */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface StoryPopoverProps {
  /** 窓を出す位置の基準 (印・行の要素) */
  anchor: HTMLElement | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

export function StoryPopover({ anchor, title, onClose, children, width = 380 }: StoryPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** 開いたときの印 (閉じたとき、フォーカスの戻し先の代わりに使う) */
  const anchorAtOpen = useRef(anchor);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });

  // 位置は、開いたときと、中身の大きさが変わったとき (条件を足して高くなるなど) に、測り直す
  const measure = useCallback(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos((cur) => (cur.left === left && cur.top === top ? cur : { left, top }));
  }, [anchor, width]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);

  // 開いたら、最初の入力欄へ。閉じたら、開く前にいた場所 (印) へ、フォーカスを戻す
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const openedFrom = anchorAtOpen.current;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => {
      // 戻し先: 開く前にフォーカスがあった要素。無い (ボタンのクリックでフォーカスが移らない環境) ときは、窓を開いた印
      const back = prev && prev !== document.body && document.contains(prev) ? prev : openedFrom;
      if (back && document.contains(back)) back.focus();
    };
  }, []);

  /** Tab で、窓の外へ抜けない (窓の中を、ぐるっと回る) */
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div
      ref={ref}
      className="pfs-pop"
      role="dialog"
      aria-label={title}
      style={{ left: pos.left, top: pos.top, width }}
      data-testid="pfs-popover"
      // 窓の中の操作 (クリック・ダブルクリック) が、持ち主の行に伝わって、選択や「カードで開く」にならないように
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={trapTab}
    >
      <h4 className="pfs-pop-title">{title}</h4>
      {children}
    </div>,
    document.body,
  );
}
