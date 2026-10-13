/**
 * 画面 (遅延読み込みのチャンク) の取得に失敗したとき、1 回だけ再読み込みする。
 *
 * 更新のあと、開いたままのタブが古いチャンクの名前 (ハッシュ) を指すと、404 で画面が開けない。
 * 再読み込みで、新しい入口を読み直せば直る。無限に再読み込みしないよう、直近 10 秒以内に再読み込みしていたら、何もしない
 * (そのときは、通常のエラー画面になる)。
 */
const KEY = "harmony.preloadErrorReloadAt";
const WINDOW_MS = 10_000;

export function shouldReloadOnPreloadError(now: number, last: number | null): boolean {
  return last === null || !(now - last < WINDOW_MS);
}

export function installPreloadErrorReload(target: Pick<Window, "addEventListener"> = window, reload: () => void = () => window.location.reload()): void {
  target.addEventListener("vite:preloadError", (event) => {
    let last: number | null = null;
    try { const v = sessionStorage.getItem(KEY); last = v ? Number(v) : null; } catch { /* sessionStorage が使えなくても、再読み込みは 1 回試みる */ }
    const now = Date.now();
    if (!shouldReloadOnPreloadError(now, last)) return;
    try { sessionStorage.setItem(KEY, String(now)); } catch { /* 同上 */ }
    event.preventDefault();
    reload();
  });
}
