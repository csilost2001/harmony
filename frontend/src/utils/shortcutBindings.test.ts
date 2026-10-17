import { describe, it, expect, beforeEach } from "vitest";
import { BINDABLE_SHORTCUTS, _resetBindings, comboOfEvent, defaultCombo, effectiveCombo, matchesBinding, normalizeCombo, resetBinding, setBinding, validateBinding } from "./shortcutBindings";
import { SHORTCUT_GROUPS } from "./shortcuts";

beforeEach(() => { localStorage.clear(); _resetBindings(); });
const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe("normalizeCombo / comboOfEvent (続編 第 10 弾 #188)", () => {
  it("大文字小文字・修飾キーの順・別名をそろえる", () => {
    expect(normalizeCombo("ctrl+alt+l")).toBe("Ctrl+Alt+L");
    expect(normalizeCombo("Shift+Ctrl+h")).toBe("Ctrl+Shift+H");
    expect(normalizeCombo("cmd+k")).toBe("Ctrl+K");
    expect(normalizeCombo("Ctrl+ArrowLeft")).toBe("Ctrl+Left");
    expect(normalizeCombo("ctrl+backspace")).toBe("Ctrl+Backspace");
  });
  it("読めないもの (空・修飾キーだけ・知らない修飾) は null", () => {
    expect(normalizeCombo("")).toBeNull();
    expect(normalizeCombo("Ctrl+Alt")).toBeNull();
    expect(normalizeCombo("Hyper+X")).toBeNull();
  });
  it("イベントを組み合わせにする。修飾キーだけは null。Mac の Cmd は Ctrl として扱う", () => {
    expect(comboOfEvent(ev("l", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+L");
    expect(comboOfEvent(ev("H", { metaKey: true, shiftKey: true }))).toBe("Ctrl+Shift+H");
    expect(comboOfEvent(ev("Control", { ctrlKey: true }))).toBeNull();
    expect(comboOfEvent(ev("Backspace", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+Backspace");
  });
});

describe("validateBinding", () => {
  it("使えるキー・修飾キーなし・Shift だけ・固定のキー・割り当て済みを、見分ける", () => {
    expect(validateBinding("copyLink", "Ctrl+Alt+J")).toEqual({ ok: true, combo: "Ctrl+Alt+J" });
    expect(validateBinding("copyLink", "F9")).toEqual({ ok: true, combo: "F9" });
    expect(validateBinding("copyLink", "J")).toMatchObject({ ok: false });
    expect(validateBinding("copyLink", "Shift+J")).toMatchObject({ ok: false });
    expect(validateBinding("copyLink", "Ctrl+S")).toMatchObject({ ok: false, error: expect.stringContaining("固定のキー") });
    expect(validateBinding("copyLink", "Ctrl+Alt+F")).toMatchObject({ ok: false, error: expect.stringContaining("入力専用モード") });
    expect(validateBinding("copyLink", "Ctrl+Alt+L")).toMatchObject({ ok: true }); // 自分自身の既定は使える
  });
  it("台帳の既定のキーは、固定のキーと重ならず、台帳の中でも重ならない", () => {
    const combos = BINDABLE_SHORTCUTS.map((b) => b.default);
    expect(new Set(combos).size).toBe(combos.length);
    for (const b of BINDABLE_SHORTCUTS) expect(validateBinding(b.id, b.default)).toMatchObject({ ok: true });
  });
});

describe("割り当ての保存", () => {
  it("変えると、そのキーで反応し、既定のキーでは反応しない。既定に戻せる", () => {
    expect(effectiveCombo("lastEdit")).toBe("Ctrl+Alt+Backspace");
    expect(setBinding("lastEdit", "ctrl+alt+j")).toEqual({ ok: true, combo: "Ctrl+Alt+J" });
    expect(matchesBinding(ev("j", { ctrlKey: true, altKey: true }), "lastEdit")).toBe(true);
    expect(matchesBinding(ev("Backspace", { ctrlKey: true, altKey: true }), "lastEdit")).toBe(false);
    resetBinding("lastEdit");
    expect(matchesBinding(ev("Backspace", { ctrlKey: true, altKey: true }), "lastEdit")).toBe(true);
    expect(localStorage.getItem("harmony.shortcuts")).toBeNull();
  });
  it("使えないキーは、理由を返して、変えない。ほかへ割り当て済みのキーも断る", () => {
    expect(setBinding("lastEdit", "Ctrl+Z")).toMatchObject({ ok: false });
    expect(effectiveCombo("lastEdit")).toBe(defaultCombo("lastEdit"));
    setBinding("lastEdit", "Ctrl+Alt+J");
    expect(setBinding("copyLink", "Ctrl+Alt+J")).toMatchObject({ ok: false, error: expect.stringContaining("最後に編集した場所") });
  });
  it("保存して、読み直せる。壊れた保存・知らない id・使えないキーは捨てる", () => {
    setBinding("replace", "Ctrl+Alt+H");
    _resetBindings();
    expect(effectiveCombo("replace")).toBe("Ctrl+Alt+H");
    localStorage.setItem("harmony.shortcuts", JSON.stringify({ replace: "???", zzz: "Ctrl+Alt+Q", copyLink: 5 }));
    _resetBindings();
    expect(effectiveCombo("replace")).toBe("Ctrl+Shift+H");
    localStorage.setItem("harmony.shortcuts", "{broken");
    _resetBindings();
    expect(effectiveCombo("copyLink")).toBe("Ctrl+Alt+L");
  });
});

describe("ヘルプの一覧との整合", () => {
  it("台帳の既定のキーは、ショートカット一覧に載っている", () => {
    const listed = new Set(SHORTCUT_GROUPS.flatMap((g) => g.entries).map((e) => e.keys.join("+")));
    expect(BINDABLE_SHORTCUTS.filter((b) => !listed.has(b.default)).map((b) => b.id)).toEqual([]);
  });
});
