/**
 * 動きを減らす設定 (UI 改善提案 続編 第 10 弾 #184)。OS の「視覚効果を減らす」(prefers-reduced-motion) に従う (既定) か、アプリで「減らす」「減らさない」を選ぶ。
 * 減らすと、CSS のアニメーション・遷移 (`styles/motion.css`) と、図のズーム・移動の補間 (`motionMs`) を止める。ブラウザごとの設定 (localStorage `harmony.motion`)。
 */
import { useSyncExternalStore } from "react";

export type MotionPref = "auto" | "reduced" | "full";
export const MOTION_LABELS: Record<MotionPref, string> = { auto: "OS の設定に従う", reduced: "減らす", full: "減らさない" };
const KEY = "harmony.motion";
const listeners = new Set<() => void>();
let current: MotionPref = "auto";

export const parseMotionPref = (raw: string | null): MotionPref => (raw === "reduced" || raw === "full" ? raw : "auto");

function apply(): void {
  const el = document.documentElement;
  if (current === "auto") el.removeAttribute("data-motion"); else el.setAttribute("data-motion", current);
  listeners.forEach((l) => l());
}

export function initMotionPrefs(): void {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* 読めなければ既定 */ }
  current = parseMotionPref(raw);
  apply();
}

export const getMotionPref = (): MotionPref => current;

export function setMotionPref(v: MotionPref): void {
  current = v;
  try { if (v === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* 保存できなくても切り替える */ }
  apply();
}

/** いま、動きを減らすか (「減らす」、または「OS の設定に従う」で OS が減らす設定) */
export function prefersReducedMotion(): boolean {
  if (current === "reduced") return true;
  if (current === "full") return false;
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** 図のズーム・移動の補間の長さ (ms)。動きを減らすときは 0 */
export const motionMs = (ms: number): number => (prefersReducedMotion() ? 0 : ms);

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useMotionPref = (): MotionPref => useSyncExternalStore(subscribe, getMotionPref, getMotionPref);
