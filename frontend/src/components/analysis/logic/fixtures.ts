/** 設計の分析のテスト用: examples/<id> から設計書の入力を組み立てる (設計書のテストと同じ読み方) */
import fs from "node:fs";
import path from "node:path";
import type { DesignDocInput } from "@harmony/shared";

const examples = path.resolve(__dirname, "../../../../../examples");

export function loadExample(id: string): DesignDocInput {
  const root = path.join(examples, id);
  const dir = (d: string, f = (n: string) => n.endsWith(".json")) => {
    const p = path.join(root, "harmony", d);
    return fs.existsSync(p) ? fs.readdirSync(p).filter(f).sort().map((n) => JSON.parse(fs.readFileSync(path.join(p, n), "utf-8"))) : [];
  };
  const harmony = JSON.parse(fs.readFileSync(path.join(root, "harmony.json"), "utf-8"));
  const catPath = path.join(root, "harmony", "conventions", "catalog.json");
  const conv = fs.existsSync(catPath) ? JSON.parse(fs.readFileSync(catPath, "utf-8")) : {};
  const lc = path.join(root, "harmony", "layout-components.json");
  return {
    project: { id, name: harmony.meta?.name ?? id },
    screens: dir("screens", (n) => n.endsWith(".json") && !n.includes(".design.")),
    flows: dir("process-flows"), tables: dir("tables"),
    transitions: harmony.entities?.screenTransitions ?? [],
    messages: conv.msg ?? {}, roles: conv.role ?? {}, permissions: conv.permission ?? {}, limits: conv.limit ?? {}, regex: conv.regex ?? {}, db: conv.db ?? {},
    businessFlows: dir("business-flows"), reports: dir("reports"),
    layoutComponents: fs.existsSync(lc) ? JSON.parse(fs.readFileSync(lc, "utf-8")).components ?? [] : [],
    version: "test", generatedAt: "2026-10-13T00:00:00.000Z",
  };
}

/** 小さな合成データ (テーブル 2・画面 2・処理 2・業務フロー 1) */
export function tiny(): DesignDocInput {
  return {
    project: { name: "テスト" },
    tables: [
      { id: "customer", name: "顧客", physicalName: "customer", columns: [{ id: "c-id", physicalName: "customer_id", name: "顧客ID", dataType: "INTEGER", primaryKey: true, notNull: true }, { id: "c-name", physicalName: "customer_name", name: "顧客名", dataType: "VARCHAR", length: 20, notNull: true }, { id: "c-memo", physicalName: "memo", name: "備考", dataType: "VARCHAR", length: 50 }] },
      { id: "order", name: "注文", physicalName: "orders", columns: [{ id: "o-id", physicalName: "order_id", name: "注文ID", dataType: "INTEGER", primaryKey: true, notNull: true }, { id: "o-cust", physicalName: "customer_id", name: "お客様ID", dataType: "INTEGER", notNull: true }, { id: "o-qty", physicalName: "qty", name: "数量", dataType: "INTEGER", notNull: true }], constraints: [{ id: "fk1", kind: "foreignKey", columnIds: ["o-cust"], referencedTableId: "customer", referencedColumnIds: ["c-id"] }, { id: "ck1", kind: "check", expression: "qty >= 1 AND qty <= 9" }] },
      { id: "lonely", name: "孤立", physicalName: "lonely", columns: [{ id: "l-id", physicalName: "lonely_id", name: "ID", dataType: "INTEGER", primaryKey: true }] },
    ],
    screens: [
      { id: "order-entry", name: "注文入力", items: [
        { id: "customerName", label: "顧客名", type: "string", direction: "in", binding: { kind: "tableColumn", ref: { tableId: "customer", columnId: "c-name" } }, events: [] },
        { id: "qty", label: "数量", type: "integer", direction: "in", required: true, min: 1, max: 9, binding: { kind: "tableColumn", ref: { tableId: "order", columnId: "o-qty" } }, events: [{ id: "submit", handlerFlowId: "order-create" }] },
        { id: "note", label: "メモ", type: "string", direction: "in" },
        { id: "ghost", label: "幽霊", type: "string", direction: "in", binding: { kind: "tableColumn", ref: { tableId: "order", columnId: "nope" } } },
      ] },
      { id: "order-list", name: "注文一覧", items: [] },
    ],
    flows: [
      { meta: { id: "order-create", name: "注文登録", flowType: "screen", screenId: "order-entry" }, actions: [{ id: "a1", name: "登録", trigger: "submit", steps: [
        { id: "s1", kind: "dbAccess", tableId: "order", operation: "INSERT", sql: "INSERT INTO orders (order_id, customer_id, qty) VALUES (1, 2, 3)" },
        { id: "s2", kind: "dbAccess", tableId: "customer", operation: "SELECT", sql: "SELECT customer_id FROM customer" },
      ] }] },
      { meta: { id: "order-orphan", name: "迷子", flowType: "common" }, actions: [{ id: "a1", name: "x", trigger: "auto", steps: [] }] },
    ],
    businessFlows: [{ version: 1, id: "bf1", name: "受注", lanes: [{ id: "l1", name: "営業", kind: "person" }], steps: [
      { id: "st1", lane: "l1", kind: "task", name: "注文を入力", screenRef: "order-entry", next: [{ to: "st2" }] },
      { id: "st2", lane: "l1", kind: "task", name: "確認する", next: [] },
    ] }],
    messages: { used: { template: "使っている" }, spare: { template: "余っている" } },
    version: "test", generatedAt: "2026-10-13T00:00:00.000Z",
  } as unknown as DesignDocInput;
}
