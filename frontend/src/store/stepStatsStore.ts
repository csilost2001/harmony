/**
 * 工程の挿入メニューの「おすすめ」に使う統計 (全処理フローを 1 回の問い合わせで読んで数える)。
 * 開くたびに読み直さないよう、短い間は同じ結果を使い回す。
 */
import { loadAllProcessFlows } from "./processFlowStore";
import { buildTransitionStats, type TransitionStats } from "../utils/stepSuggestion";

const TTL_MS = 60_000;
let cache: { at: number; promise: Promise<TransitionStats> } | null = null;

export function loadStepTransitionStats(now = Date.now()): Promise<TransitionStats> {
  if (cache && now - cache.at < TTL_MS) return cache.promise;
  const promise = loadAllProcessFlows().then((all) => buildTransitionStats(all.values()));
  cache = { at: now, promise };
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

/** テスト用: 使い回しを捨てる */
export function resetStepStatsCache(): void {
  cache = null;
}
