import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColumnDetailEditor } from "./TableEditor";
import type { Column } from "../../types/v3";

const col = { id: "col-01", physicalName: "new_column", name: "", dataType: "VARCHAR" } as unknown as Column;

describe("ColumnDetailEditor — 表示名の入力", () => {
  it("1 文字ずつの入力では物理名の提案を呼ばず、欄を出たとき (blur) に 1 回だけ呼ぶ", () => {
    const onUpdate = vi.fn(); const onNameCommit = vi.fn();
    render(<ColumnDetailEditor col={col} onUpdate={onUpdate} onNameCommit={onNameCommit} showLength={false} showScale={false} />);
    const name = screen.getByPlaceholderText("例: カラムの日本語名");
    for (const v of ["顧", "顧客", "顧客コ", "顧客コード"]) fireEvent.change(name, { target: { value: v } });
    expect(onUpdate).toHaveBeenCalledTimes(4);
    expect(onNameCommit).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(onNameCommit).toHaveBeenCalledTimes(1);
  });
});
