import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useGridKeyboard } from "./useGridKeyboard";

function Grid({ onAppendRow }: { onAppendRow?: () => void }) {
  const { onKeyDown } = useGridKeyboard({ onAppendRow });
  return (
    <table onKeyDown={onKeyDown}>
      <tbody>
        <tr><td><input type="checkbox" /></td><td><input data-testid="r1c1" defaultValue="a" /></td><td><input data-testid="r1c2" defaultValue="b" /></td></tr>
        <tr><td colSpan={3}>詳細の展開行 (欄なし)</td></tr>
        <tr><td><input type="checkbox" /></td><td><input data-testid="r2c1" defaultValue="c" /></td><td><input data-testid="r2c2" defaultValue="" /></td></tr>
      </tbody>
    </table>
  );
}

describe("useGridKeyboard", () => {
  it("Enter / Shift+Enter で同じ列の下・上の行へ (欄のない行は飛ばす)", () => {
    const { getByTestId } = render(<Grid />);
    getByTestId("r1c1").focus();
    fireEvent.keyDown(getByTestId("r1c1"), { key: "Enter" });
    expect(document.activeElement).toBe(getByTestId("r2c1"));
    fireEvent.keyDown(getByTestId("r2c1"), { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("r1c1"));
  });

  it("↑↓ でも移る", () => {
    const { getByTestId } = render(<Grid />);
    getByTestId("r1c2").focus();
    fireEvent.keyDown(getByTestId("r1c2"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByTestId("r2c2"));
    fireEvent.keyDown(getByTestId("r2c2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(getByTestId("r1c2"));
  });

  it("最後の行で値があれば Enter で行を追加、空なら追加しない", () => {
    const onAppendRow = vi.fn();
    const { getByTestId } = render(<Grid onAppendRow={onAppendRow} />);
    fireEvent.keyDown(getByTestId("r2c2"), { key: "Enter" });
    expect(onAppendRow).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId("r2c1"), { key: "Enter" });
    expect(onAppendRow).toHaveBeenCalledTimes(1);
  });

  it("部品が処理済みのキーと、変換中の Enter は無視する", () => {
    const { getByTestId } = render(<Grid />);
    getByTestId("r1c1").focus();
    fireEvent.keyDown(getByTestId("r1c1"), { key: "Enter", isComposing: true });
    expect(document.activeElement).toBe(getByTestId("r1c1"));
  });

  it("Esc で欄から出る", () => {
    const { getByTestId } = render(<Grid />);
    getByTestId("r1c1").focus();
    fireEvent.keyDown(getByTestId("r1c1"), { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });
});
