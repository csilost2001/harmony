/**
 * ダイアログの中でキーボードのフォーカスを閉じ込める。開いたら中の最初の操作できる要素へ、
 * Tab / Shift+Tab は中で循環し、閉じたら開く前にフォーカスしていた要素へ戻す。
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && !el.closest("[hidden]");
  });
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // すでに中 (autoFocus した欄など) にフォーカスがあれば動かさない
    if (!root.contains(document.activeElement)) focusableIn(root)[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableIn(root);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !root.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !root.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [ref, active]);
}
