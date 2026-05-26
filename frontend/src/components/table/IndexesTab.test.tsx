/**
 * IndexesTab — rendering smoke (#1146)
 *
 * empty 状態 / 既存 index 表示 / index 追加トリガーの基本パスを検証。
 * tableStore の addIndex / removeIndex は pure function なので mock 不要。
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { IndexesTab } from "./IndexesTab";
import type {
  Table,
  Index,
  TableId,
  Uuid,
  LocalId,
  PhysicalName,
  DisplayName,
  Timestamp,
} from "../../types/v3";

function makeTable(over: Partial<Table> = {}): Table {
  return {
    id: "table-users" as TableId,
    uuid: "11111111-1111-4111-8111-111111111111" as Uuid,
    name: "Users" as DisplayName,
    physicalName: "users" as PhysicalName,
    columns: [],
    createdAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    updatedAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    ...over,
  };
}

function makeIndex(over: Record<string, unknown> = {}): Index {
  return ({
    id: "idx-1",
    physicalName: "idx_users_email" as PhysicalName,
    columns: [{ columnId: "c1" as LocalId, order: "asc" }],
    ...over,
  } as unknown) as Index;
}

describe("IndexesTab", () => {
  it("shows empty state when there are no indexes", () => {
    const { container } = render(
      <IndexesTab table={makeTable()} update={vi.fn()} />,
    );

    expect(container.querySelector(".indexes-empty2")).not.toBeNull();
    expect(container.textContent).toContain("インデックスがまだありません");
  });

  it("renders index list with count", () => {
    const table = makeTable({
      indexes: [
        makeIndex({ id: "idx-1", physicalName: "idx_users_email" as PhysicalName }),
        makeIndex({ id: "idx-2", physicalName: "idx_users_name" as PhysicalName }),
      ],
    });
    const { container } = render(<IndexesTab table={table} update={vi.fn()} />);

    expect(container.querySelector(".indexes-empty2")).toBeNull();
    expect(container.textContent).toContain("2 件");
    const rows = container.querySelectorAll(".index-row2");
    expect(rows.length).toBe(2);
  });

  it("displays UNIQUE badge when index is unique", () => {
    const table = makeTable({
      indexes: [makeIndex({ unique: true })],
    });
    const { container } = render(<IndexesTab table={table} update={vi.fn()} />);

    expect(container.querySelector(".index-unique-badge")?.textContent).toBe("UNIQUE");
  });

  it("displays method badge for non-default method", () => {
    const table = makeTable({
      indexes: [makeIndex({ method: "gin" })],
    });
    const { container } = render(<IndexesTab table={table} update={vi.fn()} />);

    expect(container.querySelector(".index-method-badge")?.textContent).toBe("GIN");
  });

  it("invokes update callback when 追加 button is clicked", () => {
    const updateFn = vi.fn();
    const { container } = render(<IndexesTab table={makeTable()} update={updateFn} />);

    const addBtn = container.querySelector<HTMLButtonElement>(".indexes-toolbar2 .tbl-btn-primary");
    expect(addBtn).not.toBeNull();
    fireEvent.click(addBtn!);

    expect(updateFn).toHaveBeenCalledTimes(1);
  });
});
