import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { SearchableSelect, filterOptions, type SelectOption } from "./SearchableSelect";

const many: SelectOption[] = Array.from({ length: 25 }, (_, i) => ({ value: `t${i}`, label: `テーブル${i}`, hint: `table_${i}` }));
many.push({ value: "customers", label: "顧客", hint: "customers" });
const few = many.slice(0, 3);

function Harness({ options, historyKey }: { options: SelectOption[]; historyKey?: string }) {
  const [v, setV] = useState("");
  return <><SearchableSelect value={v} onChange={setV} options={options} emptyLabel="（選択）" ariaLabel="テーブル" historyKey={historyKey} /><output data-testid="v">{v}</output></>;
}

describe("SearchableSelect", () => {
  beforeEach(() => localStorage.clear());

  it("候補が少なければ、ふつうの select", () => {
    render(<Harness options={few} />);
    expect(screen.getByRole("combobox")).toBeInstanceOf(HTMLSelectElement);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t1" } });
    expect(screen.getByTestId("v")).toHaveTextContent("t1");
  });

  it("候補が多ければ、打って絞り込み、Enter で決める", () => {
    render(<Harness options={many} />);
    const input = screen.getByRole("combobox");
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.focus(input);
    expect(screen.getAllByRole("option").length).toBe(many.length + 1); // 未選択 + 全部
    fireEvent.change(input, { target: { value: "こきゃく" } }); // かなでは当たらない (顧客は読みを持たない)
    expect(screen.queryAllByRole("option").length).toBe(0);
    fireEvent.change(input, { target: { value: "CUST" } }); // 補足の物理名・大文字小文字違い
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["顧客customers"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("v")).toHaveTextContent("customers");
    expect(input).toHaveValue("顧客（customers）");
  });

  it("↑↓ で選び、Esc で閉じる。日本語の変換中の Enter では決めない", () => {
    render(<Harness options={many} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "テーブル1" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(screen.getByTestId("v")).toHaveTextContent("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("v").textContent).toBe("t10"); // テーブル1 (t1) の次の前方一致 = テーブル10
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("未選択に戻せる", () => {
    render(<Harness options={many} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("顧客"));
    expect(screen.getByTestId("v")).toHaveTextContent("customers");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("（選択）"));
    expect(screen.getByTestId("v")).toHaveTextContent("");
  });

  it("選んだものは覚えて、次から上に出る (historyKey があるとき)", () => {
    const { unmount } = render(<Harness options={many} historyKey="table" />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByText("顧客"));
    unmount();
    render(<Harness options={many} historyKey="table" />);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")[1].textContent).toContain("顧客");
  });

  it("filterOptions: 前方一致が先。履歴が無ければ元の順", () => {
    expect(filterOptions(many, "table_1").map((o) => o.value).slice(0, 2)).toEqual(["t1", "t10"]);
    expect(filterOptions(many, "").length).toBe(many.length);
    const spy = vi.fn();
    spy(filterOptions(many, "zzz"));
    expect(spy).toHaveBeenCalledWith([]);
  });
});
