/**
 * Redirect 無限ループ防止 circuit breaker (#748 follow-up)
 *
 * AppShell の useEffect 群 (URL → タブ / タブ → URL / workspace ガード / fallbackToDashboard)
 * 同士が想定外の状況で navigate を撃ち合うと、無限ループ → backend RPC storm になる。
 * 全ての navigate 経路でこの guard を通し、短時間に閾値超のリダイレクトを検出したら
 * 強制停止する (= バグの早期発覚 + サーバ保護)。
 */

import { uiLog } from "./uiLog";

interface RedirectEvent {
  ts: number;
  path: string;
}

const WINDOW_MS = 2000;
const MAX_REDIRECTS = 20;

let recent: RedirectEvent[] = [];
let tripped = false;
let lastTripSummary: string[] = [];

type TripListener = (summary: string[]) => void;
const tripListeners = new Set<TripListener>();

/** trip 発生時に呼ばれるコールバックを登録する。React 側でモーダル表示等に使う。 */
export function subscribeRedirectGuardTrip(cb: TripListener): () => void {
  tripListeners.add(cb);
  // 既に trip 済なら即時通知 (購読タイミング後勝ち)
  if (tripped) cb(lastTripSummary);
  return () => { tripListeners.delete(cb); };
}

export interface GuardResult {
  /** redirect を許可してよいか */
  allow: boolean;
  /** circuit breaker が今回 trip したか (= 直前で許容、本回が初回 block) */
  tripped: boolean;
  /** 最近 window 内の redirect 件数 */
  recentCount: number;
}

/**
 * navigate を撃つ前に呼び出す。allow=false の時は navigate を skip すること。
 *
 * @param path 遷移先パス (デバッグ表示用)
 */
export function checkRedirect(path: string): GuardResult {
  const now = Date.now();
  // 古いイベントを削除
  recent = recent.filter((e) => now - e.ts < WINDOW_MS);
  recent.push({ ts: now, path });

  if (tripped) {
    return { allow: false, tripped: false, recentCount: recent.length };
  }

  if (recent.length > MAX_REDIRECTS) {
    tripped = true;
    const summary = recent.map((e) => e.path).slice(-10);
    lastTripSummary = summary;
    uiLog("error", "guard", "redirect storm detected — blocking further navigation", {
      count: recent.length,
      windowMs: WINDOW_MS,
      lastPaths: summary,
    });
    // listener 通知 (UI モーダル表示等)
    tripListeners.forEach((cb) => {
      try { cb(summary); } catch (e) { console.error("[redirectGuard] listener threw:", e); }
    });
    return { allow: false, tripped: true, recentCount: recent.length };
  }

  uiLog("debug", "redirect", path, { recent: recent.length });
  return { allow: true, tripped: false, recentCount: recent.length };
}

/** circuit breaker の現在状態 (UI からエラー表示用) */
export function isRedirectGuardTripped(): boolean {
  return tripped;
}

/** 主にテスト用: state をリセット */
export function resetRedirectGuard(): void {
  recent = [];
  tripped = false;
  lastTripSummary = [];
}

/** 直近 trip の path 列 (バナー表示用) */
export function getLastTripSummary(): readonly string[] {
  return lastTripSummary;
}
