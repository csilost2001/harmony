/**
 * useDetailPanelKeyboard — 一覧の 1 行を編集する「詳細パネル」を、キーボードだけで次々に入力するための共通フック。
 *
 * - パネルが別の行に切り替わったら (resetKey が変わったら)、最初の入力欄へカーソルを入れる
 * - Enter (1 行の入力欄) = 次の欄へ。最後の欄なら次の行へ (onNext)
 * - Ctrl+Enter = 次の行へ (onNext)、Ctrl+Shift+Enter = 前の行へ (onPrev)
 * - Esc (入力欄の中) = 入力欄から出る (一覧の矢印キー操作へ戻る)
 *
 * 詳細パネルの外側 (一覧・タブ) のキー操作には触れない。
 */
import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FIELD = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";

export function fieldsIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FIELD)].filter((el) => !el.closest("[hidden]") && getComputedStyle(el).display !== "none");
}

export interface DetailPanelKeyboardOptions {
  panelRef: RefObject<HTMLElement | null>;
  /** 編集中の行の id。変わったら最初の入力欄へカーソルを入れる。null なら何もしない */
  resetKey: string | null;
  onNext?: () => void;
  onPrev?: () => void;
}

export function useDetailPanelKeyboard({ panelRef, resetKey, onNext, onPrev }: DetailPanelKeyboardOptions) {
  useEffect(() => {
    if (resetKey == null) return;
    const root = panelRef.current;
    if (!root) return;
    const first = fieldsIn(root).find((el) => !(el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")));
    first?.focus();
    if (first instanceof HTMLInputElement && first.type === "text") first.select();
  }, [panelRef, resetKey]);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return; // 変換の確定の Enter は無視
    // 入力欄の部品 (候補・補完など) が自分で処理したキー、候補が開いているあいだの Enter / Esc は、その部品のもの
    const handledByField = e.defaultPrevented || target.getAttribute("aria-expanded") === "true";
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) onPrev?.(); else onNext?.();
      return;
    }
    if (handledByField) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && target instanceof HTMLInputElement && target.type !== "button" && target.type !== "submit") {
      e.preventDefault();
      const root = panelRef.current;
      if (!root) return;
      const all = fieldsIn(root);
      const i = all.indexOf(target);
      const next = all[i + 1];
      if (next) { next.focus(); if (next instanceof HTMLInputElement && next.type === "text") next.select(); }
      else onNext?.();
      return;
    }
    if (e.key === "Escape" && target.matches(FIELD)) {
      e.preventDefault();
      target.blur();
    }
  }, [panelRef, onNext, onPrev]);

  return { onKeyDown };
}
