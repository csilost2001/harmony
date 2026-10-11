import { describe, it, expect, beforeEach } from "vitest";
import { getUserName, sanitizeUserName, setUserName } from "./userIdentity";

describe("userIdentity", () => {
  beforeEach(() => localStorage.clear());

  it("空白・制御文字・長すぎる名前を整える", () => {
    expect(sanitizeUserName("  山田\n 太郎  ")).toBe("山田 太郎");
    expect(sanitizeUserName("x".repeat(100))).toHaveLength(40);
  });

  it("AI の印 (@AI) は名乗れない", () => {
    expect(sanitizeUserName("Alice@AI")).toBe("Alice");
    expect(sanitizeUserName("@ai")).toBe("");
  });

  it("保存して読める。空にすると未設定に戻る", () => {
    expect(getUserName()).toBe("");
    expect(setUserName(" 山田 ")).toBe("山田");
    expect(getUserName()).toBe("山田");
    setUserName("");
    expect(getUserName()).toBe("");
    expect(localStorage.getItem("harmony.userName")).toBeNull();
  });
});
