// Phase-4 (#1145): ViewDefinitionEditor 分割 — sub-editor / section の最小 rendering test。
//
// 各 sub-component は ViewDefinitionEditor.tsx から純粋に抽出されたもの。本テストは
// (1) crash せず render される (2) Level 別 / Section 別の固有要素が DOM に出る、を確認する。

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ViewDefinition } from "../../../types/v3/view-definition";
import { BasicInfoSection } from "./BasicInfoSection";
import { Level1QueryEditor } from "./Level1QueryEditor";
import { Level2QueryEditor } from "./Level2QueryEditor";
import { Level3QueryEditor } from "./Level3QueryEditor";
import { ColumnsSection } from "./ColumnsSection";
import { SortDefaultsSection } from "./SortDefaultsSection";
import { FilterDefaultsSection } from "./FilterDefaultsSection";
import { MiscSection } from "./MiscSection";
import { IssueHints } from "./IssueHints";
import { isBuiltinKind, FIELD_TYPE_OPTIONS, FILTER_OPERATORS } from "./viewDefinitionConstants";
import type { TableOption } from "./useViewDefinitionTables";

// ── 共通ヘルパ ─────────────────────────────────────────────────────

const noop = () => {};
const noopGetIssues = () => [];

function buildVd(overrides: Partial<ViewDefinition> = {}): ViewDefinition {
  return {
    id: "v1",
    name: "テストビュー",
    kind: "list",
    sourceTableId: "t1",
    columns: [],
    ...overrides,
  } as ViewDefinition;
}

const tableOptions: TableOption[] = [
  {
    id: "t1",
    name: "顧客",
    columns: [
      { id: "c1", name: "id", physicalName: "id" },
      { id: "c2", name: "name", physicalName: "name" },
    ],
  },
  {
    id: "t2",
    name: "注文",
    columns: [
      { id: "c3", name: "amount", physicalName: "amount" },
    ],
  },
];

// ── viewDefinitionConstants ────────────────────────────────────────

describe("viewDefinitionConstants", () => {
  it("FIELD_TYPE_OPTIONS は最低 string / integer を含む", () => {
    expect(FIELD_TYPE_OPTIONS).toContain("string");
    expect(FIELD_TYPE_OPTIONS).toContain("integer");
  });

  it("FILTER_OPERATORS は eq / contains を含む", () => {
    expect(FILTER_OPERATORS).toContain("eq");
    expect(FILTER_OPERATORS).toContain("contains");
  });

  it("isBuiltinKind は list/detail/kanban/calendar のみ true", () => {
    expect(isBuiltinKind("list")).toBe(true);
    expect(isBuiltinKind("detail")).toBe(true);
    expect(isBuiltinKind("kanban")).toBe(true);
    expect(isBuiltinKind("calendar")).toBe(true);
    expect(isBuiltinKind("retail:custom")).toBe(false);
  });
});

// ── IssueHints ─────────────────────────────────────────────────────

describe("IssueHints", () => {
  it("issues が空なら何も描画しない", () => {
    const { container } = render(<IssueHints issues={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("error severity の issue を描画する", () => {
    const { container } = render(
      <IssueHints
        issues={[{ severity: "error", code: "TEST", path: "x", message: "テストエラー" }]}
      />,
    );
    expect(container.querySelector(".vd-editor-issue--error")).not.toBeNull();
    expect(container.textContent).toContain("テストエラー");
  });
});

// ── BasicInfoSection ───────────────────────────────────────────────

describe("BasicInfoSection", () => {
  it("name / kind select / Level radio が描画される", () => {
    const vd = buildVd({ name: "顧客一覧" });
    const { container } = render(
      <BasicInfoSection
        viewDefinition={vd}
        currentLevel={1}
        tableOptions={tableOptions}
        isReadonly={false}
        kindExtMode={false}
        setKindExtMode={noop}
        updateWithDraft={noop}
        updateSilentWithDraft={noop}
        commit={noop}
      />,
    );
    // 表示名 input
    const nameInput = container.querySelector('input[placeholder="顧客一覧"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe("顧客一覧");
    // kind select (builtin mode)
    const kindSelect = container.querySelector("select");
    expect(kindSelect).not.toBeNull();
    // Level radio 3 個
    const radios = container.querySelectorAll('input[name="vd-level"]');
    expect(radios.length).toBe(3);
  });

  it("kindExtMode=true で input が出る", () => {
    const vd = buildVd({ kind: "retail:custom" });
    const { container } = render(
      <BasicInfoSection
        viewDefinition={vd}
        currentLevel={1}
        tableOptions={tableOptions}
        isReadonly={false}
        kindExtMode={true}
        setKindExtMode={noop}
        updateWithDraft={noop}
        updateSilentWithDraft={noop}
        commit={noop}
      />,
    );
    const input = container.querySelector('input[placeholder^="namespace:kindName"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("retail:custom");
  });
});

// ── Level1QueryEditor ──────────────────────────────────────────────

describe("Level1QueryEditor", () => {
  it("ソーステーブル select が描画され、tableOptions が並ぶ", () => {
    const vd = buildVd({ sourceTableId: "t1" });
    const { container } = render(
      <Level1QueryEditor
        viewDefinition={vd}
        vdId="v1"
        tableOptions={tableOptions}
        isReadonly={false}
        updateWithDraft={noop}
        getIssues={noopGetIssues}
      />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("t1");
    expect(select.options.length).toBe(1 + tableOptions.length);
  });

  it("テーブル変更で updateWithDraft が呼ばれる", () => {
    const vd = buildVd({ sourceTableId: "t1" });
    const updateWithDraft = vi.fn();
    const { container } = render(
      <Level1QueryEditor
        viewDefinition={vd}
        vdId="v1"
        tableOptions={tableOptions}
        isReadonly={false}
        updateWithDraft={updateWithDraft}
        getIssues={noopGetIssues}
      />,
    );
    const select = container.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "t2" } });
    expect(updateWithDraft).toHaveBeenCalledOnce();
  });
});

// ── Level2QueryEditor ──────────────────────────────────────────────

describe("Level2QueryEditor", () => {
  it("FROM / JOINS / WHERE 等の block が描画される", () => {
    const vd = buildVd({
      query: { from: { tableId: "t1" as never, alias: "c" }, joins: [], where: [] } as never,
      sourceTableId: undefined,
    });
    const { container } = render(
      <Level2QueryEditor
        viewDefinition={vd}
        vdId="v1"
        tableOptions={tableOptions}
        isReadonly={false}
        updateWithDraft={noop}
        updateSilentWithDraft={noop}
        commit={noop}
        getIssues={noopGetIssues}
      />,
    );
    // FROM ラベル
    expect(container.textContent).toContain("FROM");
    // JOIN block タイトル
    expect(container.textContent).toContain("JOINS");
    // WHERE / GROUP BY / HAVING / ORDER BY block タイトル
    expect(container.textContent).toContain("WHERE");
    expect(container.textContent).toContain("GROUP BY");
    expect(container.textContent).toContain("HAVING");
    expect(container.textContent).toContain("ORDER BY");
  });

  it("JOIN 追加ボタン click で updateWithDraft が呼ばれる", () => {
    const vd = buildVd({
      query: { from: { tableId: "t1" as never, alias: "c" }, joins: [] } as never,
      sourceTableId: undefined,
    });
    const updateWithDraft = vi.fn();
    const { container } = render(
      <Level2QueryEditor
        viewDefinition={vd}
        vdId="v1"
        tableOptions={tableOptions}
        isReadonly={false}
        updateWithDraft={updateWithDraft}
        updateSilentWithDraft={noop}
        commit={noop}
        getIssues={noopGetIssues}
      />,
    );
    const addJoinBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("JOIN 追加"),
    );
    expect(addJoinBtn).not.toBeUndefined();
    fireEvent.click(addJoinBtn!);
    expect(updateWithDraft).toHaveBeenCalledOnce();
  });
});

// ── Level3QueryEditor ──────────────────────────────────────────────

describe("Level3QueryEditor", () => {
  it("SQL textarea + parameterRefs ブロックが描画される", () => {
    const vd = buildVd({
      query: { sql: "SELECT * FROM products", parameterRefs: [] } as never,
      sourceTableId: undefined,
    });
    const { container } = render(
      <Level3QueryEditor
        viewDefinition={vd}
        isReadonly={false}
        updateWithDraft={noop}
        updateSilentWithDraft={noop}
        commit={noop}
      />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe("SELECT * FROM products");
    expect(container.textContent).toContain("parameterRefs");
  });

  it("parameterRef 追加ボタンが updateWithDraft を呼ぶ", () => {
    const vd = buildVd({
      query: { sql: "", parameterRefs: [] } as never,
      sourceTableId: undefined,
    });
    const updateWithDraft = vi.fn();
    const { container } = render(
      <Level3QueryEditor
        viewDefinition={vd}
        isReadonly={false}
        updateWithDraft={updateWithDraft}
        updateSilentWithDraft={noop}
        commit={noop}
      />,
    );
    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("parameterRef 追加"),
    );
    expect(addBtn).not.toBeUndefined();
    fireEvent.click(addBtn!);
    expect(updateWithDraft).toHaveBeenCalledOnce();
  });
});

// ── ColumnsSection ─────────────────────────────────────────────────

describe("ColumnsSection", () => {
  const colPath = (ci: number, colName: string, field?: string) => {
    const base = `ViewDefinition[v1].columns[${ci}=${colName}]`;
    return field ? `${base}.${field}` : base;
  };

  it("columns 件数表示 + 追加ボタンが描画される (空)", () => {
    const vd = buildVd({ columns: [] });
    const { container } = render(
      <ColumnsSection
        viewDefinition={vd}
        currentLevel={1}
        tableOptions={tableOptions}
        inScopeTables={[]}
        colRefTableIds={{}}
        isReadonly={false}
        addColumn={noop}
        removeColumn={noop}
        moveColumn={noop}
        updateColumn={noop}
        setColRefTable={noop}
        setColRefColumn={noop}
        updateSilentWithDraft={noop}
        updateWithDraft={noop}
        commit={noop}
        colPath={colPath}
        getIssues={noopGetIssues}
      />,
    );
    expect(container.textContent).toContain("(0 件)");
    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("カラム追加"),
    );
    expect(addBtn).not.toBeUndefined();
  });

  it("カラム追加ボタン click で addColumn が呼ばれる", () => {
    const vd = buildVd({ columns: [] });
    const addColumn = vi.fn();
    const { container } = render(
      <ColumnsSection
        viewDefinition={vd}
        currentLevel={1}
        tableOptions={tableOptions}
        inScopeTables={[]}
        colRefTableIds={{}}
        isReadonly={false}
        addColumn={addColumn}
        removeColumn={noop}
        moveColumn={noop}
        updateColumn={noop}
        setColRefTable={noop}
        setColRefColumn={noop}
        updateSilentWithDraft={noop}
        updateWithDraft={noop}
        commit={noop}
        colPath={colPath}
        getIssues={noopGetIssues}
      />,
    );
    const addBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("カラム追加"),
    );
    fireEvent.click(addBtn!);
    expect(addColumn).toHaveBeenCalledOnce();
  });

  it("Level 3 では 参照テーブル / 参照カラム 列が消える", () => {
    const vd = buildVd({
      columns: [{ name: "x" as never, type: "string" }] as never,
    });
    const { container } = render(
      <ColumnsSection
        viewDefinition={vd}
        currentLevel={3}
        tableOptions={tableOptions}
        inScopeTables={[]}
        colRefTableIds={{}}
        isReadonly={false}
        addColumn={noop}
        removeColumn={noop}
        moveColumn={noop}
        updateColumn={noop}
        setColRefTable={noop}
        setColRefColumn={noop}
        updateSilentWithDraft={noop}
        updateWithDraft={noop}
        commit={noop}
        colPath={colPath}
        getIssues={noopGetIssues}
      />,
    );
    const ths = Array.from(container.querySelectorAll("th")).map((th) => th.textContent ?? "");
    expect(ths.some((t) => t.includes("参照テーブル"))).toBe(false);
    expect(ths.some((t) => t.includes("参照カラム"))).toBe(false);
  });
});

// ── SortDefaultsSection ────────────────────────────────────────────

describe("SortDefaultsSection", () => {
  const sortPath = (si: number, field?: string) => {
    const base = `ViewDefinition[v1].sortDefaults[${si}].columnName`;
    return field ? `ViewDefinition[v1].sortDefaults[${si}].${field}` : base;
  };

  it("空の場合は table 非表示 + 追加ボタンのみ", () => {
    const vd = buildVd({});
    const { container } = render(
      <SortDefaultsSection
        viewDefinition={vd}
        columnNames={["a", "b"]}
        isReadonly={false}
        addSortSpec={noop}
        removeSortSpec={noop}
        updateSortSpec={noop}
        sortPath={sortPath}
        getIssues={noopGetIssues}
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("ソート条件追加");
  });

  it("ソート条件がある場合 table が描画される", () => {
    const vd = buildVd({
      sortDefaults: [{ columnName: "a" as never, order: "asc" }],
    });
    const { container } = render(
      <SortDefaultsSection
        viewDefinition={vd}
        columnNames={["a", "b"]}
        isReadonly={false}
        addSortSpec={noop}
        removeSortSpec={noop}
        updateSortSpec={noop}
        sortPath={sortPath}
        getIssues={noopGetIssues}
      />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("(1 件)");
  });
});

// ── FilterDefaultsSection ──────────────────────────────────────────

describe("FilterDefaultsSection", () => {
  const filterPath = (fi: number, field: string) =>
    `ViewDefinition[v1].filterDefaults[${fi}].${field}`;

  it("空の場合は table 非表示 + 追加ボタンのみ", () => {
    const vd = buildVd({});
    const { container } = render(
      <FilterDefaultsSection
        viewDefinition={vd}
        columnNames={["a", "b"]}
        isReadonly={false}
        addFilterSpec={noop}
        removeFilterSpec={noop}
        updateFilterSpec={noop}
        updateSilentWithDraft={noop}
        commit={noop}
        filterPath={filterPath}
        getIssues={noopGetIssues}
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("フィルタ条件追加");
  });

  it("filter 条件がある場合 演算子 select が描画される", () => {
    const vd = buildVd({
      filterDefaults: [{ columnName: "a" as never, operator: "eq" }],
    });
    const { container } = render(
      <FilterDefaultsSection
        viewDefinition={vd}
        columnNames={["a", "b"]}
        isReadonly={false}
        addFilterSpec={noop}
        removeFilterSpec={noop}
        updateFilterSpec={noop}
        updateSilentWithDraft={noop}
        commit={noop}
        filterPath={filterPath}
        getIssues={noopGetIssues}
      />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    // FILTER_OPERATORS 全て option として描画
    const selects = container.querySelectorAll("select");
    expect(selects.length).toBeGreaterThan(0);
  });
});

// ── MiscSection ────────────────────────────────────────────────────

describe("MiscSection", () => {
  it("pageSize input + groupBy select が描画される", () => {
    const vd = buildVd({ pageSize: 50, columns: [{ name: "a" as never, type: "string" }] as never });
    const { container } = render(
      <MiscSection
        viewDefinition={vd}
        vdId="v1"
        columnNames={["a"]}
        isReadonly={false}
        updateWithDraft={noop}
        getIssues={noopGetIssues}
      />,
    );
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numberInput).not.toBeNull();
    expect(numberInput.value).toBe("50");
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    // groupBy select は "なし" + columnNames 1 件
    expect(select.options.length).toBe(2);
  });
});
