/**
 * 件数のある長い処理 (取り込みなど) を、1 件ずつ実行して、進み具合を知らせ、途中で中止できるようにする (UI 改善提案 続編 第 10 弾 #194)。画面に依存しない。
 * 中止しても、処理済みの件は元に戻さない (戻す仕組みは、処理ごとに別)。1 件の失敗は、数えて続ける (stopOnError で止めることもできる)。
 */
export interface BatchResult<T> {
  total: number;
  done: number;
  failed: Array<{ item: T; error: unknown }>;
  cancelled: boolean;
}

export interface BatchOptions {
  signal?: AbortSignal;
  /** 1 件終わるたびに (成功・失敗とも) 呼ぶ。引数: 終わった数・全体 */
  onProgress?: (finished: number, total: number) => void;
  stopOnError?: boolean;
}

export async function runBatch<T>(items: readonly T[], worker: (item: T, index: number) => Promise<void>, opts: BatchOptions = {}): Promise<BatchResult<T>> {
  const result: BatchResult<T> = { total: items.length, done: 0, failed: [], cancelled: false };
  let finished = 0;
  for (let i = 0; i < items.length; i++) {
    if (opts.signal?.aborted) { result.cancelled = true; break; }
    try {
      await worker(items[i], i);
      result.done++;
    } catch (error) {
      result.failed.push({ item: items[i], error });
      if (opts.stopOnError) { finished++; opts.onProgress?.(finished, items.length); break; }
    }
    finished++;
    opts.onProgress?.(finished, items.length);
  }
  return result;
}

/** 結果を、1 行の文にする。`past` は過去形 (例: 「取り込みました」)。例: 「10 件中 7 件を取り込みました (中止。処理済みの 7 件は残っています)」 */
export function batchSummary(r: BatchResult<unknown>, past: string): string {
  const parts = [r.cancelled ? `中止。処理済みの ${r.done} 件は残っています` : "", r.failed.length ? `${r.failed.length} 件は失敗しました` : ""].filter(Boolean);
  return `${r.total} 件中 ${r.done} 件を${past}${parts.length ? ` (${parts.join("。")})` : ""}`;
}
