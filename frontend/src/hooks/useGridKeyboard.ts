/**
 * useGridKeyboard — 行ごとに入力欄が並ぶ表 (画面項目・帳票の項目など) を、表計算ソフトのようにキーボードで移れるようにする。
 *
 * - Enter = 1 つ下の行の同じ列へ、Shift+Enter = 1 つ上へ。最後の行で (値が入っていれば) Enter = 行を追加 (onAppendRow)
 * - ↑ / ↓ (文字を打つ欄だけ。数値・選択・候補が開いている欄は除く) = 上下の行の同じ列へ
 * - Esc = 欄から出る
 * - Ctrl+D = 1 つ上の行の同じ列の値を、この欄へ写す (表計算ソフトの「下方向へコピー」)
 * - Alt+↑ / Alt+↓ = この行を 1 つ上 / 下へ動かす (onMoveRow)
 * - Ctrl+Enter = この行の下に行を挿入 (onInsertRowBelow) / Ctrl+Shift+Enter = この行を複製 (onDuplicateRow) / Alt+Delete = この行を削除 (onDeleteRow)
 *   (行の番号は、行 (`<tr>`) の `data-grid-row` から読む。行を表す印が無い表では、この 3 つは使えない)
 *
 * 入力欄の部品が自分でキーを処理した (preventDefault 済み、例: 候補の確定の Enter) ときと、日本語入力の変換中は何もしない。
 * 列は `<td>` の位置で数える。欄のない行 (詳細の展開行・空の行) は飛ばす。
 */
import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isImeComposing } from "../utils/imeKeys";

const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), select:not([disabled]), textarea:not([disabled])";

function cellField(row: Element, col: number): HTMLElement | null {
  const cell = row.children[col];
  if (!cell) return null;
  return cell.querySelector<HTMLElement>(FIELD);
}

function focusField(el: HTMLElement) {
  el.scrollIntoView?.({ block: "nearest" });
  el.focus();
  if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "")) el.select();
}

export interface GridKeyboardOptions {
  /** 最後の行で Enter を押したとき (値が空でなければ) 行を追加する */
  onAppendRow?: () => void;
  /** Ctrl+Enter: 行 (data-grid-row の番号) の下に行を挿入する */
  onInsertRowBelow?: (rowIndex: number) => void;
  /** Ctrl+Shift+Enter: 行を複製する (複製は、元の行の下) */
  onDuplicateRow?: (rowIndex: number) => void;
  /** Alt+Delete: 行を削除する */
  onDeleteRow?: (rowIndex: number) => void;
  /** Alt+↑ / Alt+↓: 行を 1 つ上 (-1) / 下 (1) へ動かす */
  onMoveRow?: (rowIndex: number, dir: -1 | 1) => void;
}

/** 入力欄・選択欄の値を、画面の部品 (React) にも伝わる形で入れる */
export function setFieldValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const rowIndexOf = (row: Element): number | null => {
  const v = row.getAttribute("data-grid-row");
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) ? n : null;
};

export function useGridKeyboard({ onAppendRow, onInsertRowBelow, onDuplicateRow, onDeleteRow, onMoveRow }: GridKeyboardOptions = {}) {
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const cell = target.closest("td");
    const row = cell?.parentElement;
    if (!cell || !row || row.parentElement?.tagName !== "TBODY") return;

    const mod = e.ctrlKey || e.metaKey;
    // Ctrl+D: 上の行の同じ列の値を写す
    if (mod && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
      if (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio" || target.readOnly)) return;
      const col = [...row.children].indexOf(cell);
      let prev = row.previousElementSibling;
      while (prev && !cellField(prev, col)) prev = prev.previousElementSibling;
      const src = prev ? cellField(prev, col) : null;
      e.preventDefault();
      if (src instanceof HTMLInputElement || src instanceof HTMLSelectElement) setFieldValue(target, src.value);
      return;
    }
    // Ctrl+Enter / Ctrl+Shift+Enter / Alt+Delete: 行の挿入・複製・削除
    const idx = rowIndexOf(row);
    if (idx !== null) {
      if (mod && !e.altKey && e.key === "Enter" && !isImeComposing(e)) {
        const fn = e.shiftKey ? onDuplicateRow : onInsertRowBelow;
        if (fn) { e.preventDefault(); fn(idx); }
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && e.key === "Delete") {
        if (onDeleteRow) { e.preventDefault(); onDeleteRow(idx); }
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (onMoveRow) { e.preventDefault(); onMoveRow(idx, e.key === "ArrowUp" ? -1 : 1); }
        return;
      }
    }
    if (mod || e.altKey) return;

    if (e.key === "Escape") { e.preventDefault(); target.blur(); return; }

    const isText = target instanceof HTMLInputElement && (target.type === "text" || target.type === "");
    const expanded = target.getAttribute("aria-expanded") === "true";
    let dir = 0;
    if ((e.key === "Enter" && !isImeComposing(e)) && target instanceof HTMLInputElement && target.type !== "button") dir = e.shiftKey ? -1 : 1;
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isText && !expanded && !e.shiftKey) dir = e.key === "ArrowDown" ? 1 : -1;
    if (dir === 0) return;

    const col = [...row.children].indexOf(cell);
    let sibling: Element | null = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
    while (sibling) {
      const field = cellField(sibling, col);
      if (field) { e.preventDefault(); focusField(field); return; }
      sibling = dir > 0 ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    // 端: 最後の行の Enter で、値が入っていれば行を追加
    if (dir > 0 && (e.key === "Enter" && !isImeComposing(e)) && onAppendRow && target instanceof HTMLInputElement && target.value !== "") {
      e.preventDefault();
      onAppendRow();
    }
  }, [onAppendRow, onInsertRowBelow, onDuplicateRow, onDeleteRow, onMoveRow]);

  return { onKeyDown };
}
