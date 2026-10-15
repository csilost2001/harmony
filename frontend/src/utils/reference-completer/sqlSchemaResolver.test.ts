import { describe, it, expect } from "vitest";
import { sqlSchemaResolver, collectSqlTables } from "./sqlSchemaResolver";
import type { CompletionContext, WorkspaceRefs } from "./types";

const tables: WorkspaceRefs["tables"] = [
  {
    id: "orders", physicalName: "orders", name: "注文",
    columns: [
      { physicalName: "order_id", name: "注文ID", dataType: "BIGINT", primaryKey: true },
      { physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", notNull: true },
      { physicalName: "total_amount", name: "合計金額", dataType: "DECIMAL", length: 12 },
    ],
  },
  {
    id: "customers", physicalName: "customers", name: "顧客",
    columns: [
      { physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", primaryKey: true },
      { physicalName: "customer_name", name: "顧客名", dataType: "VARCHAR", length: 100 },
    ],
  },
];
const ctx: CompletionContext = { workspace: { screens: [], tables, viewDefinitions: [], processFlows: [], components: [], exceptionTypes: [], modelEndpoints: [], secrets: [], events: [] } };

/** `|` を目印にカーソルの位置を指定する (無ければ末尾)。 */
function run(src: string) {
  const caret = src.indexOf("|");
  const sql = src.replace("|", "");
  const s = sqlSchemaResolver.match(sql, caret >= 0 ? caret : sql.length, ctx);
  return s && s.phase === "active" ? s.candidates.map((c) => c.value) : null;
}

describe("sqlSchemaResolver", () => {
  it("FROM / JOIN / INTO / UPDATE の後でテーブル名を候補にする", () => {
    expect(run("SELECT * FROM ")).toEqual(["orders", "customers"]);
    expect(run("SELECT * FROM ord")).toEqual(["orders"]);
    expect(run("SELECT * FROM orders o JOIN cu")).toEqual(["customers"]);
    expect(run("INSERT INTO ")).toEqual(["orders", "customers"]);
    expect(run("UPDATE or")).toEqual(["orders"]);
  });

  it("表の表示名でも探せる", () => {
    expect(run("SELECT * FROM 顧")).toEqual(["customers"]);
  });

  it("表名. の後でカラムを候補にする", () => {
    expect(run("SELECT orders.")).toEqual(["order_id", "customer_id", "total_amount"]);
    expect(run("SELECT orders.cus")).toEqual(["customer_id"]);
  });

  it("別名 (AS あり・なし) からカラムを引ける", () => {
    expect(run("SELECT o.cu| FROM orders o")).toEqual(["customer_id"]);
    expect(run("SELECT c.customer_n| FROM customers AS c JOIN orders o ON o.customer_id = c.customer_id")).toEqual(["customer_name"]);
    expect(run("SELECT x.| FROM orders o")).toBeNull(); // 知らない別名
  });

  it("単語の途中では、FROM / JOIN に出てくるテーブルのカラムを候補にする (重複は 1 つ)", () => {
    expect(run("SELECT total FROM orders WHERE customer")).toEqual(["customer_id"]);
    expect(run("SELECT * FROM orders o JOIN customers c ON customer")).toEqual(["customer_id", "customer_name"]);
    expect(run("SELECT * FROM orders o JOIN customers c ON o.customer")).toEqual(["customer_id"]); // 別名つきは、そのテーブルだけ
  });

  it("入力済みの完全一致・FROM に無いテーブル・1 文字では出さない", () => {
    expect(run("SELECT * FROM orders WHERE order_id")).toBeNull();
    expect(run("SELECT * FROM orders WHERE c")).toBeNull();
    expect(run("SELECT customer_na")).toBeNull(); // この時点では FROM が無い
  });

  it("@ の参照は他の補完に任せる", () => {
    expect(run("SELECT * FROM orders WHERE order_id = @inputs.")).toBeNull();
    expect(run("SELECT * FROM orders WHERE x = @inputs.cust")).toBeNull();
  });

  it("テーブル定義が無ければ何も出さない", () => {
    expect(sqlSchemaResolver.match("SELECT * FROM ", 14, {})).toBeNull();
  });

  it("collectSqlTables は別名と予約語を見分ける", () => {
    const used = collectSqlTables("SELECT * FROM orders WHERE a = 1", tables);
    expect([...used.keys()]).toEqual(["orders"]);
    const used2 = collectSqlTables("SELECT * FROM orders o LEFT JOIN customers c ON 1=1", tables);
    expect([...used2.keys()].sort()).toEqual(["c", "customers", "o", "orders"]);
  });
});
