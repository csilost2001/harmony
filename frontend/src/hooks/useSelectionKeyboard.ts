import { useEffect } from "react";

interface SelectionKeyboardOpts {
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onEscape: () => void;
  enabled?: boolean;
}

/**
 * Ctrl+X / Ctrl+C / Ctrl+V / Esc キーバインドフック
 */
export function useSelectionKeyboard({
  onCut,
  onCopy,
  onPaste,
  onEscape,
  enabled = true,
}: SelectionKeyboardOpts): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }

      if (!ctrl) return;

      if (e.key === "x") {
        e.preventDefault();
        onCut();
      } else if (e.key === "c") {
        e.preventDefault();
        onCopy();
      } else if (e.key === "v") {
        e.preventDefault();
        onPaste();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCut, onCopy, onPaste, onEscape, enabled]);
}
