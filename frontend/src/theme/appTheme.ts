/**
 * アプリ UI のライト / ダーク切替。
 *
 * 設定値は localStorage (`harmony.appTheme`) に "light" | "dark" | "system" で保持し、
 * 解決したテーマを `<html data-theme>` に反映する。色そのものは styles/tokens.css が持つ。
 */
import { useSyncExternalStore } from "react";

export type AppThemePref = "light" | "dark" | "system";
export type AppTheme = "light" | "dark";

const STORAGE_KEY = "harmony.appTheme";
const listeners = new Set<() => void>();

function readPref(): AppThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage 不可 (private mode 等) は既定値 */
  }
  return "system";
}

function systemTheme(): AppTheme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(pref: AppThemePref): AppTheme {
  return pref === "system" ? systemTheme() : pref;
}

let currentPref: AppThemePref = "system";

function apply(): void {
  document.documentElement.dataset.theme = resolveTheme(currentPref);
  listeners.forEach((l) => l());
}

export function getAppThemePref(): AppThemePref {
  return currentPref;
}

export function setAppThemePref(pref: AppThemePref): void {
  currentPref = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* 保存できなくても表示は切り替える */
  }
  apply();
}

/** 起動時に 1 回呼ぶ。OS のテーマ変更にも追従する。 */
export function initAppTheme(): void {
  currentPref = readPref();
  apply();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (currentPref === "system") apply();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 現在の設定値と解決済みテーマを返す React hook */
export function useAppTheme(): { pref: AppThemePref; theme: AppTheme } {
  const pref = useSyncExternalStore(subscribe, () => currentPref, () => currentPref);
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light") as AppTheme,
    () => "light" as AppTheme,
  );
  return { pref, theme };
}
