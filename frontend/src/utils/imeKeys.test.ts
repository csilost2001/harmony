import { describe, it, expect } from "vitest";
import { isImeComposing, isPlainEnter } from "./imeKeys";

describe("imeKeys", () => {
  it("変換中 (isComposing / keyCode 229) を見分ける", () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
    expect(isImeComposing({ keyCode: 13 })).toBe(false);
  });

  it("Enter は変換中・Shift 付きでは true にならない", () => {
    expect(isPlainEnter({ key: "Enter" })).toBe(true);
    expect(isPlainEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(isPlainEnter({ key: "Enter", keyCode: 229 })).toBe(false);
    expect(isPlainEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isPlainEnter({ key: "a" })).toBe(false);
  });
});
