/** 「流れ」表示の、その場で直すための小さな窓。印のそばに出て、外をクリックするか Esc で閉じる */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ left, top });
  }, [anchor, width]);

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

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }, []);

  return createPortal(
    <div ref={ref} className="pfs-pop" role="dialog" aria-label={title} style={{ left: pos.left, top: pos.top, width }} data-testid="pfs-popover">
      <h4 className="pfs-pop-title">{title}</h4>
      {children}
    </div>,
    document.body,
  );
}
