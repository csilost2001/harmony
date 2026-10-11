/**
 * 処理フローの工程 (ステップ) を、キーボードだけで辿る・組み立てるためのキー操作。
 *
 * 工程の見出し (.step-card-header) にフォーカスがあるとき:
 *   ↑ ↓ / Home End  前後の工程へ     → ←  開く / 閉じる     Space  開閉     Enter / F2  開いて最初の入力欄へ
 *   Insert / /      工程を挿入 (種類を打ち込んで選ぶ)
 *   Tab / Shift+Tab  インデント (直前の工程の中へ) / アウトデント     (編集中のみ。呼び出し側が処理を渡したときだけ)
 * 入力欄の中: Esc で工程の見出しへ戻る / Ctrl+Enter で、この工程の後ろに挿入
 * どこでも (入力欄の外): Insert で、いまの位置 (なければ末尾) に挿入
 *
 * 見出しへフォーカスが移ると、その工程を選択状態にする (既存の Ctrl+C / Ctrl+X / Ctrl+V / Delete / Alt+↑↓ がそのまま使える)。
 */
import { useEffect, useRef } from "react";

export interface StepKeyboardHandlers {
  /** 編集中か。false のあいだは、辿る操作だけ */
  editing: boolean;
  /** 工程を挿入するメニューを開く。afterStepId = その工程の後ろ (なければ末尾) */
  onInsert: (afterStepId: string | null) => void;
  /** 直前の工程の中へ入れる (Tab)。渡さなければ Tab は通常のフォーカス移動 */
  onIndent?: (stepId: string) => void;
  /** 入れ子の工程をひとつ外へ出す (Shift+Tab)。渡さなければ通常のフォーカス移動 */
  onOutdent?: (parentStepId: string, stepId: string) => void;
  /** 見出しにフォーカスが移った (キーボードで) */
  onFocusStep: (stepId: string, topLevel: boolean) => void;
}

const FIELD = "input, textarea, select, [contenteditable=\"true\"]";
const isField = (el: Element | null) => !!el && (el.matches(FIELD) || !!el.closest("[contenteditable=\"true\"]"));

/** 画面にある工程の見出し (上から下の順)。非表示のもの (閉じた入れ子など) は除く */
export function headersIn(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".step-card-header")].filter((h) => getComputedStyle(h).display !== "none" && !h.closest("[hidden]"));
}

export function stepIdOf(el: Element | null): string | null {
  return el?.closest(".step-card")?.getAttribute("data-step-id") ?? null;
}

/** 親の工程の id (入れ子でなければ null)。子の工程は親の .step-card の隣の .sub-steps に入る */
export function parentStepIdOf(el: Element): string | null {
  const wrapper = el.closest(".sub-steps")?.closest(".step-card-wrapper");
  return wrapper?.querySelector(":scope > .step-card")?.getAttribute("data-step-id") ?? null;
}

export function focusStepHeader(stepId: string): boolean {
  const h = document.querySelector<HTMLElement>(`.step-card[data-step-id="${CSS.escape(stepId)}"] > .step-card-header`);
  h?.focus();
  return !!h;
}

export function useStepKeyboard(h: StepKeyboardHandlers): void {
  const ref = useRef(h);
  useEffect(() => { ref.current = h; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const cfg = ref.current;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest?.('[aria-modal="true"]')) return;
      const card = target.closest?.(".step-card") ?? null;

      // 入力欄の中
      if (isField(target)) {
        if (!card) return;
        const id = stepIdOf(card);
        if (e.key === "Escape") {
          // 補完の候補などが Esc を使っていなければ、工程の見出しへ戻る
          const header = card.querySelector<HTMLElement>(":scope > .step-card-header");
          if (header) { e.preventDefault(); header.focus(); }
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && cfg.editing && id) {
          e.preventDefault();
          cfg.onInsert(id);
        }
        return;
      }

      // 工程の見出し
      if (target.classList.contains("step-card-header") && card) {
        const id = stepIdOf(card);
        if (!id) return;
        const all = headersIn(target.closest(".process-flow-page") ?? document);
        const i = all.indexOf(target);
        const go = (j: number) => {
          const next = all[Math.max(0, Math.min(all.length - 1, j))];
          if (next && next !== target) {
            next.focus();
            const nid = stepIdOf(next);
            if (nid) cfg.onFocusStep(nid, parentStepIdOf(next) === null);
          }
        };
        const expanded = target.getAttribute("data-expanded") === "true";
        switch (e.key) {
          case "ArrowDown": e.preventDefault(); go(i + 1); return;
          case "ArrowUp": e.preventDefault(); go(i - 1); return;
          case "Home": e.preventDefault(); go(0); return;
          case "End": e.preventDefault(); go(all.length - 1); return;
          case "ArrowRight": if (!expanded) { e.preventDefault(); target.click(); } return;
          case "ArrowLeft": if (expanded) { e.preventDefault(); target.click(); } return;
          case " ": e.preventDefault(); target.click(); return;
          case "Enter":
          case "F2": {
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();
            if (!expanded) target.click();
            // 開いた本文の最初の入力欄へ (描画のあとで)
            setTimeout(() => {
              const c = document.querySelector(`.step-card[data-step-id="${CSS.escape(id)}"]`);
              c?.querySelector<HTMLElement>(":scope > .step-card-body textarea, :scope > .step-card-body input:not([type=checkbox]):not([type=radio]):not([disabled])")?.focus();
            }, 30);
            return;
          }
          case "Insert":
          case "/":
            if (!cfg.editing || e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault(); cfg.onInsert(id); return;
          case "Tab": {
            if (!cfg.editing || e.ctrlKey || e.metaKey || e.altKey) return;
            const parent = parentStepIdOf(target);
            if (e.shiftKey) {
              if (parent && cfg.onOutdent) { e.preventDefault(); cfg.onOutdent(parent, id); }
            } else if (!parent && cfg.onIndent) {
              e.preventDefault(); cfg.onIndent(id);
            }
            return;
          }
          default: return;
        }
      }

      // どこでも: Insert で、末尾に挿入 (工程がまだないときの入口)
      if (e.key === "Insert" && cfg.editing && !e.ctrlKey && !e.metaKey && !e.altKey && target.closest?.(".process-flow-page") && !target.closest?.(".pf-outline")) {
        e.preventDefault();
        cfg.onInsert(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
