/**
 * 同時に出た同じ読み出しを、1 回にまとめる。
 *
 * 1 つの画面を開くとき、パネル・エディタ・補完などが、それぞれ loadProject を呼ぶ (画面項目で 22 回など)。多くは同じ瞬間に出るので、
 * 読み出し (backend への問い合わせ) が終わるまでの間に来た呼び出しは、同じ結果を待たせる。終わったあとの呼び出しは、あらためて読む
 * (古い結果を使い回さない)。呼び出し側が結果を書き換えても、他の呼び出しに影響しないよう、結果は呼び出しごとに複製して返す。
 * 保存の前後で、保存前の読み出しの結果を返さないよう、保存のとき invalidate する。
 */
export interface SharedInflight<T> {
  (): Promise<T>;
  /** 進行中の読み出しを、これ以降の呼び出しでは使わない (保存のあと) */
  invalidate(): void;
}

const all = new Set<{ invalidate(): void }>();

/** 全部の進行中の読み出しを、これ以降の呼び出しでは使わない (書き込み系の RPC の成功後・サーバーの変更通知の受信時。改名・削除・MCP 経由の変更でも、古い結果に相乗りさせない) */
export function invalidateAllInflight(): void {
  for (const x of all) x.invalidate();
}

/** 読み出しだけの RPC か (それ以外は、書き込みとみなして、成功のあと全部を invalidate する。多めに無効にしても、読み直すだけで害は無い) */
export function isReadOnlyRpc(method: string): boolean {
  return /^(load|list|get|find|search|check|recent|read|scan|probe)|\.(list|get|read|fetch)[A-Za-z]*$/.test(method);
}

export function shareInflight<T>(load: () => Promise<T>): SharedInflight<T> {
  let current: Promise<T> | null = null;
  const fn = (() => {
    if (!current) {
      const p: Promise<T> = load().finally(() => { if (current === p) current = null; });
      current = p;
    }
    return current.then((v) => structuredClone(v));
  }) as SharedInflight<T>;
  fn.invalidate = () => { current = null; };
  all.add(fn);
  return fn;
}
