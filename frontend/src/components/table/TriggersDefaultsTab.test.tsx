/**
 * TriggersDefaultsTab — rendering smoke (#1146)
 *
 * empty 状態 / 既存 default / 既存 trigger / async setup 呼び出しを検証。
 * listSequences + loadConventions は 2 行の useEffect なので SequenceListView.test と同じ pattern で mock 化。
 */

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TriggersDefaultsTab } from "./TriggersDefaultsTab";
import type {
  Table,
  DefaultDefinition,
  TriggerDefinition,
  TableId,
  Uuid,
  LocalId,
  PhysicalName,
  DisplayName,
  Timestamp,
} from "../../types/v3";

const listSequencesMock = vi.fn(() => Promise.resolve([]));
const loadConventionsMock = vi.fn(() => Promise.resolve(null));

vi.mock("../../store/sequenceStore", () => ({
  listSequences: () => listSequencesMock(),
}));

vi.mock("../../store/conventionsStore", () => ({
  loadConventions: () => loadConventionsMock(),
}));

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

function makeDefault(over: Partial<DefaultDefinition> = {}): DefaultDefinition {
  return {
    columnId: "c1" as LocalId,
    kind: "literal",
    value: "0",
    ...over,
  } as DefaultDefinition;
}

function makeTrigger(over: Partial<TriggerDefinition> = {}): TriggerDefinition {
  return {
    id: "trg-1" as LocalId,
    physicalName: "trg_users_audit" as PhysicalName,
    timing: "AFTER",
    events: ["INSERT"],
    function: "log_users_change()",
    ...over,
  } as TriggerDefinition;
}

describe("TriggersDefaultsTab", () => {
  it("DEFAULT と トリガー の section header が表示される", () => {
    const { container, getByText } = render(
      <TriggersDefaultsTab table={makeTable()} update={vi.fn()} />,
    );
    expect(container.querySelector(".triggers-defaults-tab")).toBeTruthy();
    expect(getByText("DEFAULT 値")).toBeTruthy();
    expect(getByText("トリガー")).toBeTruthy();
  });

  it("empty 時に DEFAULT / トリガー それぞれの空メッセージが表示される", () => {
    const { getByText } = render(
      <TriggersDefaultsTab table={makeTable()} update={vi.fn()} />,
    );
    expect(getByText(/ALTER TABLE/)).toBeTruthy();
    expect(getByText(/CREATE TRIGGER/)).toBeTruthy();
  });

  it("既存 default 行が表示される", () => {
    const table = makeTable({
      defaults: [makeDefault({ columnId: "c1" as LocalId, value: "0" })],
    });
    const { container } = render(<TriggersDefaultsTab table={table} update={vi.fn()} />);
    expect(container.querySelectorAll(".td-list").length).toBeGreaterThanOrEqual(1);
  });

  it("既存 trigger 行が表示される", () => {
    const table = makeTable({
      triggers: [makeTrigger({ id: "trg-1" as LocalId })],
    });
    const { container } = render(<TriggersDefaultsTab table={table} update={vi.fn()} />);
    expect(container.querySelectorAll(".td-list").length).toBeGreaterThanOrEqual(1);
  });

  it("mount 時に listSequences と loadConventions が呼ばれる", async () => {
    listSequencesMock.mockClear();
    loadConventionsMock.mockClear();
    render(<TriggersDefaultsTab table={makeTable()} update={vi.fn()} />);
    await waitFor(() => {
      expect(listSequencesMock).toHaveBeenCalledTimes(1);
      expect(loadConventionsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("列がゼロのとき DEFAULT 追加ボタンが disabled になる", () => {
    const { container } = render(
      <TriggersDefaultsTab table={makeTable({ columns: [] })} update={vi.fn()} />,
    );
    // td-section-header 内の primary 追加ボタンを取得
    const addButtons = container.querySelectorAll(".td-section-header .tbl-btn-primary");
    const defaultAdd = addButtons[0] as HTMLButtonElement;
    expect(defaultAdd.disabled).toBe(true);
  });
});
