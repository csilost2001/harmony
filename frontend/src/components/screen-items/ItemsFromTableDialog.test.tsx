import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemsFromTableDialog } from "./ItemsFromTableDialog";
import type { Table } from "../../types/v3";

const tables = [
  {
    id: "customers", name: "顧客", physicalName: "customers",
    columns: [
      { id: "c1", physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", primaryKey: true, notNull: true, autoIncrement: true },
      { id: "c2", physicalName: "customer_name", name: "顧客名", dataType: "VARCHAR", length: 100, notNull: true },
      { id: "c3", physicalName: "photo", name: "写真", dataType: "BLOB" },
    ],
  },
  { id: "orders", name: "注文", physicalName: "orders", columns: [{ id: "o1", physicalName: "order_id", name: "注文ID", dataType: "BIGINT" }] },
] as unknown as Table[];

describe("ItemsFromTableDialog", () => {
  it("テーブルを選ぶと、カラムから項目の案を出し、追加で渡す (外したカラムは除く)", () => {
    const onApply = vi.fn();
    render(<ItemsFromTableDialog tables={tables} existingIds={[]} onApply={onApply} onClose={() => undefined} />);
    expect(screen.getByTestId("items-from-table-apply")).toBeDisabled();
    fireEvent.click(screen.getByTestId("items-from-table-pick-customers"));
    expect(screen.getByTestId("items-from-table-preview")).toHaveTextContent("customerName");
    expect(screen.getByTestId("items-from-table-preview")).toHaveTextContent("BLOB"); // 作れないカラムの案内
    fireEvent.click(screen.getByLabelText("顧客IDを作る")); // 外す
    expect(screen.getByTestId("items-from-table-apply")).toHaveTextContent("1 項目を追加");
    fireEvent.click(screen.getByTestId("items-from-table-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [items, name] = onApply.mock.calls[0];
    expect(name).toBe("顧客");
    expect(items.map((i: { id: string }) => i.id)).toEqual(["customerName"]);
  });

  it("テーブルを名前・物理名・かなの違いを無視して探せる / 既存の ID と重ならない", () => {
    render(<ItemsFromTableDialog tables={tables} existingIds={["customerName"]} onApply={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId("items-from-table-search"), { target: { value: "ORD" } });
    expect(screen.queryByTestId("items-from-table-pick-customers")).toBeNull();
    fireEvent.change(screen.getByTestId("items-from-table-search"), { target: { value: "cust" } });
    fireEvent.click(screen.getByTestId("items-from-table-pick-customers"));
    expect(screen.getByTestId("items-from-table-preview")).toHaveTextContent("customerName2");
  });
});
