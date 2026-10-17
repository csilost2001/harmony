import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_NOTIFY_PREFS, _resetNotifyPrefs, decideToast, getNotifyPrefs, inQuietHours, parseNotifyPrefs, setNotifyPrefs } from "./notifyPrefs";

const at = (h: number, m = 0) => new Date(2026, 9, 17, h, m);
beforeEach(() => { localStorage.clear(); _resetNotifyPrefs(); });

describe("inQuietHours", () => {
  const q = (from: string, to: string, on = true) => ({ on, from, to });
  it("日をまたぐ範囲 (22:00〜07:00)", () => {
    expect(inQuietHours(q("22:00", "07:00"), at(23))).toBe(true);
    expect(inQuietHours(q("22:00", "07:00"), at(6, 59))).toBe(true);
    expect(inQuietHours(q("22:00", "07:00"), at(7))).toBe(false);
    expect(inQuietHours(q("22:00", "07:00"), at(12))).toBe(false);
  });
  it("同じ日の範囲・同じ時刻 (一日中)・オフ", () => {
    expect(inQuietHours(q("12:00", "13:00"), at(12, 30))).toBe(true);
    expect(inQuietHours(q("12:00", "13:00"), at(13))).toBe(false);
    expect(inQuietHours(q("08:00", "08:00"), at(3))).toBe(true);
    expect(inQuietHours(q("22:00", "07:00", false), at(23))).toBe(false);
  });
});

describe("decideToast", () => {
  const p = (patch: object) => ({ ...DEFAULT_NOTIFY_PREFS, ...patch });
  it("既定はすべて出す。出さないは hide、まとめては batch", () => {
    expect(decideToast(DEFAULT_NOTIFY_PREFS, "success", at(12))).toBe("show");
    expect(decideToast(p({ info: "off" }), "info", at(12))).toBe("hide");
    expect(decideToast(p({ success: "batch" }), "success", at(12))).toBe("batch");
  });
  it("静かな時間帯は、保存・お知らせを出さない。失敗は出す (出さないを選んでいなければ)", () => {
    const quiet = p({ quiet: { on: true, from: "22:00", to: "07:00" } });
    expect(decideToast(quiet, "success", at(23))).toBe("hide");
    expect(decideToast(quiet, "info", at(23))).toBe("hide");
    expect(decideToast(quiet, "error", at(23))).toBe("show");
    expect(decideToast(p({ error: "off", quiet: quiet.quiet }), "error", at(23))).toBe("hide");
    expect(decideToast(quiet, "success", at(12))).toBe("show");
  });
});

describe("保存", () => {
  it("壊れた値・知らない値は既定に戻す", () => {
    expect(parseNotifyPrefs("{x")).toEqual(DEFAULT_NOTIFY_PREFS);
    expect(parseNotifyPrefs(JSON.stringify({ success: "zzz", quiet: { on: true, from: "25:00", to: "06:30" } }))).toEqual({ ...DEFAULT_NOTIFY_PREFS, quiet: { on: true, from: "22:00", to: "06:30" } });
  });
  it("設定を保存して、読み直せる。既定に戻すと保存を消す", () => {
    setNotifyPrefs({ info: "batch" });
    _resetNotifyPrefs();
    expect(getNotifyPrefs().info).toBe("batch");
    setNotifyPrefs({ info: "always" });
    expect(localStorage.getItem("harmony.notify")).toBeNull();
  });
});
