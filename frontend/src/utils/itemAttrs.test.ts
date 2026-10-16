import { describe, it, expect } from "vitest";
import type { ScreenItem } from "../types/v3/screen-item";
import { applyAttrs, captureAttrs, defaultPasteKeys, describeAttr, getAttrClipboard, setAttrClipboard } from "./itemAttrs";

const item = (over: Record<string, unknown> = {}) => ({ id: "a", label: "A", type: "string", ...over }) as unknown as ScreenItem;

describe("captureAttrs", () => {
  it("設定されている属性だけを取り出す。ID・表示名・紐づけは写さない", () => {
    const snap = captureAttrs(item({ required: true, maxLength: 20, pattern: "^[0-9]+$", placeholder: "", binding: { kind: "form" }, events: [{ id: "x" }] }));
    expect(snap).toEqual({ type: "string", required: true, maxLength: 20, pattern: "^[0-9]+$" });
  });
  it("値は複製して持つ (元の項目を後から変えても、影響しない)", () => {
    const src = item({ options: [{ value: "1", label: "一" }] });
    const snap = captureAttrs(src);
    (src as unknown as { options: Array<{ label: string }> }).options[0].label = "変更";
    expect((snap.options as Array<{ label: string }>)[0].label).toBe("一");
  });
});

describe("applyAttrs / defaultPasteKeys", () => {
  it("選んだ属性だけを貼る。元で未設定の属性は、貼り先でも未設定に戻す", () => {
    const snap = captureAttrs(item({ required: true, maxLength: 20 }));
    const target = item({ id: "b", label: "B", maxLength: 5, minLength: 2, readonly: true });
    const out = applyAttrs(target, snap, ["required", "maxLength", "minLength"]) as unknown as Record<string, unknown>;
    expect(out).toMatchObject({ id: "b", label: "B", required: true, maxLength: 20, readonly: true });
    expect("minLength" in out).toBe(false); // 元で未設定 → 貼り先も未設定
  });
  it("最初に印を付けるのは、元で設定している属性。「型」は、自分で選んだときだけ", () => {
    const snap = captureAttrs(item({ required: true, maxLength: 20 }));
    expect(defaultPasteKeys(snap).sort()).toEqual(["maxLength", "required"]);
    expect(applyAttrs(item({ type: "integer" }), snap, ["type"]).type).toBe("string");
  });
});

describe("describeAttr / 入れ物", () => {
  it("値を短い文にする", () => {
    expect(describeAttr("required", true)).toBe("する");
    expect(describeAttr("direction", "both")).toBe("入力・表示");
    expect(describeAttr("options", [1, 2, 3])).toBe("3 件");
    expect(describeAttr("pattern", "x".repeat(40))).toHaveLength(29);
    expect(describeAttr("min", undefined)).toBe("未設定");
  });
  it("アプリ内の入れ物に、コピーした属性を置く", () => {
    setAttrClipboard({ snapshot: { required: true }, sourceId: "a", sourceLabel: "A" });
    expect(getAttrClipboard()?.sourceId).toBe("a");
    setAttrClipboard(null);
    expect(getAttrClipboard()).toBeNull();
  });
});
