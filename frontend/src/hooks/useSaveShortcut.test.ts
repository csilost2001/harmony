import { describe, it, expect } from "vitest";
import { shouldTriggerSaveShortcut } from "./useSaveShortcut";

function makeEvent(overrides: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  key?: string;
  targetTag?: string;
  isContentEditable?: boolean;
}) {
  const target = overrides.targetTag
    ? ({ tagName: overrides.targetTag, isContentEditable: overrides.isContentEditable ?? false } as unknown as HTMLElement)
    : null;
  return {
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    key: overrides.key ?? "s",
    target,
  } as const;
}

describe("shouldTriggerSaveShortcut", () => {
  it("Ctrl+S で true を返す", () => {
    expect(shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s" }))).toBe(true);
  });

  it("Cmd+S（metaKey）で true を返す", () => {
    expect(shouldTriggerSaveShortcut(makeEvent({ metaKey: true, key: "s" }))).toBe(true);
  });

  it("修飾キーなしの s では false を返す", () => {
    expect(shouldTriggerSaveShortcut(makeEvent({ key: "s" }))).toBe(false);
  });

  it("Ctrl+他キー では false を返す", () => {
    expect(shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "a" }))).toBe(false);
    expect(shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "S" }))).toBe(false);
  });

  it("INPUT にフォーカスがあるとき false を返す", () => {
    expect(
      shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s", targetTag: "INPUT" })),
    ).toBe(false);
  });

  it("TEXTAREA にフォーカスがあるとき false を返す", () => {
    expect(
      shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s", targetTag: "TEXTAREA" })),
    ).toBe(false);
  });

  it("SELECT にフォーカスがあるとき false を返す", () => {
    expect(
      shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s", targetTag: "SELECT" })),
    ).toBe(false);
  });

  it("contentEditable 要素にフォーカスがあるとき false を返す", () => {
    expect(
      shouldTriggerSaveShortcut(
        makeEvent({ ctrlKey: true, key: "s", targetTag: "DIV", isContentEditable: true }),
      ),
    ).toBe(false);
  });

  it("allowInForm=true のとき INPUT でも true を返す", () => {
    expect(
      shouldTriggerSaveShortcut(
        makeEvent({ ctrlKey: true, key: "s", targetTag: "INPUT" }),
        true,
      ),
    ).toBe(true);
  });

  it("target が null（body 等）のとき true を返す", () => {
    expect(shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s" }))).toBe(true);
  });

  it("BUTTON にフォーカス中は true を返す（フォーム要素外）", () => {
    expect(
      shouldTriggerSaveShortcut(makeEvent({ ctrlKey: true, key: "s", targetTag: "BUTTON" })),
    ).toBe(true);
  });
});
