/**
 * タブを画面の右端へドラッグして、並べて表示する (UI 改善提案 第 3 弾 #55) の、ドラッグ中の状態。
 * zone = 右側に並べる領域 (画面の座標)。hot = ポインタがその中にある (離すと、右に並ぶ)。
 */
import { useSyncExternalStore } from "react";

export interface SplitDropState {
  zone: { left: number; top: number; width: number; height: number } | null;
  hot: boolean;
}

const IDLE: SplitDropState = { zone: null, hot: false };
let state: SplitDropState = IDLE;
const listeners = new Set<() => void>();

function emit(next: SplitDropState): void {
  if (next.hot === state.hot && next.zone === state.zone) return;
  state = next;
  listeners.forEach((l) => l());
}

/** 本文の領域のうち、右の何割を、並べる領域にするか */
export const SPLIT_ZONE_RATIO = 0.4;

export function zoneOf(main: { left: number; top: number; width: number; height: number }): NonNullable<SplitDropState["zone"]> {
  const w = Math.round(main.width * SPLIT_ZONE_RATIO);
  return { left: main.left + main.width - w, top: main.top, width: w, height: main.height };
}

export function pointInZone(zone: SplitDropState["zone"], x: number, y: number): boolean {
  return !!zone && x >= zone.left && x <= zone.left + zone.width && y >= zone.top && y <= zone.top + zone.height;
}

export const splitDrop = {
  begin(main: { left: number; top: number; width: number; height: number } | null): void { emit(main ? { zone: zoneOf(main), hot: false } : IDLE); },
  move(x: number, y: number): boolean { const hot = pointInZone(state.zone, x, y); emit({ zone: state.zone, hot }); return hot; },
  isHot(): boolean { return state.hot; },
  end(): void { emit(IDLE); },
};

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useSplitDrop = (): SplitDropState => useSyncExternalStore(subscribe, () => state, () => state);
