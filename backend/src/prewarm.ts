/**
 * 起動後 (ワークスペースを最初に開いたあと) の、重い読み出しの先読み。
 *
 * 設計書の入力・スキーマ違反の検査・ファイルの健全性・本文検索の索引は、最初の 1 回 (約 600 件で 1〜2 秒) が重く、
 * 以降はファイルが変わるまで使い回す (dataSignature / fileMemo)。利用者が設計書や検索を開く前に、あいたところで計算しておく。
 * 計算は await のたびにイベントループへ戻る (実測: 約 600 件の同時計算で、最大の停止 75 ms) ので、画面の操作を止めない。
 * 失敗しても、何もしない (先読みなので)。ワークスペースごとに、プロセスで 1 回だけ。
 */
import { loadDesignInputFromRoot } from "./designInput.js";
import { collectExtraIssues } from "./schemaIssues.js";
import { searchDesign } from "./designSearch.js";
import { logInfo } from "./serverLog.js";

const done = new Set<string>();
export const PREWARM_DELAY_MS = 400;

export function schedulePrewarm(root: string, delayMs = PREWARM_DELAY_MS): void {
  if (done.has(root) || process.env.HARMONY_NO_PREWARM === "1") return;
  done.add(root);
  const timer = setTimeout(() => {
    const t0 = Date.now();
    Promise.allSettled([loadDesignInputFromRoot(root), collectExtraIssues(root), searchDesign(root, "", 1, true)])
      .then(() => logInfo("prewarm", "prewarm.done", { ms: Date.now() - t0 }));
  }, delayMs);
  timer.unref();
}

export function _resetPrewarmForTest(): void { done.clear(); }
