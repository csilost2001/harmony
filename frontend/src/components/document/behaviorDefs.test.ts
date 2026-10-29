/**
 * 設計書の「状態遷移・初期データ・要件・ジョブ」の章と、状態遷移図 (Mermaid) の書き出し (#1499)。
 */
import { describe, expect, it } from "vitest";
import { buildDesignDocument, stateMachineToMermaid, type DesignDocInput } from "@harmony/shared";

const input = (g: unknown[]): DesignDocInput => ({
  project: { name: "t" }, screens: [],
  tables: [{ id: "t1", name: "注文", columns: [{ id: "c1", physicalName: "code", dataType: "VARCHAR" }] }],
  flows: [{ meta: { id: "f1", name: "出荷" }, actions: [{ id: "a1" }] }],
  genericDefinitions: g,
  generatedAt: "2026-10-29T00:00:00.000Z",
} as unknown as DesignDocInput);

const defs = [
  { kind: "state-machine", name: "OrderStatus", purpose: "注文の状態", states: [{ name: "pending", label: "注文済み", initial: true }, { name: "shipped", label: "出荷済み", final: true }], transitions: [{ from: "pending", to: "shipped", trigger: "出荷する", guard: "在庫あり", processFlowId: "f1" }], stateColumn: { tableId: "t1", columnId: "c1" } },
  { kind: "seed-data", name: "Seed", purpose: "初期", tableId: "t1", rows: [{ code: "<b>X</b>" }, { code: "Y" }] },
  { kind: "requirement", name: "Resp", purpose: "応答", measure: { metric: "応答時間", operator: "<=", value: 2000, unit: "ms", percentile: "p95" }, processFlowId: "f1" },
  { kind: "job-definition", name: "Nightly", purpose: "夜間", schedule: { kind: "cron", expression: "0 2 * * *", timezone: "Asia/Tokyo" }, retry: { maxAttempts: 3, backoff: "exponential" }, processFlowId: "f1" },
];

describe("設計書: 状態遷移・初期データ・要件・ジョブ", () => {
  it("定義がなければ、章を出さない", () => {
    expect(buildDesignDocument(input([])).html).not.toContain("behavior-defs");
  });

  it("4 種類の定義を章にして、処理フローへのリンクと Mermaid の図を出す。値は HTML として解釈されない", () => {
    const html = buildDesignDocument(input(defs)).html;
    expect(html).toContain('id="behavior-defs"');
    expect(html).toContain("状態遷移: OrderStatus");
    expect(html).toContain("stateDiagram-v2");
    expect(html).toContain("pending --&gt; shipped : 出荷する [在庫あり]");
    expect(html).toContain("初期データ: Seed");
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).toContain("p95 &lt;= 2000 ms");
    expect(html).toContain("cron 0 2 * * * (Asia/Tokyo)");
    expect(html).toContain("最大 3 回・だんだん長く");
    expect(html).toMatch(/href="#[^"]*f1[^"]*"/);
  });
});

describe("stateMachineToMermaid", () => {
  it("最初の状態・終わりの状態・契機と条件・呼び名を出す。名前の記号は図の id にできる形にする", () => {
    const text = stateMachineToMermaid(defs[0] as never);
    expect(text.split("\n")).toEqual([
      "stateDiagram-v2",
      '  state "注文済み" as pending',
      '  state "出荷済み" as shipped',
      "  [*] --> pending",
      "  pending --> shipped : 出荷する [在庫あり]",
      "  shipped --> [*]",
    ]);
    expect(stateMachineToMermaid({ states: [{ name: "a-b", label: 'x"y' }], transitions: [{ from: "a-b", to: "a-b", trigger: "再\n試行" }] })).toContain('a_b --> a_b : 再 試行');
    expect(stateMachineToMermaid({})).toBe("stateDiagram-v2");
  });
});

describe("初期データの書き出し (SQL)", () => {
  const table = { id: "t1", name: "店舗", physicalName: "stores", columns: [
    { id: "c-id", physicalName: "id", dataType: "BIGINT" }, { id: "c-code", physicalName: "store_code", dataType: "VARCHAR" },
    { id: "c-act", physicalName: "is_active", dataType: "BOOLEAN" }, { id: "c-qty", physicalName: "qty", dataType: "INTEGER" }, { id: "c-note", physicalName: "note", dataType: "TEXT" },
  ] };
  it("カラムの id でも物理名でも、物理名にそろえて INSERT 文にする (文字は引用符で囲み、'' で逃がす。数・真偽・null はそのまま)", async () => {
    const { seedDataToSql } = await import("@harmony/shared");
    const sql = seedDataToSql(table as never, [{ "c-code": "O'HARA", is_active: "true", qty: "12", note: null }, { store_code: "X", id: 5 }]);
    expect(sql.split("\n")).toEqual([
      "-- 店舗 (stores) の初期データ 2 行",
      `INSERT INTO "stores" ("store_code", "is_active", "qty", "note") VALUES ('O''HARA', TRUE, 12, NULL);`,
      `INSERT INTO "stores" ("id", "store_code") VALUES (5, 'X');`,
      "",
    ]);
  });
  it("テーブルにないキーは、書き出さず、報告する", async () => {
    const { normalizeSeedRows } = await import("@harmony/shared");
    const r = normalizeSeedRows(table as never, [{ code: 1, zzz: 2 }, { yyy: 1 }]);
    expect(r.unknownKeys.sort()).toEqual(["code", "yyy", "zzz"]);
    expect(r.rows).toEqual([{}, {}]);
  });
});
