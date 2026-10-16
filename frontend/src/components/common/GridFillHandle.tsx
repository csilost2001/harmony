/**
 * 表のオートフィル (UI 改善提案 第 3 弾 #53)。入力欄を選んでいるセルの右下に出る小さな四角を、上下へドラッグすると、
 * その欄の値を、ドラッグした行まで埋める。Ctrl (Mac は Cmd) を押しながらだと、末尾の数字・日付を 1 つずつ進める。
 * キーボードでは、Ctrl+D (1 つ上の行の値を写す) を使う (useGridKeyboard)。
 *
 * 使い方: 表を持つ入れ物 (useGridKeyboard の onKeyDown を付けた要素) の中に `<GridFillHandle />` を 1 つ置く。
 * 画面の座標 (position: fixed) で描くので、入れ物の CSS は変えなくてよい。
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { setFieldValue } from "../../hooks/useGridKeyboard";
import { fillValues } from "../../utils/gridFill";

type Field = HTMLInputElement | HTMLSelectElement;

const isFillable = (el: Element | null): el is Field => {
  if (el instanceof HTMLSelectElement) return !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.disabled || el.readOnly) return false;
  return el.type === "text" || el.type === "" || el.type === "number";
};

/** セル (td) の中の入力欄 */
const fieldOf = (cell: Element | undefined): Field | null => {
  const f = cell?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select");
  return isFillable(f ?? null) ? f! as Field : null;
};

export function GridFillHandle() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const source = useRef<Field | null>(null);
  const drag = useRef<{ field: Field; rows: HTMLElement[]; col: number; series: boolean; last: number } | null>(null);

  useEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    const place = () => {
      if (drag.current) return; // ドラッグ中は、位置を動かさない
      const el = document.activeElement;
      const cell = el && root.contains(el) ? el.closest("td") : null;
      if (!cell || !isFillable(el) || cell.parentElement?.parentElement?.tagName !== "TBODY") { source.current = null; if (!drag.current) setPos(null); return; }
      source.current = el;
      const r = cell.getBoundingClientRect();
      setPos({ left: r.right - 9, top: r.bottom - 9 });
    };
    const schedule = () => requestAnimationFrame(place);
    root.addEventListener("focusin", schedule);
    root.addEventListener("focusout", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      root.removeEventListener("focusin", schedule);
      root.removeEventListener("focusout", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const clearMarks = () => document.querySelectorAll(".grid-fill-target").forEach((n) => n.classList.remove("grid-fill-target"));

  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const field = source.current;
    const cell = field?.closest("td");
    const row = cell?.parentElement;
    const tbody = row?.parentElement;
    if (!field || !cell || !row || !tbody) return;
    e.preventDefault(); e.stopPropagation();
    const col = [...row.children].indexOf(cell);
    drag.current = { field, rows: [...tbody.children] as HTMLElement[], col, series: e.ctrlKey || e.metaKey, last: -1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const rowIndexAt = (x: number, y: number): number => {
    const d = drag.current;
    if (!d) return -1;
    const under = document.elementFromPoint(x, y)?.closest("tr");
    return under ? d.rows.indexOf(under as HTMLElement) : -1;
  };
  const move = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    d.series = e.ctrlKey || e.metaKey;
    const at = rowIndexAt(e.clientX, e.clientY);
    if (at < 0 || at === d.last) return;
    d.last = at;
    clearMarks();
    const from = d.rows.indexOf(d.field.closest("tr") as HTMLElement);
    const [a, b] = from <= at ? [from + 1, at] : [at, from - 1];
    for (let i = a; i <= b; i++) fieldOf(d.rows[i]?.children[d.col])?.closest("td")?.classList.add("grid-fill-target");
  };
  const up = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    drag.current = null;
    clearMarks();
    if (!d) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const from = d.rows.indexOf(d.field.closest("tr") as HTMLElement);
    const at = d.last;
    if (from < 0 || at < 0 || at === from) return;
    const step = at > from ? 1 : -1;
    const targets: Field[] = [];
    for (let i = from + step; step > 0 ? i <= at : i >= at; i += step) {
      const f = fieldOf(d.rows[i]?.children[d.col]);
      if (f) targets.push(f);
    }
    const values = fillValues(d.field.value, targets.length, d.series ? "series" : "copy");
    targets.forEach((f, i) => setFieldValue(f, values[i]));
    d.field.focus();
  };

  return (
    <span ref={anchor} className="grid-fill-anchor">
      {pos && (
        <span
          className="grid-fill-handle" style={{ left: pos.left, top: pos.top }} role="presentation" data-testid="grid-fill-handle"
          title="下 / 上へドラッグして、この欄の値を埋める (Ctrl を押しながらで、数字・日付を 1 つずつ進める)"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onMouseDown={(e) => e.preventDefault()}
        />
      )}
    </span>
  );
}
