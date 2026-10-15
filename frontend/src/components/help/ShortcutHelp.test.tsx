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
