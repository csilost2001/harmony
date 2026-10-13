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
  return fn;
}
