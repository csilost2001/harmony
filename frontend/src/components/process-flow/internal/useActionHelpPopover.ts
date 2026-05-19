// Phase-3 (#1145): ProcessFlowEditor.tsx から ActionHelpPopover の位置計算 +
// open/close debounce 制御を切り出したフック。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ActionHelpState {
  actionId: string;
  left: number;
  top: number;
  placement: "below" | "above";
  anchorTop: number;
  anchorBottom: number;
}

export interface UseActionHelpPopover {
  actionHelp: ActionHelpState | null;
  openActionHelp: (actionId: string, anchor: HTMLElement) => void;
  scheduleCloseActionHelp: () => void;
  clearActionHelpCloseTimer: () => void;
}

const POPOVER_WIDTH_MIN = 280;
const POPOVER_WIDTH_MAX = 420;
const POPOVER_ESTIMATED_HEIGHT = 430;
const CLOSE_DELAY_MS = 120;

export function useActionHelpPopover(): UseActionHelpPopover {
  const [actionHelp, setActionHelp] = useState<ActionHelpState | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearActionHelpCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openActionHelp = useCallback(
    (actionId: string, anchor: HTMLElement) => {
      clearActionHelpCloseTimer();
      const rect = anchor.getBoundingClientRect();
      const popoverWidth = Math.min(POPOVER_WIDTH_MAX, Math.max(POPOVER_WIDTH_MIN, window.innerWidth - 24));
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - popoverWidth / 2),
        window.innerWidth - popoverWidth - 12,
      );
      const belowTop = rect.bottom + 10;
      const canOpenBelow = belowTop + POPOVER_ESTIMATED_HEIGHT <= window.innerHeight - 12;
      setActionHelp({
        actionId,
        left,
        top: canOpenBelow ? belowTop : Math.max(12, rect.top - POPOVER_ESTIMATED_HEIGHT - 10),
        placement: canOpenBelow ? "below" : "above",
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
      });
    },
    [clearActionHelpCloseTimer],
  );

  const scheduleCloseActionHelp = useCallback(() => {
    clearActionHelpCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setActionHelp(null);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearActionHelpCloseTimer]);

  // window resize で popover を閉じる
  useEffect(() => {
    if (!actionHelp) return undefined;
    const close = () => setActionHelp(null);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
    };
  }, [actionHelp]);

  // 実際の DOM 高さに基づいて placement を補正
  useLayoutEffect(() => {
    if (!actionHelp) return;
    const popover = document.getElementById(`action-help-${actionHelp.actionId}`);
    if (!popover) return;
    const actualHeight = Math.min(popover.getBoundingClientRect().height, window.innerHeight - 24);
    const belowTop = actionHelp.anchorBottom + 10;
    const canOpenBelow = belowTop + actualHeight <= window.innerHeight - 12;
    const nextTop = canOpenBelow
      ? belowTop
      : Math.max(12, actionHelp.anchorTop - actualHeight - 10);
    const nextPlacement: "below" | "above" = canOpenBelow ? "below" : "above";
    if (Math.abs(nextTop - actionHelp.top) > 1 || nextPlacement !== actionHelp.placement) {
      setActionHelp((cur) =>
        cur && cur.actionId === actionHelp.actionId
          ? { ...cur, top: nextTop, placement: nextPlacement }
          : cur,
      );
    }
  }, [actionHelp]);

  // unmount cleanup
  useEffect(() => () => clearActionHelpCloseTimer(), [clearActionHelpCloseTimer]);

  return { actionHelp, openActionHelp, scheduleCloseActionHelp, clearActionHelpCloseTimer };
}
