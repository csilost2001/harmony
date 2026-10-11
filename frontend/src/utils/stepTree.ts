/**
 * 工程の入れ子 (subSteps) を、id で指して動かす。Tab / Shift+Tab (インデント / アウトデント) とアウトラインが使う。
 * いずれも渡された配列・工程を直接書き換える (呼び出し側が複製した下書きに対して使う)。
 */
import type { Step } from "../types/v3";

export interface StepLocation {
  /** その工程が入っている配列 (最上位の steps、または親の subSteps) */
  list: Step[];
  index: number;
  /** 親の工程 (最上位なら null) */
  parent: Step | null;
  /** 親が入っている配列 (最上位なら null) */
  parentList: Step[] | null;
}

export function locateStep(steps: Step[], id: string, parent: Step | null = null, parentList: Step[] | null = null): StepLocation | null {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.id === id) return { list: steps, index: i, parent, parentList };
    if (s.subSteps?.length) {
      const hit = locateStep(s.subSteps, id, s, steps);
      if (hit) return hit;
    }
  }
  return null;
}

/** 直前の兄弟があれば、その配下に入れられる */
export function canIndentStep(steps: Step[], id: string): boolean {
  const loc = locateStep(steps, id);
  return !!loc && loc.index > 0;
}

/** 親がいれば、親の次の位置へ出せる */
export function canOutdentStep(steps: Step[], id: string): boolean {
  return !!locateStep(steps, id)?.parent;
}

/** 直前の兄弟の subSteps の末尾へ移す (自分の subSteps も一緒に動く) */
export function indentStep(steps: Step[], id: string): boolean {
  const loc = locateStep(steps, id);
  if (!loc || loc.index === 0) return false;
  const [moved] = loc.list.splice(loc.index, 1);
  const prev = loc.list[loc.index - 1];
  (prev.subSteps ??= []).push(moved);
  return true;
}

/** 親の次の位置へ出す (親の subSteps が空になれば項目ごと消す)。自分より後ろの兄弟は、自分の配下へ引き継ぐ */
export function outdentStep(steps: Step[], id: string): boolean {
  const loc = locateStep(steps, id);
  if (!loc || !loc.parent || !loc.parentList) return false;
  const [moved] = loc.list.splice(loc.index, 1);
  // 後ろにいた兄弟は、動かした工程の配下にする (見た目の位置と実行順を変えないため)
  const followers = loc.list.splice(loc.index);
  if (followers.length > 0) moved.subSteps = [...(moved.subSteps ?? []), ...followers];
  if (loc.list.length === 0) delete loc.parent.subSteps;
  const at = loc.parentList.indexOf(loc.parent);
  loc.parentList.splice(at + 1, 0, moved);
  return true;
}
