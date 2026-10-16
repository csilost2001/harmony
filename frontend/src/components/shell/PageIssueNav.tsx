/**
 * 「次の要確認」へのジャンプ (F8 / Shift+F8) と、画面の左下の件数 (UI 改善提案 第 5 弾 #88)。
 * 要確認の欄・行は、印 (utils/pageIssues.ts の ISSUE_SELECTOR) を付けた要素。画面ごとの登録は要らない。
 */
import { useCallback, useEffect, useState } from "react";
import { collectIssueElements, focusIssue, nextIssueIndex } from "../../utils/pageIssues";
import { hasOpenModal } from "../../utils/modalScope";

const mainRoot = (): HTMLElement | null => document.getElementById("app-main");

export function PageIssueNav() {
  const [count, setCount] = useState(0);
  const [position, setPosition] = useState(0);

  const refresh = useCallback(() => {
    const root = mainRoot();
    const items = root ? collectIssueElements(root) : [];
    setCount(items.length);
    const active = document.activeElement;
    const i = active ? items.findIndex((el) => el === active || el.contains(active)) : -1;
    setPosition(i + 1);
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    const root = mainRoot();
    if (!root) return;
    const items = collectIssueElements(root);
    const idx = nextIssueIndex(items, document.activeElement && root.contains(document.activeElement) ? document.activeElement : null, dir);
    if (idx < 0) return;
    focusIssue(items[idx]);
    setTimeout(refresh, 50);
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(refresh, 400); };
    const root = mainRoot();
    const mo = new MutationObserver(schedule);
    if (root) mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-invalid", "data-issue"] });
    document.addEventListener("focusin", schedule);
    schedule();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F8" || e.ctrlKey || e.altKey || e.metaKey) return;
      if (hasOpenModal()) return; // ダイアログが開いているあいだは、画面の要確認へ移らない
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => { mo.disconnect(); document.removeEventListener("focusin", schedule); window.removeEventListener("keydown", onKey); if (timer) clearTimeout(timer); };
  }, [refresh, go]);

  if (count === 0) return null;
  return (
    <button type="button" className="page-issue-nav" onClick={() => go(1)} title="次の要確認へ移る (F8。Shift+F8 で前へ)" data-testid="page-issue-nav" role="status" aria-live="polite">
      <i className="bi bi-exclamation-triangle" /> 要確認 {count} 件{position > 0 ? ` (${position} 件目)` : ""} <kbd>F8</kbd>
    </button>
  );
}
