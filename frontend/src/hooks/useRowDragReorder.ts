import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { dropIndex } from "../utils/rowReorder";

/**
 * 表の行を、行頭のつまみのドラッグで並べ替える (UI 改善提案 第 3 弾 #48)。HTML5 のドラッグ & ドロップを使う。
 * - つまみ (`gripProps(i)`) を持ち上げ、行 (`rowProps(i)`) の上半分 / 下半分へ落とすと、その前 / 後ろへ動く。落とす位置は線で示す
 * - 表が画面より長いとき、上下の端へ寄せると自動でスクロールする。Esc で取りやめられる (ブラウザの標準)
 * - 行のキー操作の代わりは、Alt+↑↓ (useGridKeyboard の onMoveRow)
 */
export interface RowDragOptions {
  /** from の行を、to の位置 (取り除いたあとの番号) へ動かした */
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}

const EDGE = 48;

/** 一番近いスクロールできる祖先 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export function useRowDragReorder({ onMove, disabled }: RowDragOptions) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null);
  const drag = useRef<number | null>(null);

  const reset = useCallback(() => { drag.current = null; setDragIndex(null); setOver(null); }, []);

  const gripProps = useCallback((i: number) => ({
    draggable: !disabled,
    onDragStart: (e: ReactDragEvent<HTMLElement>) => {
      drag.current = i;
      setDragIndex(i);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
      const tr = e.currentTarget.closest("tr");
      if (tr) e.dataTransfer.setDragImage(tr, 12, 12);
    },
    onDragEnd: reset,
  }), [disabled, reset]);

  const rowProps = useCallback((i: number) => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (drag.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      setOver((o) => (o && o.index === i && o.after === after ? o : { index: i, after }));
      const sp = scrollParent(e.currentTarget);
      if (sp) {
        const sr = sp.getBoundingClientRect();
        if (e.clientY < sr.top + EDGE) sp.scrollTop -= 16;
        else if (e.clientY > sr.bottom - EDGE) sp.scrollTop += 16;
      }
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      const from = drag.current;
      if (from === null) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const to = dropIndex(from, i, e.clientY > r.top + r.height / 2);
      reset();
      if (to !== from) onMove(from, to);
    },
  }), [onMove, reset]);

  /** 行に付けるクラス (落とす位置の線) */
  const rowClass = (i: number): string => {
    if (dragIndex === null) return "";
    const parts: string[] = [];
    if (dragIndex === i) parts.push("row-dragging");
    if (over && over.index === i && dragIndex !== i) parts.push(over.after ? "row-drop-after" : "row-drop-before");
    return parts.join(" ");
  };

  return { dragIndex, gripProps, rowProps, rowClass };
}
