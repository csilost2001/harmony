import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DISPLAY_PREFS, getDisplayPrefs, initDisplayPrefs, parseDisplayPrefs, setDisplayPrefs } from "./displayPrefs";

const html = () => document.documentElement;
beforeEach(() => {
  localStorage.clear();
  for (const a of ["data-font-scale", "data-density", "data-contrast"]) html().removeAttribute(a);
  initDisplayPrefs();
});

describe("表示の設定", () => {
  it("標準では <html> に何も付けない", () => {
    expect(getDisplayPrefs()).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(html().hasAttribute("data-font-scale")).toBe(false);
    expect(html().hasAttribute("data-density")).toBe(false);
    expect(html().hasAttribute("data-contrast")).toBe(false);
  });

  it("選んだ値を <html> と保存先に反映し、標準へ戻すと保存も消える", () => {
    setDisplayPrefs({ fontScale: "large", density: "compact" });
    expect(html().getAttribute("data-font-scale")).toBe("large");
    expect(html().getAttribute("data-density")).toBe("compact");
    expect(JSON.parse(localStorage.getItem("harmony.display") ?? "{}")).toMatchObject({ fontScale: "large", density: "compact", contrast: "standard" });
    setDisplayPrefs({ contrast: "high" });
    expect(html().getAttribute("data-contrast")).toBe("high");
    expect(html().getAttribute("data-font-scale")).toBe("large"); // 一部だけ変えても、ほかは残る
    setDisplayPrefs(DEFAULT_DISPLAY_PREFS);
    expect(localStorage.getItem("harmony.display")).toBeNull();
    expect(html().hasAttribute("data-font-scale")).toBe(false);
  });

  it("起動時に保存値を復元する", () => {
    localStorage.setItem("harmony.display", JSON.stringify({ fontScale: "xlarge", density: "standard", contrast: "high" }));
    initDisplayPrefs();
    expect(getDisplayPrefs()).toEqual({ fontScale: "xlarge", density: "standard", contrast: "high" });
    expect(html().getAttribute("data-font-scale")).toBe("xlarge");
  });

  it("壊れた値・知らない値は既定に戻す (画面を壊さない)", () => {
    expect(parseDisplayPrefs("{broken")).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs("null")).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);
    expect(parseDisplayPrefs(JSON.stringify({ fontScale: "huge", density: 3, contrast: "high" }))).toEqual({ fontScale: "standard", density: "standard", contrast: "high" });
  });
});
