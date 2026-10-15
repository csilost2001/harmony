/**
 * useGridKeyboard — 行ごとに入力欄が並ぶ表 (画面項目・帳票の項目など) を、表計算ソフトのようにキーボードで移れるようにする。
 *
 * - Enter = 1 つ下の行の同じ列へ、Shift+Enter = 1 つ上へ。最後の行で (値が入っていれば) Enter = 行を追加 (onAppendRow)
 * - ↑ / ↓ (文字を打つ欄だけ。数値・選択・候補が開いている欄は除く) = 上下の行の同じ列へ
 * - Esc = 欄から出る
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
}

export function useGridKeyboard({ onAppendRow }: GridKeyboardOptions = {}) {
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const cell = target.closest("td");
    const row = cell?.parentElement;
    if (!cell || !row || row.parentElement?.tagName !== "TBODY") return;

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
  }, [onAppendRow]);

  return { onKeyDown };
}
