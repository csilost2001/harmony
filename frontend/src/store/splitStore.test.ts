import { describe, it, expect, beforeEach } from "vitest";
import { _resetSplitCache, getSplit, parseSplit, setSplit } from "./splitStore";

beforeEach(() => { sessionStorage.clear(); _resetSplitCache(); });

describe("splitStore", () => {
  it("ワークスペースごとに、右に出す画面を持つ。読み直しても残り、閉じる (null) と消える", () => {
    setSplit("a", { path: "/table/edit/orders", label: "注文", tabId: "table:orders" });
    expect(getSplit("a")).toEqual({ path: "/table/edit/orders", label: "注文", tabId: "table:orders" });
    expect(getSplit("b")).toBeNull();
    _resetSplitCache();
    expect(getSplit("a")?.path).toBe("/table/edit/orders");
    setSplit("a", null);
    expect(getSplit("a")).toBeNull();
    expect(sessionStorage.getItem("harmony.split:a")).toBeNull();
  });

  it("壊れた保存値・外を指すパス・長すぎるパスは、なしとして読む", () => {
    expect(parseSplit("{broken")).toBeNull();
    expect(parseSplit(null)).toBeNull();
    expect(parseSplit(JSON.stringify({ path: "//evil.example/", label: "x" }))).toBeNull();
    expect(parseSplit(JSON.stringify({ path: "https://evil.example/", label: "x" }))).toBeNull();
    expect(parseSplit(JSON.stringify({ path: "/" + "a".repeat(2100), label: "x" }))).toBeNull();
    expect(parseSplit(JSON.stringify({ label: "x" }))).toBeNull();
  });

  it("呼び名が無ければパスを、長ければ切る。tabId が文字列でなければ null", () => {
    expect(parseSplit(JSON.stringify({ path: "/table/list" }))?.label).toBe("/table/list");
    expect(parseSplit(JSON.stringify({ path: "/x", label: "あ".repeat(200) }))?.label).toHaveLength(80);
    expect(parseSplit(JSON.stringify({ path: "/x", tabId: 5 }))?.tabId).toBeNull();
  });
});
