import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShortcutHelp } from "./ShortcutHelp";
import { relevantGroupTitles } from "../../utils/shortcuts";

describe("ShortcutHelp", () => {
  it("ボタンで開き、Esc と × で閉じる", () => {
    render(<ShortcutHelp />);
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    fireEvent.click(screen.getByTestId("shortcut-help-open"));
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
    expect(screen.getByText("画面・テーブル・処理フローなどを探して開く")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    fireEvent.click(screen.getByTestId("shortcut-help-open"));
    fireEvent.click(screen.getByLabelText("閉じる"));
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
  });

  it("「?」キーで開く。入力欄の中では開かない", () => {
    render(<><input data-testid="field" /><ShortcutHelp /></>);
    fireEvent.keyDown(screen.getByTestId("field"), { key: "?" });
    expect(screen.queryByTestId("shortcut-help")).toBeNull();
    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
  });

  it("開いている画面に関係するグループを先頭に出して開き、ほかは折りたたむ", () => {
    window.history.pushState({}, "", "/w/ws1/table/edit/orders");
    render(<ShortcutHelp />);
    fireEvent.click(screen.getByTestId("shortcut-help-open"));
    const open = screen.getAllByTestId("shortcut-group-open").map((d) => d.querySelector("h3")?.textContent ?? "");
    expect(open.some((t) => t.startsWith("表の入力"))).toBe(true);
    expect(open.some((t) => t.startsWith("編集中"))).toBe(true);
    expect(open.some((t) => t.startsWith("処理フロー"))).toBe(false);
    expect(screen.getAllByTestId("shortcut-group-closed").length).toBeGreaterThan(0);
    // 関係するものが先頭
    const first = screen.getByTestId("shortcut-help").querySelector("details");
    expect(first?.getAttribute("data-testid")).toBe("shortcut-group-open");
    window.history.pushState({}, "", "/");
  });
});

describe("relevantGroupTitles", () => {
  it("画面の経路ごとに、関係するグループを返す", () => {
    expect(relevantGroupTitles("/w/a/process-flow/edit/f1")).toEqual(expect.arrayContaining(["どこでも", "編集中", "処理フロー (工程の見出しにカーソルがあるとき)"]));
    expect(relevantGroupTitles("/w/a/screen/design/cart")).toContain("画面デザイナ");
    expect(relevantGroupTitles("/w/a/screen/items/cart").some((t) => t.startsWith("表の入力"))).toBe(true);
    expect(relevantGroupTitles("/w/a/table/list")).toContain("一覧 (画面・テーブル・処理フローなど)");
    expect(relevantGroupTitles("/w/a/table/er")).toContain("図 (ER 図・画面フロー)");
    expect(relevantGroupTitles("/w/a/screen/flow")).toContain("図 (ER 図・画面フロー)");
    expect(relevantGroupTitles("/w/a/")).toContain("ダッシュボード");
    expect(relevantGroupTitles("/w/a/")).not.toContain("編集中");
  });
});

describe("ヘルプの検索 (続編 第 10 弾 #189)", () => {
  it("語を入れると、項目のヘルプとショートカットから探した結果を出す。空に戻すと、グループの一覧に戻る", () => {
    window.history.pushState({}, "", "/w/ws1/table/edit/orders");
    render(<ShortcutHelp />);
    fireEvent.click(screen.getByTestId("shortcut-help-open"));
    expect(screen.getByTestId("help-here")).toBeTruthy(); // この画面 (テーブル) の項目のヘルプ
    fireEvent.change(screen.getByTestId("help-search"), { target: { value: "物理名" } });
    expect(screen.getAllByTestId("help-hit-topic")[0].textContent).toContain("物理名");
    expect(screen.queryByTestId("help-here")).toBeNull();
    fireEvent.change(screen.getByTestId("help-search"), { target: { value: "閉じたタブ" } });
    expect(screen.getAllByTestId("help-hit-shortcut").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByTestId("help-search"), { target: { value: "zzzz該当なし" } });
    expect(screen.getByTestId("help-hits").textContent).toContain("に合うヘルプ・ショートカットはありません");
    fireEvent.change(screen.getByTestId("help-search"), { target: { value: "" } });
    expect(screen.getAllByTestId("shortcut-group-open").length).toBeGreaterThan(0);
    window.history.pushState({}, "", "/");
  });
});

import { _resetBindings, effectiveCombo } from "../../utils/shortcutBindings";
describe("キーの割り当ての変更 (続編 第 10 弾 #188)", () => {
  it("「変える」→ 押したキーが割り当てになり、ヘルプの表示も変わる。使えないキーは理由を出す。既定に戻せる", () => {
    localStorage.clear(); _resetBindings();
    render(<ShortcutHelp />);
    fireEvent.click(screen.getByTestId("shortcut-help-open"));
    expect(screen.queryByTestId("shortcut-change-lastEdit")).toBeNull(); // 変える画面にしないと、ボタンは出ない
    fireEvent.click(screen.getByTestId("shortcut-edit-toggle"));
    // details が閉じていても、DOM にはある
    fireEvent.click(screen.getByTestId("shortcut-change-lastEdit"));
    expect(screen.getByTestId("shortcut-capture")).toBeTruthy();
    fireEvent.keyDown(document, { key: "z", ctrlKey: true }); // 固定のキー
    expect(screen.getByTestId("shortcut-bind-error").textContent).toContain("固定のキー");
    fireEvent.keyDown(document, { key: "j", ctrlKey: true, altKey: true });
    expect(effectiveCombo("lastEdit")).toBe("Ctrl+Alt+J");
    expect(screen.queryByTestId("shortcut-capture")).toBeNull();
    expect(screen.getByTestId("shortcut-row-lastEdit").textContent).toContain("J");
    expect(screen.getByTestId("shortcut-row-lastEdit").textContent).toContain("変更済み");
    fireEvent.click(screen.getByTestId("shortcut-reset-lastEdit"));
    expect(effectiveCombo("lastEdit")).toBe("Ctrl+Alt+Backspace");
    // 割り当ての待ちの Esc は、割り当てをやめるだけで、ヘルプは閉じない
    fireEvent.click(screen.getByTestId("shortcut-change-copyLink"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("shortcut-capture")).toBeNull();
    expect(screen.getByTestId("shortcut-help")).toBeTruthy();
    localStorage.clear(); _resetBindings();
  });
});
