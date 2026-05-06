import { useEffect } from "react";
import {
  getTabs,
  getActiveTabId,
  setActiveTab,
  closeTab,
  type TabItem,
} from "../store/tabStore";

/** VSCode 互換タブキーボードショートカット */
export function useTabKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      const tabs = getTabs() as TabItem[];
      if (tabs.length === 0) return;

      const activeId = getActiveTabId();
      const idx = tabs.findIndex((t) => t.id === activeId);

      // Ctrl+W: 現在のタブを閉じる
      if (e.key === "w") {
        e.preventDefault();
        if (idx !== -1) {
          const tab = tabs[idx];
          if (tab.isDirty) {
            if (!confirm(`「${tab.label}」に未保存の変更があります。閉じますか？`)) return;
            closeTab(activeId, true);
          } else {
            closeTab(activeId);
          }
        }
        return;
      }

      // Ctrl+Tab: 次のタブへ
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (tabs.length > 1) {
          setActiveTab(tabs[(idx + 1) % tabs.length].id);
        }
        return;
      }

      // Ctrl+Shift+Tab: 前のタブへ
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        if (tabs.length > 1) {
          setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
        }
        return;
      }

      // Ctrl+1〜9: n番目のタブへジャンプ
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        const target = tabs[num - 1];
        if (target) setActiveTab(target.id);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
