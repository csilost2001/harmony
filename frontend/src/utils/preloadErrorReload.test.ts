import { describe, it, expect, vi } from "vitest";
import { installPreloadErrorReload, shouldReloadOnPreloadError } from "./preloadErrorReload";

describe("preloadErrorReload", () => {
  it("直近 10 秒以内に再読み込みしていなければ再読み込みする (無限ループを避ける)", () => {
    expect(shouldReloadOnPreloadError(100_000, null)).toBe(true);
    expect(shouldReloadOnPreloadError(100_000, 95_000)).toBe(false);
    expect(shouldReloadOnPreloadError(100_000, 80_000)).toBe(true);
  });

  it("vite:preloadError で 1 回だけ再読み込みし、続けて起きても 2 回目はしない", () => {
    sessionStorage.clear();
    const target = new EventTarget();
    const reload = vi.fn();
    installPreloadErrorReload(target as unknown as Window, reload);
    target.dispatchEvent(new Event("vite:preloadError"));
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
