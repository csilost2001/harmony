import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColumnGrid } from "./ColumnGrid";
import type { Column } from "../../types/v3";

const cols = (): Column[] => [
  { id: "col-01", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true },
  { id: "col-02", no: 2, physicalName: "customer_name", name: "顧客名", dataType: "VARCHAR", length: 100 },
] as unknown as Column[];

function setup(over: Partial<React.ComponentProps<typeof ColumnGrid>> = {}) {
  const onUpdateColumn = vi.fn();
  const onAppend = vi.fn();
  const r = render(<ColumnGrid columns={cols()} readonly={false} onUpdateColumn={onUpdateColumn} onAppend={onAppend} {...over} />);
  return { onUpdateColumn, onAppend, ...r };
}

describe("ColumnGrid (表で編集)", () => {
  it("文字のセルは、セルを出るときに 1 回だけ反映する。変えなければ反映しない", () => {
    const { onUpdateColumn } = setup();
    const input = screen.getByLabelText("2 行目の表示名") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "取引先名" } });
    expect(onUpdateColumn).not.toHaveBeenCalled(); // 入力中は反映しない (1 文字ずつ履歴にしない)
    fireEvent.blur(input);
    expect(onUpdateColumn).toHaveBeenCalledTimes(1);
    expect(onUpdateColumn).toHaveBeenCalledWith("col-02", { name: "取引先名" });
    onUpdateColumn.mockClear();
    const same = screen.getByLabelText("1 行目の物理名");
    fireEvent.blur(same);
    expect(onUpdateColumn).not.toHaveBeenCalled();
  });

  it("備考・デフォルトを空にすると、値を消す (undefined)。長さは数値、空なら消す", () => {
    const { onUpdateColumn } = setup();
    const memo = screen.getByLabelText("customer_nameの備考") as HTMLInputElement;
    fireEvent.change(memo, { target: { value: "メモ" } });
    fireEvent.blur(memo);
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { comment: "メモ" });
    const len = screen.getByLabelText("customer_nameの長さ") as HTMLInputElement;
    fireEvent.change(len, { target: { value: "255" } });
    fireEvent.blur(len);
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { length: 255 });
    const len2 = screen.getByLabelText("customer_nameの長さ") as HTMLInputElement;
    fireEvent.change(len2, { target: { value: "" } });
    fireEvent.blur(len2);
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { length: undefined });
  });

  it("データ型・チェックは、すぐ反映する。主キーをつけると NOT NULL もつく。長さの無い型では、長さのセルは使えない", () => {
    const { onUpdateColumn } = setup();
    fireEvent.change(screen.getByLabelText("customer_nameのデータ型"), { target: { value: "TEXT" } });
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { dataType: "TEXT" });
    fireEvent.click(screen.getByLabelText("customer_nameの主キー"));
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { primaryKey: true, notNull: true });
    fireEvent.click(screen.getByLabelText("customer_nameのユニーク"));
    expect(onUpdateColumn).toHaveBeenLastCalledWith("col-02", { unique: true });
    expect((screen.getByLabelText("idの長さ") as HTMLInputElement).disabled).toBe(true); // BIGINT
    expect((screen.getByLabelText("customer_nameの長さ") as HTMLInputElement).disabled).toBe(false); // VARCHAR
  });

  it("Enter で下の行の同じ列へ移り、最後の行で値があれば、カラムを追加する", () => {
    const { onAppend } = setup();
    const first = screen.getByLabelText("1 行目の表示名") as HTMLInputElement;
    const second = screen.getByLabelText("2 行目の表示名") as HTMLInputElement;
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(onAppend).toHaveBeenCalledTimes(1);
  });

  it("閲覧のみのときは、セルを変えられず、Enter でも追加しない", () => {
    const { onUpdateColumn, onAppend } = setup({ readonly: true });
    const name = screen.getByLabelText("2 行目の表示名") as HTMLInputElement;
    expect(name.readOnly).toBe(true);
    fireEvent.change(name, { target: { value: "x" } });
    fireEvent.blur(name);
    expect(onUpdateColumn).not.toHaveBeenCalled();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onAppend).not.toHaveBeenCalled();
    expect((screen.getByLabelText("customer_nameのデータ型") as HTMLSelectElement).disabled).toBe(true);
  });
});
