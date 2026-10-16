/**
 * 工程カードの「まとめて開く・畳む」の合図 (UI 改善提案 続編 第 8 弾 #145)。
 * 各工程カードは、自分の開閉を自分で持つので、まとめての操作は「合図」(世代つき) を出し、カードが世代の変化に気づいて、自分を開く / 閉じる。
 *   expand = すべて開く / collapse = すべて畳む / attention = 要確認・マーカーのある工程だけ開く (あとは畳む)
 */
import { useSyncExternalStore } from "react";

export type StepExpandMode = "expand" | "collapse" | "attention";
export interface StepExpandCommand { epoch: number; mode: StepExpandMode }

let current: StepExpandCommand = { epoch: 0, mode: "collapse" };
const listeners = new Set<() => void>();

export function issueStepExpand(mode: StepExpandMode): void {
  current = { epoch: current.epoch + 1, mode };
  listeners.forEach((l) => l());
}

export function getStepExpandCommand(): StepExpandCommand { return current; }

export function useStepExpandCommand(): StepExpandCommand {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getStepExpandCommand, getStepExpandCommand);
}

/** 合図のとき、その工程が開くべきか (要確認・マーカーがあるか) */
export function shouldBeOpen(mode: StepExpandMode, hasIssue: boolean): boolean {
  return mode === "expand" ? true : mode === "collapse" ? false : hasIssue;
}
