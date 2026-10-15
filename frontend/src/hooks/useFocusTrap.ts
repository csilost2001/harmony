/**
 * ダイアログの中でキーボードのフォーカスを閉じ込める。開いたら中の最初の操作できる要素へ、
 * Tab / Shift+Tab は中で循環し、閉じたら開く前にフォーカスしていた要素へ戻す。
 * onEscape を渡すと、Esc でも閉じられる (ダイアログが重なっているときは、いちばん上のものだけ。日本語の変換中は閉じない)。
 */
import { useEffect, useRef, type RefObject } from "react";
import { isImeComposing } from "../utils/imeKeys";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && !el.closest("[hidden]");
  });
}

/** いちばん上のダイアログか (重なったダイアログで、Esc が全部に届いて、まとめて閉じないように) */
function isTopmostDialog(root: HTMLElement): boolean {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  const top = modals[modals.length - 1];
  return !top || top === root || top.contains(root);
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true, onEscape?: () => void): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // すでに中 (autoFocus した欄など) にフォーカスがあれば動かさない
    if (!root.contains(document.activeElement)) focusableIn(root)[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeRef.current && !e.defaultPrevented && !isImeComposing(e) && isTopmostDialog(root)) {
        e.preventDefault();
        escapeRef.current();
        return;
      }
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
