import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { shouldTriggerSaveShortcut, useSaveShortcut } from "./useSaveShortcut";

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

describe("useSaveShortcut (ダイアログの中)", () => {
  it("ダイアログの中で Ctrl+S を押しても、背後のエディタの保存は呼ばない (ブラウザの保存ダイアログも出さない)", () => {
    const onSave = vi.fn();
    renderHook(() => useSaveShortcut(onSave));
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    const input = document.createElement("textarea");
    modal.appendChild(input);
    document.body.appendChild(modal);
    const ev = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(onSave).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    // ダイアログの外では保存する
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onSave).toHaveBeenCalledTimes(1);
    modal.remove();
  });
});
