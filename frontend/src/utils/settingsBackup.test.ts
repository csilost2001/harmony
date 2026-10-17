import { describe, it, expect, beforeEach } from "vitest";
import { MAX_VALUE_CHARS, applySettings, categoryOf, exportSettings, parseSettingsFile } from "./settingsBackup";

beforeEach(() => localStorage.clear());

describe("settingsBackup (続編 第 10 弾 #191)", () => {
  it("台帳に当てはまる設定だけを書き出す。トークン・タブ・下書き・見た版は出さない", () => {
    localStorage.setItem("harmony.display", '{"fontScale":"large"}');
    localStorage.setItem("harmony.notify", "{}");
    localStorage.setItem("harmony-favorites:retail", "[]");
    localStorage.setItem("harmony.listColumns.screens", "{}");
    localStorage.setItem("harmony.authToken", "SECRET");
    localStorage.setItem("harmony-open-tabs", "[]");
    localStorage.setItem("harmony.seenVersion", "1+a");
    localStorage.setItem("draft-table-orders", "{}");
    const f = exportSettings(localStorage, new Date("2026-10-17T00:00:00Z"));
    expect(Object.keys(f.items).sort()).toEqual(["harmony-favorites:retail", "harmony.display", "harmony.listColumns.screens", "harmony.notify"]);
    expect(f.exportedAt).toBe("2026-10-17T00:00:00.000Z");
    expect(JSON.stringify(f)).not.toContain("SECRET");
  });
  it("書き出したものを読み込める。種類ごとの数を出し、選んだ種類だけ書く", () => {
    localStorage.setItem("harmony.display", "D");
    localStorage.setItem("harmony.notify", "N");
    localStorage.setItem("harmony-snippets:retail", "S");
    const text = JSON.stringify(exportSettings(localStorage));
    localStorage.clear();
    const r = parseSettingsFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.preview.counts.map((c) => [c.category.id, c.keys.length])).toEqual([["display", 1], ["notify", 1], ["snippets", 1]]);
    const res = applySettings(localStorage, r.preview, new Set(["display", "snippets"]));
    expect(res).toEqual({ written: 2, failed: 0 });
    expect(localStorage.getItem("harmony.display")).toBe("D");
    expect(localStorage.getItem("harmony-snippets:retail")).toBe("S");
    expect(localStorage.getItem("harmony.notify")).toBeNull(); // 選ばなかった
  });
  it("台帳に無い項目 (トークンなど)・文字列でない値・大きすぎる値は、読み込まない (数える)", () => {
    const r = parseSettingsFile(JSON.stringify({ format: "harmony-settings", version: 1, exportedAt: "x", items: {
      "harmony.display": "ok", "harmony.authToken": "SECRET", "harmony.notify": 3, "harmony.motion": "x".repeat(MAX_VALUE_CHARS + 1), "evil": "y",
    } }));
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.preview.file.items)).toEqual(["harmony.display"]);
    expect(r.preview.skipped).toBe(4);
  });
  it("形が違うファイルは、理由つきで断る", () => {
    expect(parseSettingsFile("{x")).toMatchObject({ ok: false, error: "JSON として読めません" });
    expect(parseSettingsFile("[]")).toMatchObject({ ok: false });
    expect(parseSettingsFile(JSON.stringify({ format: "other", version: 1, items: {} }))).toMatchObject({ ok: false, error: "Harmony の設定のファイルではありません" });
    expect(parseSettingsFile(JSON.stringify({ format: "harmony-settings", version: 2, items: {} }))).toMatchObject({ ok: false });
    expect(parseSettingsFile(JSON.stringify({ format: "harmony-settings", version: 1 }))).toMatchObject({ ok: false });
  });
  it("書き込みに失敗した項目は、数えて続ける", () => {
    const r = parseSettingsFile(JSON.stringify({ format: "harmony-settings", version: 1, items: { "harmony.display": "a", "harmony.notify": "b" } }));
    if (!r.ok) throw new Error(r.error);
    let n = 0;
    const storage = { setItem: () => { if (n++ === 0) throw new Error("quota"); } };
    expect(applySettings(storage, r.preview, new Set(["display", "notify"]))).toEqual({ written: 1, failed: 1 });
  });
  it("categoryOf", () => {
    expect(categoryOf("harmony-personal-notes:retail")?.id).toBe("notes");
    expect(categoryOf("harmony.authToken")).toBeNull();
  });
});
