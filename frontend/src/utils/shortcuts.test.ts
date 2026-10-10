import { describe, it, expect } from "vitest";
import { SHORTCUT_GROUPS, shouldOpenShortcutHelp } from "./shortcuts";

const ev = (over: Partial<Parameters<typeof shouldOpenShortcutHelp>[0]> & { tag?: string }) => ({
  key: "?", ctrlKey: false, metaKey: false, altKey: false,
  target: { tagName: over.tag ?? "DIV", isContentEditable: false } as unknown as EventTarget,
  ...over,
});

describe("ショートカット一覧", () => {
  it("どの組にも項目があり、キーと説明が空でない", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.entries.length).toBeGreaterThan(0);
      for (const e of g.entries) { expect(e.keys.length).toBeGreaterThan(0); expect(e.label).not.toBe(""); }
    }
  });
});

describe("「?」でヘルプを開く条件", () => {
  it("ふつうの場所では開く", () => { expect(shouldOpenShortcutHelp(ev({}))).toBe(true); });
  it("入力欄・選択欄・テキスト領域・編集可能な領域では開かない (「?」を入力できるように)", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(shouldOpenShortcutHelp(ev({ tag }))).toBe(false);
    expect(shouldOpenShortcutHelp({ ...ev({}), target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget })).toBe(false);
  });
  it("Ctrl / Alt を伴うときと、別のキーでは開かない", () => {
    expect(shouldOpenShortcutHelp(ev({ ctrlKey: true }))).toBe(false);
    expect(shouldOpenShortcutHelp(ev({ altKey: true }))).toBe(false);
    expect(shouldOpenShortcutHelp(ev({ key: "/" }))).toBe(false);
  });
});
