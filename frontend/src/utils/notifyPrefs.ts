/**
 * 通知の受け取り方 (UI 改善提案 続編 第 9 弾 #176)。画面の下に出る通知 (保存しました・失敗しました・ほかの人の編集など) を、
 * 種類ごとに「必ず出す / まとめて出す / 出さない」から選び、静かな時間帯 (保存・お知らせの通知を出さない) を決める。
 * どの選び方でも、通知の履歴 (ヘッダーのベル) には残る。このブラウザにだけ保存する。画面に依存しない部分と、保存・購読。
 */
import { useSyncExternalStore } from "react";
import type { ToastKind } from "./toast";

export type NotifyMode = "always" | "batch" | "off";
export interface QuietHours { on: boolean; from: string; to: string }
export interface NotifyPrefs { success: NotifyMode; info: NotifyMode; error: NotifyMode; quiet: QuietHours }

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { success: "always", info: "always", error: "always", quiet: { on: false, from: "22:00", to: "07:00" } };
export const NOTIFY_MODE_LABELS: Record<NotifyMode, string> = { always: "必ず出す", batch: "まとめて出す", off: "出さない (履歴だけ)" };
export const NOTIFY_KIND_LABELS: Record<ToastKind, string> = { success: "保存・成功のお知らせ", info: "そのほかのお知らせ (ほかの人の編集など)", error: "失敗" };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STORAGE_KEY = "harmony.notify";
const MODES: readonly NotifyMode[] = ["always", "batch", "off"];
const mode = (v: unknown, fallback: NotifyMode): NotifyMode => ((MODES as readonly unknown[]).includes(v) ? (v as NotifyMode) : fallback);

export function parseNotifyPrefs(raw: string | null): NotifyPrefs {
  if (!raw) return DEFAULT_NOTIFY_PREFS;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return DEFAULT_NOTIFY_PREFS;
    const q = (v.quiet ?? {}) as Record<string, unknown>;
    return {
      success: mode(v.success, "always"), info: mode(v.info, "always"), error: mode(v.error, "always"),
      quiet: {
        on: q.on === true,
        from: typeof q.from === "string" && TIME_RE.test(q.from) ? q.from : DEFAULT_NOTIFY_PREFS.quiet.from,
        to: typeof q.to === "string" && TIME_RE.test(q.to) ? q.to : DEFAULT_NOTIFY_PREFS.quiet.to,
      },
    };
  } catch { return DEFAULT_NOTIFY_PREFS; }
}

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** 静かな時間帯か (日をまたぐ範囲 22:00〜07:00 も扱う。始まりと終わりが同じなら、一日中) */
export function inQuietHours(q: QuietHours, now: Date): boolean {
  if (!q.on) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = minutes(q.from);
  const to = minutes(q.to);
  if (from === to) return true;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

/**
 * 通知を、画面に出す (show)・まとめる (batch)・出さない (hide) のどれにするか。
 * 静かな時間帯は、保存・お知らせを出さない。失敗は、静かな時間帯でも、選んだ受け取り方のまま (出さないを選んでいなければ出る)。
 */
export function decideToast(prefs: NotifyPrefs, kind: ToastKind, now: Date): "show" | "batch" | "hide" {
  const m = prefs[kind];
  if (m === "off") return "hide";
  if (kind !== "error" && inQuietHours(prefs.quiet, now)) return "hide";
  return m === "batch" ? "batch" : "show";
}

// ── 保存と購読 ─────────────────────────────────────────────
const listeners = new Set<() => void>();
let current: NotifyPrefs | null = null;

export function getNotifyPrefs(): NotifyPrefs {
  if (!current) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* 読めなければ既定 */ }
    current = parseNotifyPrefs(raw);
  }
  return current;
}

export function setNotifyPrefs(patch: Partial<NotifyPrefs>): void {
  current = { ...getNotifyPrefs(), ...patch };
  try {
    if (JSON.stringify(current) === JSON.stringify(DEFAULT_NOTIFY_PREFS)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

/** テスト用: 読み込み済みの値を捨てる */
export function _resetNotifyPrefs(): void { current = null; listeners.forEach((l) => l()); }

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useNotifyPrefs = (): NotifyPrefs => useSyncExternalStore(subscribe, getNotifyPrefs, getNotifyPrefs);
