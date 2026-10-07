import { describe, it, expect, beforeEach } from "vitest";
import { initAppTheme, setAppThemePref, getAppThemePref, resolveTheme } from "./appTheme";

describe("appTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("保存値がなければ system を既定にし data-theme を設定する", () => {
    initAppTheme();
    expect(getAppThemePref()).toBe("system");
    expect(["light", "dark"]).toContain(document.documentElement.dataset.theme);
  });

  it("明示指定を保存して data-theme に反映する", () => {
    initAppTheme();
    setAppThemePref("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("harmony.appTheme")).toBe("dark");
    setAppThemePref("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("保存済みの設定を起動時に復元する", () => {
    localStorage.setItem("harmony.appTheme", "dark");
    initAppTheme();
    expect(getAppThemePref()).toBe("dark");
    expect(resolveTheme("dark")).toBe("dark");
  });
});
