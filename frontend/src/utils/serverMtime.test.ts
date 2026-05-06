import { describe, it, expect } from "vitest";
import {
  getLastSeenMtime,
  setLastSeenMtime,
  clearLastSeenMtime,
} from "./serverMtime";

describe("getLastSeenMtime / setLastSeenMtime / clearLastSeenMtime", () => {
  it("保存した mtime を取得できる", () => {
    setLastSeenMtime("table", "abc", 12345);
    expect(getLastSeenMtime("table", "abc")).toBe(12345);
  });

  it("id なし（project 等）の kind でも動作する", () => {
    setLastSeenMtime("project", undefined, 999);
    expect(getLastSeenMtime("project")).toBe(999);
  });

  it("未保存のキーは null を返す", () => {
    expect(getLastSeenMtime("table", "nonexistent")).toBeNull();
  });

  it("clearLastSeenMtime で削除できる", () => {
    setLastSeenMtime("table", "abc", 12345);
    clearLastSeenMtime("table", "abc");
    expect(getLastSeenMtime("table", "abc")).toBeNull();
  });

  it("kind と id が独立したキーに保存される", () => {
    setLastSeenMtime("table", "abc", 1);
    setLastSeenMtime("table", "def", 2);
    setLastSeenMtime("processFlow", "abc", 3);
    expect(getLastSeenMtime("table", "abc")).toBe(1);
    expect(getLastSeenMtime("table", "def")).toBe(2);
    expect(getLastSeenMtime("processFlow", "abc")).toBe(3);
  });

  it("上書き保存できる", () => {
    setLastSeenMtime("screen", "s1", 100);
    setLastSeenMtime("screen", "s1", 200);
    expect(getLastSeenMtime("screen", "s1")).toBe(200);
  });
});
