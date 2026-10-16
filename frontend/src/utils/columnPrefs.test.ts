import { describe, it, expect, beforeEach } from "vitest";
import {
  applyColumnPrefs, clampWidth, emptyPrefs, isDefaultPrefs, loadColumnPrefs, moveColumn, moveColumnTo, saveColumnPrefs, setWidth, toggleHidden,
  MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH,
} from "./columnPrefs";

const cols = ["name", "type", "owner", "updated"].map((key) => ({ key }));
const keys = (cs: Array<{ key: string }>) => cs.map((c) => c.key);

beforeEach(() => window.localStorage.clear());

describe("applyColumnPrefs", () => {
  it("設定が無ければ、そのまま", () => {
    expect(keys(applyColumnPrefs(cols, emptyPrefs()))).toEqual(["name", "type", "owner", "updated"]);
  });
  it("並びを直し、隠した列を除く。並びに無い列 (あとから増えた列) は、後ろへ", () => {
    const p = { widths: {}, hidden: ["type"], order: ["updated", "name"] };
    expect(keys(applyColumnPrefs(cols, p))).toEqual(["updated", "name", "owner"]);
  });
  it("存在しない key の設定は無視する", () => {
    expect(keys(applyColumnPrefs(cols, { widths: {}, hidden: ["ghost"], order: ["ghost", "owner"] }))).toEqual(["owner", "name", "type", "updated"]);
  });
  it("すべて隠そうとしても、先頭の 1 列は残る", () => {
    expect(keys(applyColumnPrefs(cols, { widths: {}, hidden: cols.map((c) => c.key), order: [] }))).toEqual(["name"]);
  });
});

describe("並びの操作", () => {
  it("moveColumn は 1 つ前 / 後ろへ。端では動かない", () => {
    expect(moveColumn(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveColumn(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveColumn(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });
  it("moveColumnTo は、ドロップした列の位置へ", () => {
    expect(moveColumnTo(["a", "b", "c", "d"], "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(moveColumnTo(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveColumnTo(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
});

describe("toggleHidden / setWidth", () => {
  const all = ["a", "b"];
  it("隠す・戻す。最後の 1 列は隠せない", () => {
    const hidden = toggleHidden(emptyPrefs(), "a", all);
    expect(hidden.hidden).toEqual(["a"]);
    expect(toggleHidden(hidden, "b", all)).toBe(hidden); // 最後の 1 列
    expect(toggleHidden(hidden, "a", all).hidden).toEqual([]);
  });
  it("幅は範囲内に収め、null で自動に戻す", () => {
    expect(setWidth(emptyPrefs(), "a", 10).widths.a).toBe(MIN_COLUMN_WIDTH);
    expect(setWidth(emptyPrefs(), "a", 99999).widths.a).toBe(MAX_COLUMN_WIDTH);
    expect(setWidth(setWidth(emptyPrefs(), "a", 200), "a", null).widths).toEqual({});
    expect(clampWidth(120.4)).toBe(120);
  });
});

describe("保存と読み込み", () => {
  it("画面ごとに保存して、読み戻せる。既定に戻すと保存を消す", () => {
    const p = { widths: { name: 240 }, hidden: ["type"], order: ["owner", "name"] };
    saveColumnPrefs("screens", p);
    expect(loadColumnPrefs("screens")).toEqual(p);
    expect(loadColumnPrefs("tables")).toEqual(emptyPrefs());
    saveColumnPrefs("screens", emptyPrefs());
    expect(window.localStorage.getItem("harmony.listColumns.screens")).toBeNull();
    expect(isDefaultPrefs(loadColumnPrefs("screens"))).toBe(true);
  });
  it("壊れた値は、既定として扱う", () => {
    window.localStorage.setItem("harmony.listColumns.x", "{not json");
    expect(loadColumnPrefs("x")).toEqual(emptyPrefs());
    window.localStorage.setItem("harmony.listColumns.y", JSON.stringify({ widths: { a: "wide", b: 120 }, hidden: [1, "c"], order: "z" }));
    expect(loadColumnPrefs("y")).toEqual({ widths: { b: 120 }, hidden: ["c"], order: [] });
  });
});
