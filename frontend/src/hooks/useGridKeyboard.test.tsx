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

import { useState } from "react";

function ControlledGrid({ calls }: { calls: { insert: (i: number) => void; dup: (i: number) => void; del: (i: number) => void } }) {
  const [rows, setRows] = useState([{ a: "x1", b: "y1" }, { a: "", b: "" }]);
  const { onKeyDown } = useGridKeyboard({
    onInsertRowBelow: (i) => calls.insert(i),
    onDuplicateRow: (i) => calls.dup(i),
    onDeleteRow: (i) => calls.del(i),
  });
  return (
    <table onKeyDown={onKeyDown}>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} data-grid-row={i}>
            <td><input data-testid={`a${i}`} value={r.a} onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))} /></td>
            <td>
              <select data-testid={`b${i}`} value={r.b} onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, b: e.target.value } : x)))}>
                <option value="">-</option><option value="y1">y1</option><option value="y2">y2</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("useGridKeyboard — 行の操作と下方向へのコピー", () => {
  const mk = () => ({ insert: vi.fn(), dup: vi.fn(), del: vi.fn() });

  it("Ctrl+D で、上の行の同じ列の値を写す (入力欄・選択欄とも、React の状態に反映される)", () => {
    const { getByTestId } = render(<ControlledGrid calls={mk()} />);
    fireEvent.keyDown(getByTestId("a1"), { key: "d", ctrlKey: true });
    expect((getByTestId("a1") as HTMLInputElement).value).toBe("x1");
    fireEvent.keyDown(getByTestId("b1"), { key: "d", ctrlKey: true });
    expect((getByTestId("b1") as HTMLSelectElement).value).toBe("y1");
  });

  it("先頭の行では、写す元が無いので何もしない (ブラウザのブックマークにも渡さない)", () => {
    const { getByTestId } = render(<ControlledGrid calls={mk()} />);
    const ev = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true, cancelable: true });
    getByTestId("a0").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((getByTestId("a0") as HTMLInputElement).value).toBe("x1");
  });

  it("Ctrl+Enter = 挿入、Ctrl+Shift+Enter = 複製、Alt+Delete = 削除。行の番号を渡す", () => {
    const calls = mk();
    const { getByTestId } = render(<ControlledGrid calls={calls} />);
    fireEvent.keyDown(getByTestId("a1"), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(getByTestId("a0"), { key: "Enter", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(getByTestId("a1"), { key: "Delete", altKey: true });
    expect(calls.insert).toHaveBeenCalledWith(1);
    expect(calls.dup).toHaveBeenCalledWith(0);
    expect(calls.del).toHaveBeenCalledWith(1);
    // ふつうの Enter / Delete では呼ばない
    fireEvent.keyDown(getByTestId("a1"), { key: "Delete" });
    expect(calls.del).toHaveBeenCalledTimes(1);
  });

  it("コールバックが無い表 (行の印も無い表) では、何もしない", () => {
    const { getByTestId } = render(<Grid />);
    const ev = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    getByTestId("r1c1").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
