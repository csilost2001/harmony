/**
 * OutputFields — rendering / kind 切替テスト (#1145 Phase-6)
 *
 * 出力設定 sub-form の 4 種 valueFrom kind 切替と各 binder 表示を検証。
 * Phase-6 で `internal/sections/OutputFields.tsx` に抽出 (screen-items/ test 0 件領域の補強)。
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { OutputFields } from "./OutputFields";
import type { ScreenItem, Table, View, FieldType } from "../../../../types/v3";

function makeItem(over: Partial<ScreenItem> = {}): ScreenItem {
  return {
    id: "field1",
    type: "string" as FieldType,
    label: "テスト",
    ...over,
  } as ScreenItem;
}

const tables: Table[] = [
  {
    id: "tbl1" as Table["id"],
    name: "Orders",
    physicalName: "orders",
    columns: [
      { id: "c1", physicalName: "order_id", name: "注文ID", type: "string" },
      { id: "c2", physicalName: "amount", name: "金額", type: "integer" },
    ] as Table["columns"],
  } as Table,
];

const views: View[] = [
  {
    id: "view1" as View["id"],
    name: "OrderSummary",
    outputColumns: [
      { physicalName: "order_id", name: "注文ID" },
      { physicalName: "total_amount", name: "合計" },
    ],
  } as View,
];

describe("OutputFields", () => {
  it("kind 未設定でも表示フォーマット欄が出る", () => {
    render(
      <OutputFields
        item={makeItem()}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    expect(screen.getByText("表示フォーマット")).toBeInTheDocument();
    expect(screen.getByText("バインド元 (種別)")).toBeInTheDocument();
  });

  it("flowVariable kind 選択で 処理フロー + 変数名 fields が出る", () => {
    render(
      <OutputFields
        item={makeItem({
          valueFrom: { kind: "flowVariable", variableName: "x" as never } as never,
        })}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    expect(screen.getByText("処理フロー")).toBeInTheDocument();
    expect(screen.getByText("変数名")).toBeInTheDocument();
  });

  it("tableColumn kind 選択で テーブル / 列 select が出る + テーブル名が option に列挙", () => {
    render(
      <OutputFields
        item={makeItem({
          valueFrom: {
            kind: "tableColumn",
            ref: { tableId: "tbl1" as never, columnId: "c1" as never },
          } as never,
        })}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    expect(screen.getByText("テーブル")).toBeInTheDocument();
    expect(screen.getByText("列")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Orders" })).toBeInTheDocument();
    // 列 select は selected table の columns が並ぶ
    expect(screen.getByRole("option", { name: "注文ID" })).toBeInTheDocument();
  });

  it("viewColumn kind 選択で ビュー / 列 select が出る + ビュー名が option に列挙", () => {
    render(
      <OutputFields
        item={makeItem({
          valueFrom: {
            kind: "viewColumn",
            ref: {
              viewId: "view1" as never,
              columnPhysicalName: "order_id" as never,
            },
          } as never,
        })}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    expect(screen.getByText("ビュー")).toBeInTheDocument();
    expect(screen.getByText("列 (物理名)")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OrderSummary" })).toBeInTheDocument();
  });

  it("expression kind 選択で 計算式 input が出る", () => {
    render(
      <OutputFields
        item={makeItem({
          valueFrom: { kind: "expression", expression: "@inputs.x" } as never,
        })}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    // 計算式 は option text と label text の両方に出るため getAllByText で確認
    expect(screen.getAllByText("計算式").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue("@inputs.x")).toBeInTheDocument();
  });

  it("kind select 変更 (空 → flowVariable) で onUpdate + onCommit が発火", () => {
    const onUpdate = vi.fn();
    const onCommit = vi.fn();
    render(
      <OutputFields
        item={makeItem()}
        idx={3}
        onUpdate={onUpdate}
        onCommit={onCommit}
        tables={tables}
        views={views}
      />,
    );
    const select = screen.getByDisplayValue("— 未設定 —");
    fireEvent.change(select, { target: { value: "expression" } });
    expect(onUpdate).toHaveBeenCalledWith(3, expect.objectContaining({
      valueFrom: expect.objectContaining({ kind: "expression" }),
    }));
    expect(onCommit).toHaveBeenCalled();
  });

  it("isReadonly=true で各 input/select が disabled", () => {
    render(
      <OutputFields
        item={makeItem()}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
        isReadonly
      />,
    );
    // 表示フォーマット input
    expect(screen.getByPlaceholderText("YYYY/MM/DD")).toBeDisabled();
    // kind select
    expect(screen.getByDisplayValue("— 未設定 —")).toBeDisabled();
  });

  it("displayFormat が item にあれば input value に反映される", () => {
    render(
      <OutputFields
        item={makeItem({ displayFormat: "YYYY-MM-DD" })}
        idx={0}
        onUpdate={vi.fn()}
        onCommit={vi.fn()}
        tables={tables}
        views={views}
      />,
    );
    expect(screen.getByDisplayValue("YYYY-MM-DD")).toBeInTheDocument();
  });
});
