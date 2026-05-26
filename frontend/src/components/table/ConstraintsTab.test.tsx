/**
 * ConstraintsTab — rendering smoke (#1146)
 *
 * empty 状態 / unique / check / foreignKey の表示 / kindBadge & summary 出力を検証。
 * tableStore の addConstraint / removeConstraint は pure function、mock 不要。
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ConstraintsTab } from "./ConstraintsTab";
import type {
  Table,
  TableId,
  LocalId,
  PhysicalName,
  DisplayName,
  Timestamp,
  Constraint,
} from "../../types/v3";

const TABLE_A_ID = "users" as TableId;
const TABLE_B_ID = "orgs" as TableId;

function makeTable(over: Record<string, unknown> = {}): Table {
  return ({
    id: TABLE_A_ID,
    uuid: "11111111-1111-4111-8111-111111111111",
    name: "Users" as DisplayName,
    physicalName: "users" as PhysicalName,
    columns: [
      { id: "c1" as LocalId, physicalName: "id" as PhysicalName, name: "ID" as DisplayName, dataType: "INTEGER", primaryKey: true },
      { id: "c2" as LocalId, physicalName: "email" as PhysicalName, name: "Email" as DisplayName, dataType: "VARCHAR", length: 255 },
    ],
    createdAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    updatedAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    ...over,
  } as unknown) as Table;
}

describe("ConstraintsTab", () => {
  it("shows empty state when there are no constraints", () => {
    const { container } = render(
      <ConstraintsTab table={makeTable()} update={vi.fn()} allTables={[]} />,
    );

    expect(container.querySelector(".constraints-empty")).not.toBeNull();
    expect(container.textContent).toContain("制約がまだありません");
  });

  it("renders unique constraint summary", () => {
    const uniqueConstraint = ({
      id: "cn-1",
      kind: "unique",
      physicalName: "uq_users_email" as PhysicalName,
      columnIds: ["c2" as LocalId],
    } as unknown) as Constraint;
    const table = makeTable({ constraints: [uniqueConstraint] });
    const { container } = render(
      <ConstraintsTab table={table} update={vi.fn()} allTables={[]} />,
    );

    expect(container.textContent).toContain("UNIQUE");
    expect(container.textContent).toContain("email");
  });

  it("renders check constraint with expression", () => {
    const checkConstraint = ({
      id: "cn-2",
      kind: "check",
      physicalName: "ck_users_id_positive" as PhysicalName,
      expression: "id > 0",
    } as unknown) as Constraint;
    const table = makeTable({ constraints: [checkConstraint] });
    const { container } = render(
      <ConstraintsTab table={table} update={vi.fn()} allTables={[]} />,
    );

    expect(container.textContent).toContain("CHECK");
    expect(container.textContent).toContain("id > 0");
  });

  it("renders foreignKey constraint with referenced table", () => {
    const fkConstraint = ({
      id: "cn-3",
      kind: "foreignKey",
      physicalName: "fk_users_org" as PhysicalName,
      columnIds: ["c2" as LocalId],
      referencedTableId: TABLE_B_ID,
      referencedColumnIds: ["c-other" as LocalId],
    } as unknown) as Constraint;
    const refTable = makeTable({
      id: TABLE_B_ID,
      physicalName: "orgs" as PhysicalName,
      columns: [
        { id: "c-other" as LocalId, physicalName: "org_id" as PhysicalName, name: "OrgID" as DisplayName, dataType: "INTEGER", primaryKey: true },
      ],
    });
    const srcTable = makeTable({ constraints: [fkConstraint] });
    const { container } = render(
      <ConstraintsTab table={srcTable} update={vi.fn()} allTables={[srcTable, refTable]} />,
    );

    expect(container.textContent).toContain("FK");
    expect(container.textContent).toContain("orgs");
    expect(container.textContent).toContain("org_id");
  });

  it("opens add menu when 制約を追加 button is clicked", () => {
    const { container } = render(
      <ConstraintsTab table={makeTable()} update={vi.fn()} allTables={[]} />,
    );

    expect(container.querySelector(".constraints-add-menu")).toBeNull();
    const addBtn = container.querySelector<HTMLButtonElement>(".constraints-toolbar .tbl-btn-primary");
    fireEvent.click(addBtn!);
    expect(container.querySelector(".constraints-add-menu")).not.toBeNull();
  });

  it("invokes update with addConstraint when UNIQUE menu item is clicked", () => {
    const updateFn = vi.fn();
    const { container } = render(
      <ConstraintsTab table={makeTable()} update={updateFn} allTables={[]} />,
    );

    fireEvent.click(container.querySelector<HTMLButtonElement>(".constraints-toolbar .tbl-btn-primary")!);
    const uniqueItem = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".constraints-add-menu button"),
    ).find((b) => b.textContent?.includes("UNIQUE"));
    expect(uniqueItem).toBeTruthy();
    fireEvent.click(uniqueItem!);

    expect(updateFn).toHaveBeenCalledTimes(1);
  });
});
