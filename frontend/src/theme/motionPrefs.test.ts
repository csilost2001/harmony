import { describe, it, expect, beforeEach } from "vitest";
import { getMotionPref, initMotionPrefs, motionMs, parseMotionPref, prefersReducedMotion, setMotionPref } from "./motionPrefs";

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-motion"); setMotionPref("auto"); });

describe("motionPrefs (続編 第 10 弾 #184)", () => {
  it("保存値を読む。知らない値は auto", () => {
    expect(parseMotionPref("reduced")).toBe("reduced");
    expect(parseMotionPref("full")).toBe("full");
    expect(parseMotionPref("zzz")).toBe("auto");
    expect(parseMotionPref(null)).toBe("auto");
  });
  it("減らす: html に data-motion が付き、補間の長さが 0 になる。減らさない: 0 にならない", () => {
    setMotionPref("reduced");
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
    expect(prefersReducedMotion()).toBe(true);
    expect(motionMs(200)).toBe(0);
    setMotionPref("full");
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(200)).toBe(200);
  });
  it("auto は OS の設定に従う (matchMedia)。属性は付けない", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      setMotionPref("auto");
      expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
      expect(prefersReducedMotion()).toBe(true);
      expect(motionMs(150)).toBe(0);
    } finally { window.matchMedia = orig; }
  });
  it("保存して、起動時に読み直せる。auto に戻すと保存を消す", () => {
    setMotionPref("reduced");
    expect(localStorage.getItem("harmony.motion")).toBe("reduced");
    setMotionPref("auto");
    initMotionPrefs();
    expect(getMotionPref()).toBe("auto");
    expect(localStorage.getItem("harmony.motion")).toBeNull();
    localStorage.setItem("harmony.motion", "reduced");
    initMotionPrefs();
    expect(getMotionPref()).toBe("reduced");
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
  });
});
