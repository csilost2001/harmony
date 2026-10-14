import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildHarmonyAjv, parseDdl } from "@harmony/shared";

const schemasDir = path.resolve(__dirname, "../../schemas/v3");
function tableValidator() {
  const ajv = buildHarmonyAjv();
  for (const f of fs.readdirSync(schemasDir).filter((n) => n.endsWith(".json"))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(schemasDir, f), "utf-8")));
  const v = ajv.getSchema("table.v3.schema.json") ?? ajv.getSchema(JSON.parse(fs.readFileSync(path.join(schemasDir, "table.v3.schema.json"), "utf-8")).$id);
  if (!v) throw new Error("table schema not found");
  return v;
}

const PG = `
-- pg_dump -s
SET statement_timeout = 0;
CREATE TABLE public.customers (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    name text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    status uuid
);
CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id bigint NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    note text DEFAULT 'a;b'
);
COMMENT ON TABLE public.customers IS '顧客';
COMMENT ON COLUMN public.customers.email IS 'メールアドレス';
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.customers ADD CONSTRAINT customers_email_key UNIQUE (email);
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_id);
CREATE TRIGGER t BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION f();
`;

const MYSQL = `
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
CREATE TABLE \`order_items\` (
  \`id\` int(11) NOT NULL AUTO_INCREMENT COMMENT '明細ID',
  \`order_id\` int(11) NOT NULL,
  \`qty\` smallint unsigned NOT NULL DEFAULT '1',
  \`price\` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_order\` (\`order_id\`),
  UNIQUE KEY \`uq_order_qty\` (\`order_id\`,\`qty\`),
  CONSTRAINT \`fk_oi_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='注文明細';
CREATE TABLE \`orders\` (\`id\` int NOT NULL, PRIMARY KEY (\`id\`));
`;

describe("DDL の取り込み", () => {
  it("pg_dump -s の出力を、型・制約・コメント・インデックスごと取り込む", () => {
    const r = parseDdl(PG);
    expect(r.tables.map((t) => t.physicalName)).toEqual(["customers", "orders"]);
    const c = r.tables[0];
    expect(c.name).toBe("顧客");
    const col = (n: string) => c.columns.find((x) => x.physicalName === n)!;
    expect(col("id")).toMatchObject({ dataType: "BIGINT", primaryKey: true, notNull: true });
    expect(col("email")).toMatchObject({ dataType: "VARCHAR", length: 255, unique: true, name: "メールアドレス" });
    expect(col("created_at")).toMatchObject({ dataType: "TIMESTAMP", notNull: true, defaultValue: "now()" });
    expect(col("status")).toMatchObject({ dataType: "VARCHAR", length: 36 }); // uuid → VARCHAR(36)
    expect(col("status").comment).toContain("元の型: uuid");
    expect(r.warnings.some((w) => w.includes("uuid"))).toBe(true);
    const o = r.tables[1];
    expect(o.columns.find((x) => x.physicalName === "total")).toMatchObject({ dataType: "DECIMAL", length: 12, scale: 2, defaultValue: "0" });
    expect(o.columns.find((x) => x.physicalName === "note")?.defaultValue).toBe("'a;b'"); // 文字列の中の ; で文を分けない
    expect(o.constraints).toEqual([{ id: expect.any(String), kind: "foreignKey", columnIds: ["col-customer-id"], referencedTableId: "customers", referencedColumnIds: ["col-id"], physicalName: "orders_customer_fk", onDelete: "cascade" }]);
    expect(o.indexes[0]).toMatchObject({ physicalName: "idx_orders_customer", columns: [{ columnId: "col-customer-id" }], method: "btree" });
    expect(r.skipped.some((s) => s.startsWith("CREATE TRIGGER"))).toBe(true);
  });

  it("mysqldump の出力 (AUTO_INCREMENT・KEY・UNIQUE KEY・COMMENT) を取り込む", () => {
    const r = parseDdl(MYSQL);
    const t = r.tables.find((x) => x.physicalName === "order_items")!;
    expect(t.name).toBe("注文明細");
    expect(t.columns[0]).toMatchObject({ physicalName: "id", dataType: "INTEGER", autoIncrement: true, primaryKey: true, name: "明細ID" });
    expect(t.columns[2]).toMatchObject({ dataType: "SMALLINT", defaultValue: "'1'" });
    expect(t.indexes[0].physicalName).toBe("idx_order");
    expect(t.constraints.map((c) => c.kind).sort()).toEqual(["foreignKey", "unique"]);
    // 参照先 (orders) が、後ろにあっても解決できる
    expect(t.constraints.find((c) => c.kind === "foreignKey")).toMatchObject({ referencedTableId: "orders", referencedColumnIds: ["col-id"] });
  });

  it("取り込んだテーブルは、テーブルのスキーマに合う", () => {
    const validate = tableValidator();
    for (const t of [...parseDdl(PG).tables, ...parseDdl(MYSQL).tables]) {
      const doc = { $schema: "../../../../schemas/v3/table.v3.schema.json", ...t, uuid: "10d555e2-8041-4192-86f3-9e2a3ac581ab", maturity: "draft", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
      const ok = validate(doc);
      expect(validate.errors, t.physicalName).toBeNull();
      expect(ok).toBe(true);
    }
  });

  it("壊れた入力・参照先のない外部キーは、止まらずに理由を返す", () => {
    const r = parseDdl("CREATE TABLE a (id int, FOREIGN KEY (id) REFERENCES missing(id)); CREATE TABLE b (");
    expect(r.tables).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("参照先"))).toBe(true);
    expect(r.skipped.some((s) => s.includes("閉じていません"))).toBe(true);
    expect(parseDdl("").tables).toEqual([]);
  });

  it("物理名に使えない名前は直し、直したことを知らせる", () => {
    const r = parseDdl('CREATE TABLE "Order-Items" ("Item ID" int, "2nd" int);');
    expect(r.tables[0].physicalName).toBe("order_items");
    expect(r.tables[0].columns.map((c) => c.physicalName)).toEqual(["item_id", "c_2nd"]);
    expect(r.warnings.length).toBe(3);
  });
});
