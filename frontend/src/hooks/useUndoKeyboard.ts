import { useEffect } from "react";

/**
 * Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) キーバインドフック
 *
 * @param undo Undo 関数
 * @param redo Redo 関数
 * @param enabled false のときキーバインドを無効化（GrapesJS競合回避等）
 */
export function useUndoKeyboard(
  undo: () => void,
  redo: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // input / textarea / select / contenteditable 内では無視
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, enabled]);
}
