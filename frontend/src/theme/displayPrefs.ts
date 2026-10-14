/**
 * 表示の設定 (文字サイズ・密度・コントラスト)。ブラウザごとの設定で、設計の原本には関係しない。
 *
 * 設定値は localStorage (`harmony.display`) に持ち、`<html data-font-scale / data-density / data-contrast>` に反映する。
 * 値に応じた見た目 (倍率・余白・色) は styles/tokens.css が持つ。
 */
import { useSyncExternalStore } from "react";

export type FontScale = "small" | "standard" | "large" | "xlarge";
export type Density = "standard" | "compact";
export type Contrast = "standard" | "high";
export interface DisplayPrefs { fontScale: FontScale; density: Density; contrast: Contrast }

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { fontScale: "standard", density: "standard", contrast: "standard" };
export const FONT_SCALE_LABELS: Record<FontScale, string> = { small: "小", standard: "標準", large: "大", xlarge: "特大" };
export const DENSITY_LABELS: Record<Density, string> = { standard: "標準", compact: "コンパクト" };
export const CONTRAST_LABELS: Record<Contrast, string> = { standard: "標準", high: "高" };

const STORAGE_KEY = "harmony.display";
const listeners = new Set<() => void>();
let current: DisplayPrefs = DEFAULT_DISPLAY_PREFS;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** 保存値を読む。壊れた値・知らない値は既定に戻す */
export function parseDisplayPrefs(raw: string | null): DisplayPrefs {
  if (!raw) return DEFAULT_DISPLAY_PREFS;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return DEFAULT_DISPLAY_PREFS;
    return {
      fontScale: oneOf(v.fontScale, ["small", "standard", "large", "xlarge"] as const, "standard"),
      density: oneOf(v.density, ["standard", "compact"] as const, "standard"),
      contrast: oneOf(v.contrast, ["standard", "high"] as const, "standard"),
    };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

function apply(): void {
  const el = document.documentElement;
  // 標準は属性を付けない (トークンの既定値のまま)
  const set = (name: string, value: string) => { if (value === "standard") el.removeAttribute(name); else el.setAttribute(name, value); };
  set("data-font-scale", current.fontScale);
  set("data-density", current.density);
  set("data-contrast", current.contrast);
  listeners.forEach((l) => l());
}

export function getDisplayPrefs(): DisplayPrefs { return current; }

export function setDisplayPrefs(patch: Partial<DisplayPrefs>): void {
  current = { ...current, ...patch };
  try {
    if (current.fontScale === "standard" && current.density === "standard" && current.contrast === "standard") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* 保存できなくても表示は切り替える */
  }
  apply();
}

/** 起動時に 1 回呼ぶ */
export function initDisplayPrefs(): void {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* 読めなければ既定 */ }
  current = parseDisplayPrefs(raw);
  apply();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, getDisplayPrefs, getDisplayPrefs);
}
