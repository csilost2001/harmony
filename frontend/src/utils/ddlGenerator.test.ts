import { describe, it, expect } from "vitest";
import { generateDdl } from "./ddlGenerator";
import type { Table, TableId, LocalId, PhysicalName, DisplayName, Timestamp } from "../types/v3";

function baseTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t1" as TableId,
    name: "受注" as DisplayName,
    physicalName: "orders" as PhysicalName,
    description: "",
    createdAt: "2026-01-01T00:00:00Z" as Timestamp,
    updatedAt: "2026-01-01T00:00:00Z" as Timestamp,
    columns: [
      {
        id: "c1" as LocalId, no: 1, physicalName: "id" as PhysicalName, name: "ID" as DisplayName,
        dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true,
      },
      {
        id: "c2" as LocalId, no: 2, physicalName: "amount" as PhysicalName, name: "金額" as DisplayName,
        dataType: "DECIMAL", length: 12, scale: 2, notNull: true, primaryKey: false, unique: false,
      },
      {
        id: "c3" as LocalId, no: 3, physicalName: "supplier_id" as PhysicalName, name: "仕入先ID" as DisplayName,
        dataType: "INTEGER", notNull: true, primaryKey: false, unique: false,
      },
      {
        id: "c4" as LocalId, no: 4, physicalName: "po_number" as PhysicalName, name: "発注番号" as DisplayName,
        dataType: "VARCHAR", length: 50, notNull: true, primaryKey: false, unique: false,
      },
      {
        id: "c5" as LocalId, no: 5, physicalName: "created_at" as PhysicalName, name: "作成日時" as DisplayName,
        dataType: "TIMESTAMP", notNull: false, primaryKey: false, unique: false,
      },
    ],
    indexes: [],
    ...overrides,
  };
}

// 参照先 suppliers テーブル (FK テスト用)
function suppliersTable(): Table {
  return {
    id: "t-suppliers" as TableId,
    name: "仕入先" as DisplayName,
    physicalName: "suppliers" as PhysicalName,
    description: "",
    createdAt: "2026-01-01T00:00:00Z" as Timestamp,
    updatedAt: "2026-01-01T00:00:00Z" as Timestamp,
    columns: [
      {
        id: "s1" as LocalId, no: 1, physicalName: "id" as PhysicalName, name: "ID" as DisplayName,
        dataType: "INTEGER", notNull: true, primaryKey: true, unique: false,
      },
    ],
  };
}

describe("generateDdl — constraints (v3)", () => {
  it("UNIQUE 制約が ALTER TABLE ... ADD CONSTRAINT ... UNIQUE として出力される", () => {
    const table = baseTable({
      constraints: [
        { id: "uq-1" as LocalId, kind: "unique", physicalName: "uq_po_number" as PhysicalName, columnIds: ["c4" as LocalId] },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("ALTER TABLE orders ADD CONSTRAINT uq_po_number UNIQUE (po_number);");
  });

  it("CHECK 制約が ALTER TABLE ... ADD CONSTRAINT ... CHECK として出力される", () => {
    const table = baseTable({
      constraints: [
        { id: "chk-1" as LocalId, kind: "check", physicalName: "chk_amount_positive" as PhysicalName, expression: "amount > 0" },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("ALTER TABLE orders ADD CONSTRAINT chk_amount_positive CHECK (amount > 0);");
  });

  it("FOREIGN KEY 制約が ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY として出力される", () => {
    const suppliers = suppliersTable();
    const table = baseTable({
      constraints: [
        {
          id: "fk-1" as LocalId,
          kind: "foreignKey",
          physicalName: "fk_orders_supplier" as PhysicalName,
          columnIds: ["c3" as LocalId],
          referencedTableId: suppliers.id,
          referencedColumnIds: ["s1" as LocalId],
          onDelete: "restrict",
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql", [suppliers]);
    expect(ddl).toContain("ALTER TABLE orders ADD CONSTRAINT fk_orders_supplier");
    expect(ddl).toContain("FOREIGN KEY (supplier_id) REFERENCES suppliers(id)");
    expect(ddl).toContain("ON DELETE RESTRICT");
  });

  it("FK に onUpdate が指定された場合は ON UPDATE も出力される (lowerCamelCase → UPPER 変換)", () => {
    const suppliers = suppliersTable();
    const table = baseTable({
      constraints: [
        {
          id: "fk-2" as LocalId,
          kind: "foreignKey",
          physicalName: "fk_cascade" as PhysicalName,
          columnIds: ["c3" as LocalId],
          referencedTableId: suppliers.id,
          referencedColumnIds: ["s1" as LocalId],
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql", [suppliers]);
    expect(ddl).toContain("ON DELETE CASCADE");
    expect(ddl).toContain("ON UPDATE CASCADE");
  });

  it("FK に onDelete / onUpdate が未指定の場合は出力しない", () => {
    const suppliers = suppliersTable();
    const table = baseTable({
      constraints: [
        {
          id: "fk-3" as LocalId,
          kind: "foreignKey",
          physicalName: "fk_bare" as PhysicalName,
          columnIds: ["c3" as LocalId],
          referencedTableId: suppliers.id,
          referencedColumnIds: ["s1" as LocalId],
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql", [suppliers]);
    expect(ddl).not.toContain("ON DELETE");
    expect(ddl).not.toContain("ON UPDATE");
  });

  it("constraints が未定義の場合は ALTER TABLE を出力しない", () => {
    const table = baseTable();
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).not.toContain("ALTER TABLE");
  });

  it("複数制約が順序通り出力される", () => {
    const table = baseTable({
      constraints: [
        { id: "uq-1" as LocalId, kind: "unique", physicalName: "uq_po_number" as PhysicalName, columnIds: ["c4" as LocalId] },
        { id: "chk-1" as LocalId, kind: "check", physicalName: "chk_amount" as PhysicalName, expression: "amount > 0" },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    const uqPos = ddl.indexOf("uq_po_number");
    const chkPos = ddl.indexOf("chk_amount");
    expect(uqPos).toBeGreaterThan(-1);
    expect(chkPos).toBeGreaterThan(-1);
    expect(uqPos).toBeLessThan(chkPos);
  });

  it("MySQL でも同じ ALTER TABLE 構文が出力される", () => {
    const table = baseTable({
      constraints: [
        { id: "uq-1" as LocalId, kind: "unique", physicalName: "uq_po" as PhysicalName, columnIds: ["c4" as LocalId] },
      ],
    });
    const ddl = generateDdl(table, "mysql");
    expect(ddl).toContain("ALTER TABLE orders ADD CONSTRAINT uq_po UNIQUE (po_number);");
  });

  it("FK noConstraint=true は DDL に出力しない (論理 FK のみ)", () => {
    const suppliers = suppliersTable();
    const table = baseTable({
      constraints: [
        {
          id: "fk-logical" as LocalId,
          kind: "foreignKey",
          physicalName: "fk_logical" as PhysicalName,
          columnIds: ["c3" as LocalId],
          referencedTableId: suppliers.id,
          referencedColumnIds: ["s1" as LocalId],
          noConstraint: true,
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql", [suppliers]);
    expect(ddl).not.toContain("FOREIGN KEY");
  });
});

describe("generateDdl — indexes (v3)", () => {
  it("シンプルなインデックスが CREATE INDEX として出力される", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-1" as LocalId, physicalName: "idx_orders_created_at" as PhysicalName, columns: [{ columnId: "c5" as LocalId }] },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("CREATE INDEX idx_orders_created_at ON orders (created_at);");
  });

  it("UNIQUE インデックスが CREATE UNIQUE INDEX として出力される", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-2" as LocalId, physicalName: "idx_uq_po_number" as PhysicalName, columns: [{ columnId: "c4" as LocalId }], unique: true },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("CREATE UNIQUE INDEX idx_uq_po_number ON orders (po_number);");
  });

  it("複合インデックスがカンマ区切りで出力される", () => {
    const table = baseTable({
      indexes: [
        {
          id: "idx-3" as LocalId,
          physicalName: "idx_supplier_status" as PhysicalName,
          columns: [{ columnId: "c3" as LocalId }, { columnId: "c2" as LocalId }],
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("(supplier_id, amount)");
  });

  it("DESC 列が DESC 付きで出力される", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-4" as LocalId, physicalName: "idx_amount_desc" as PhysicalName, columns: [{ columnId: "c2" as LocalId, order: "desc" }] },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("(amount DESC)");
  });

  it("ASC 列は何も付かない", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-5" as LocalId, physicalName: "idx_amount_asc" as PhysicalName, columns: [{ columnId: "c2" as LocalId, order: "asc" }] },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("(amount)");
    expect(ddl).not.toContain("ASC");
  });

  it("WHERE 句が指定された場合は部分インデックスとして出力される", () => {
    const table = baseTable({
      indexes: [
        {
          id: "idx-6" as LocalId,
          physicalName: "idx_partial" as PhysicalName,
          columns: [{ columnId: "c3" as LocalId }],
          where: "amount > 0",
        },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("WHERE amount > 0");
  });

  it("PostgreSQL + hash メソッドが USING HASH として出力される", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-7" as LocalId, physicalName: "idx_hash" as PhysicalName, columns: [{ columnId: "c4" as LocalId }], method: "hash" },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("USING HASH");
  });

  it("btree メソッドは USING 句を出力しない", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-8" as LocalId, physicalName: "idx_btree" as PhysicalName, columns: [{ columnId: "c2" as LocalId }], method: "btree" },
      ],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).not.toContain("USING");
  });

  it("MySQL では USING を出力しない (btree 以外でも)", () => {
    const table = baseTable({
      indexes: [
        { id: "idx-9" as LocalId, physicalName: "idx_hash_mysql" as PhysicalName, columns: [{ columnId: "c2" as LocalId }], method: "hash" },
      ],
    });
    const ddl = generateDdl(table, "mysql");
    expect(ddl).not.toContain("USING");
  });

  it("indexes が空の場合は CREATE INDEX を出力しない", () => {
    const table = baseTable();
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).not.toContain("CREATE INDEX");
  });
});

describe("generateDdl — defaults (v3)", () => {
  it("literal DEFAULT が ALTER TABLE SET DEFAULT として出力される", () => {
    const table = baseTable({
      defaults: [{ columnId: "c2" as LocalId, kind: "literal", value: "0" }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("ALTER TABLE orders ALTER COLUMN amount SET DEFAULT 0;");
  });

  it("function DEFAULT が ALTER TABLE SET DEFAULT として出力される", () => {
    const table = baseTable({
      defaults: [{ columnId: "c5" as LocalId, kind: "function", value: "NOW()" }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT NOW();");
  });

  it("sequence DEFAULT が PostgreSQL で nextval() を使用する", () => {
    const table = baseTable({
      defaults: [{ columnId: "c1" as LocalId, kind: "sequence", value: "orders_id_seq" }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("SET DEFAULT nextval('orders_id_seq');");
  });

  it("convention DEFAULT が DEFAULT NULL /* @conv.* */ として出力される (旧 conventionRef → convention)", () => {
    const table = baseTable({
      defaults: [{ columnId: "c4" as LocalId, kind: "convention", value: "@conv.numbering.orderNumber" }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("SET DEFAULT NULL /* @conv.numbering.orderNumber */;");
  });

  it("defaults が未定義の場合は ALTER TABLE ALTER COLUMN を出力しない", () => {
    const table = baseTable();
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).not.toContain("ALTER COLUMN");
  });
});

describe("generateDdl — triggers (v3)", () => {
  it("PostgreSQL トリガーが CREATE FUNCTION + CREATE TRIGGER として出力される", () => {
    const table = baseTable({
      triggers: [{
        id: "trg-1" as LocalId,
        physicalName: "trg_po_number" as PhysicalName,
        timing: "BEFORE",
        events: ["INSERT"],
        body: "NEW.po_number := 'ORD-001';",
        description: "発注番号採番",
      }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("CREATE OR REPLACE FUNCTION trg_po_number_fn()");
    expect(ddl).toContain("CREATE TRIGGER trg_po_number");
    expect(ddl).toContain("BEFORE INSERT ON orders");
    expect(ddl).toContain("FOR EACH ROW EXECUTE FUNCTION trg_po_number_fn();");
  });

  it("複数イベントが OR 区切りで出力される", () => {
    const table = baseTable({
      triggers: [{
        id: "trg-2" as LocalId,
        physicalName: "trg_audit" as PhysicalName,
        timing: "AFTER",
        events: ["INSERT", "UPDATE"],
        body: "-- audit",
      }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("AFTER INSERT OR UPDATE ON orders");
  });

  it("WHEN 句が指定された場合は WHEN (条件) として出力される", () => {
    const table = baseTable({
      triggers: [{
        id: "trg-3" as LocalId,
        physicalName: "trg_cond" as PhysicalName,
        timing: "BEFORE",
        events: ["UPDATE"],
        whenCondition: "NEW.status IS DISTINCT FROM OLD.status",
        body: "-- status changed",
      }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("WHEN (NEW.status IS DISTINCT FROM OLD.status)");
  });

  it("MySQL ではシンプルな CREATE TRIGGER を出力する", () => {
    const table = baseTable({
      triggers: [{
        id: "trg-4" as LocalId,
        physicalName: "trg_simple" as PhysicalName,
        timing: "BEFORE",
        events: ["INSERT"],
        body: "SET NEW.created_at = NOW();",
      }],
    });
    const ddl = generateDdl(table, "mysql");
    expect(ddl).toContain("CREATE TRIGGER trg_simple");
    expect(ddl).toContain("BEFORE INSERT ON orders");
    expect(ddl).not.toContain("CREATE OR REPLACE FUNCTION");
  });

  it("triggers が未定義の場合は CREATE TRIGGER を出力しない", () => {
    const table = baseTable();
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).not.toContain("CREATE TRIGGER");
  });

  it("INSTEAD_OF / TRUNCATE が v3 で対応", () => {
    const table = baseTable({
      triggers: [{
        id: "trg-5" as LocalId,
        physicalName: "trg_io" as PhysicalName,
        timing: "INSTEAD_OF",
        events: ["TRUNCATE"],
        body: "-- block truncate",
      }],
    });
    const ddl = generateDdl(table, "postgresql");
    expect(ddl).toContain("INSTEAD OF TRUNCATE ON orders");
  });
});
