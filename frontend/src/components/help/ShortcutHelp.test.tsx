import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShortcutHelp } from "./ShortcutHelp";

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
});
