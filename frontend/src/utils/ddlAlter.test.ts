import { describe, it, expect } from "vitest";
import { alterToText, generateAlterDdl } from "./ddlAlter";
import { generateDdl, quoteIdentifier, type SqlDialect } from "./ddlGenerator";
import type { Table } from "../types/v3";

const col = (id: string, physicalName: string, extra: Record<string, unknown> = {}) => ({ id, physicalName, name: physicalName, dataType: "VARCHAR", length: 20, ...extra });
const table = (over: Record<string, unknown> = {}): Table => ({
  id: "orders", uuid: "11111111-1111-4111-8111-111111111111", name: "注文", physicalName: "orders", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  columns: [col("c1", "id", { dataType: "INTEGER", primaryKey: true, notNull: true }), col("c2", "memo"), col("c3", "qty", { dataType: "INTEGER" })],
  ...over,
} as unknown as Table);
const ALL: SqlDialect[] = ["mysql", "postgresql", "oracle", "sqlserver", "sqlite", "standard"];

describe("SQL Server の方言", () => {
  it("識別子は [ ] で引用し、型・自動採番・コメントを SQL Server の形にする", () => {
    expect(quoteIdentifier("a]b", "sqlserver")).toBe("[a]]b]");
    const ddl = generateDdl(table({ columns: [col("c1", "id", { dataType: "INTEGER", autoIncrement: true, primaryKey: true }), col("c2", "memo", { dataType: "TEXT" }), col("c3", "ok", { dataType: "BOOLEAN" }), col("c4", "at", { dataType: "TIMESTAMP" })], comment: "注文の表" }), "sqlserver");
    expect(ddl).toContain("CREATE TABLE [orders]");
    expect(ddl).toContain("[id] INTEGER IDENTITY(1,1)");
    expect(ddl).toContain("[memo] NVARCHAR(MAX)");
    expect(ddl).toContain("[ok] BIT");
    expect(ddl).toContain("[at] DATETIME2");
    expect(ddl).toContain("sp_addextendedproperty");
    expect(ddl).toContain("N'注文の表'");
  });
  it("トリガーは文単位 (AFTER / INSTEAD OF) の形。BEFORE は INSTEAD OF にして注意を添える", () => {
    const ddl = generateDdl(table({ triggers: [{ id: "t", physicalName: "trg", timing: "BEFORE", events: ["INSERT", "UPDATE"], body: "SELECT 1;" }] }), "sqlserver");
    expect(ddl).toContain("INSTEAD OF INSERT, UPDATE");
    expect(ddl).toContain("BEFORE トリガーは無い");
    expect(ddl).not.toContain("FOR EACH ROW");
  });
});

describe("版の差分から ALTER", () => {
  it("変更が無ければ空", () => {
    for (const d of ALL) expect(generateAlterDdl(table(), table(), d).empty).toBe(true);
    expect(alterToText(generateAlterDdl(table(), table(), "postgresql"))).toBe("-- 変更はありません");
  });

  it("列の追加・削除 (削除はデータを失うと注意を添える)", () => {
    const next = table({ columns: [col("c1", "id", { dataType: "INTEGER", primaryKey: true, notNull: true }), col("c3", "qty", { dataType: "INTEGER" }), col("c4", "price", { dataType: "DECIMAL", length: 10, scale: 2 })] });
    const pg = generateAlterDdl(table(), next, "postgresql");
    expect(pg.statements).toContain(`ALTER TABLE "orders" DROP COLUMN "memo";`);
    expect(pg.statements).toContain(`ALTER TABLE "orders" ADD COLUMN "price" DECIMAL(10, 2);`);
    expect(pg.destructive).toBe(1);
    expect(alterToText(pg)).toContain("データを失いうる変更が 1 件");
    expect(generateAlterDdl(table(), next, "oracle").statements).toContain(`ALTER TABLE "orders" ADD ("price" DECIMAL(10, 2));`);
    expect(generateAlterDdl(table(), next, "sqlserver").statements).toContain(`ALTER TABLE [orders] ADD [price] DECIMAL(10, 2);`);
    expect(generateAlterDdl(table(), next, "mysql").statements).toContain("ALTER TABLE `orders` ADD COLUMN `price` DECIMAL(10, 2);");
  });

  it("NOT NULL で既定値の無い列の追加は、注意を添える", () => {
    const next = table({ columns: [...table().columns, col("c9", "code", { notNull: true })] });
    expect(generateAlterDdl(table(), next, "postgresql").statements[0]).toContain("既定値の無い列");
  });

  it("物理名だけが変わった列は、RENAME (消して足さない)。テーブル名の変更も", () => {
    const next = table({ physicalName: "sales", columns: [col("c1", "id", { dataType: "INTEGER", primaryKey: true, notNull: true }), col("c2", "note"), col("c3", "qty", { dataType: "INTEGER" })] });
    const pg = generateAlterDdl(table(), next, "postgresql").statements;
    expect(pg[0]).toBe(`ALTER TABLE "orders" RENAME TO "sales";`);
    expect(pg).toContain(`ALTER TABLE "sales" RENAME COLUMN "memo" TO "note";`);
    expect(pg.some((s) => s.includes("DROP COLUMN"))).toBe(false);
    expect(generateAlterDdl(table(), next, "sqlserver").statements).toContain("EXEC sp_rename N'sales.memo', N'note', 'COLUMN';");
    expect(generateAlterDdl(table(), next, "mysql").statements[0]).toBe("RENAME TABLE `orders` TO `sales`;");
  });

  it("型・NOT NULL・既定値の変更を、方言ごとの文にする", () => {
    const next = table({ columns: [col("c1", "id", { dataType: "INTEGER", primaryKey: true, notNull: true }), col("c2", "memo", { length: 100, notNull: true, defaultValue: "'-'" }), col("c3", "qty", { dataType: "INTEGER" })] });
    const pg = generateAlterDdl(table(), next, "postgresql").statements.join("\n");
    expect(pg).toContain(`ALTER TABLE "orders" ALTER COLUMN "memo" TYPE VARCHAR(100);`);
    expect(pg).toContain(`ALTER COLUMN "memo" SET NOT NULL;`);
    expect(pg).toContain(`ALTER COLUMN "memo" SET DEFAULT '-';`);
    expect(generateAlterDdl(table(), next, "mysql").statements.join("\n")).toContain("MODIFY COLUMN `memo` VARCHAR(100) NOT NULL DEFAULT '-';");
    expect(generateAlterDdl(table(), next, "oracle").statements.join("\n")).toContain(`MODIFY ("memo" VARCHAR(100) DEFAULT '-' NOT NULL);`);
    expect(generateAlterDdl(table(), next, "sqlserver").statements.join("\n")).toContain("ALTER COLUMN [memo] NVARCHAR(100) NOT NULL;");
    expect(generateAlterDdl(table(), next, "sqlite").statements.join("\n")).toContain("SQLite は列の変更");
  });

  it("長さを縮めると、データを失いうる変更として数える", () => {
    const next = table({ columns: [col("c1", "id", { dataType: "INTEGER", primaryKey: true, notNull: true }), col("c2", "memo", { length: 5 }), col("c3", "qty", { dataType: "INTEGER" })] });
    const r = generateAlterDdl(table(), next, "postgresql");
    expect(r.destructive).toBe(1);
    expect(r.statements[0]).toContain("長さが縮みます");
  });

  it("インデックス・制約: 増えたものは作り、消えたものは外し、変わったものは作り直す", () => {
    const idx = (cols: string[], extra: Record<string, unknown> = {}) => ({ id: "i1", physicalName: "idx_memo", columns: cols.map((c) => ({ columnId: c })), ...extra });
    const a = table({ indexes: [idx(["c2"])], constraints: [{ id: "u1", kind: "unique", columnIds: ["c3"] }, { id: "k1", kind: "check", expression: "qty > 0" }] });
    const b = table({ indexes: [idx(["c2", "c3"])], constraints: [{ id: "k1", kind: "check", expression: "qty >= 0" }, { id: "k2", kind: "check", expression: "qty < 99" }] });
    const pg = generateAlterDdl(a, b, "postgresql").statements;
    expect(pg).toContain(`DROP INDEX "idx_memo";`);
    expect(pg.some((s) => s.startsWith(`CREATE INDEX "idx_memo" ON "orders" ("memo", "qty")`))).toBe(true);
    expect(pg).toContain(`ALTER TABLE "orders" DROP CONSTRAINT "u1";`);
    expect(pg).toContain(`ALTER TABLE "orders" DROP CONSTRAINT "k1";`);
    expect(pg.filter((s) => s.includes("ADD CONSTRAINT")).length).toBe(2); // k1 (作り直し) と k2 (新規)
    // 消すものは、足すものより前に出る
    expect(pg.findIndex((s) => s.includes("DROP CONSTRAINT"))).toBeLessThan(pg.findIndex((s) => s.includes("ADD CONSTRAINT")));
    expect(generateAlterDdl(a, b, "mysql").statements).toContain("DROP INDEX `idx_memo` ON `orders`;");
    expect(generateAlterDdl(a, b, "mysql").statements).toContain("ALTER TABLE `orders` DROP INDEX `u1`;");
    expect(generateAlterDdl(a, b, "mysql").statements).toContain("ALTER TABLE `orders` DROP CHECK `k1`;");
  });

  it("論理 FK (noConstraint) は DDL に出さない。主キーの指定の変更は、実行しない注意書きにする", () => {
    const a = table(), b = table({ constraints: [{ id: "fk", kind: "foreignKey", columnIds: ["c3"], referencedTableId: "orders", referencedColumnIds: ["c1"], noConstraint: true }], columns: [col("c1", "id", { dataType: "INTEGER", notNull: true }), col("c2", "memo"), col("c3", "qty", { dataType: "INTEGER" })] });
    const r = generateAlterDdl(a, b, "postgresql").statements;
    expect(r.some((s) => s.includes("FOREIGN KEY"))).toBe(false);
    expect(r.join("\n")).toContain("主キーの指定が変わりました");
    expect(r.every((s) => s.startsWith("--") || !/PRIMARY KEY/.test(s))).toBe(true);
  });

  it("前の版が無ければ CREATE、今の定義が無ければ DROP", () => {
    expect(generateAlterDdl(null, table(), "postgresql").statements[0]).toContain("CREATE TABLE");
    expect(generateAlterDdl(table(), null, "sqlserver")).toMatchObject({ statements: ["DROP TABLE [orders];"], destructive: 1 });
    expect(generateAlterDdl(null, null, "mysql").empty).toBe(true);
  });
});
