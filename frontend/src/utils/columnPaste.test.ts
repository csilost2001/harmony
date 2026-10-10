import { describe, it, expect } from "vitest";
import { headerField, parseBoolean, parseColumnTable, parseDataType, splitDuplicates, toPhysicalName } from "./columnPaste";

describe("型の書き方", () => {
  it("長さ・小数桁つきを分ける", () => {
    expect(parseDataType("VARCHAR(100)")).toMatchObject({ dataType: "VARCHAR", length: 100, known: true });
    expect(parseDataType("decimal(10, 2)")).toMatchObject({ dataType: "DECIMAL", length: 10, scale: 2 });
    expect(parseDataType("NUMBER（8）")).toMatchObject({ dataType: "DECIMAL", length: 8 });
  });
  it("別名を組み込みの型に直す", () => {
    expect(parseDataType("int").dataType).toBe("INTEGER");
    expect(parseDataType("文字列").dataType).toBe("VARCHAR");
    expect(parseDataType("datetime").dataType).toBe("TIMESTAMP");
    expect(parseDataType("bool").dataType).toBe("BOOLEAN");
  });
  it("知らない型はそのまま大文字にし、known=false", () => {
    expect(parseDataType("geometry")).toMatchObject({ dataType: "GEOMETRY", known: false });
  });
});

describe("真偽・物理名・見出し", () => {
  it("真偽の書き方", () => {
    for (const t of ["○", "〇", "✓", "Y", "1", "true", "はい", "レ"]) expect(parseBoolean(t)).toBe(true);
    for (const t of ["", "×", "-", "N", "0", "false", "いいえ"]) expect(parseBoolean(t)).toBe(false);
    expect(parseBoolean("たぶん")).toBeUndefined();
  });
  it("物理名を snake_case に寄せる", () => {
    expect(toPhysicalName("customerId")).toEqual({ value: "customer_id", changed: true });
    expect(toPhysicalName("customer_id")).toEqual({ value: "customer_id", changed: false });
    expect(toPhysicalName("Order Item")).toEqual({ value: "order_item", changed: true });
  });
  it("見出しの名前から項目を決める (表記ゆれを許す)", () => {
    expect(headerField("物理名")).toBe("physicalName");
    expect(headerField("NOT NULL")).toBe("notNull");
    expect(headerField("PK")).toBe("primaryKey");
    expect(headerField("データ型")).toBe("dataType");
    expect(headerField("備考")).toBe("comment");
    expect(headerField("関係のない列")).toBeNull();
  });
});

describe("表の貼り付け", () => {
  it("見出しつき (タブ区切り・列の順は自由) を読む", () => {
    const text = ["論理名\t物理名\tデータ型\t桁数\tPK\tNOT NULL\t備考", "顧客ID\tcustomer_id\tBIGINT\t\t○\t○\t採番", "顧客名\tcustomer_name\tvarchar(100)\t\t\t○\t"].join("\n");
    const r = parseColumnTable(text);
    expect(r.headerDetected).toBe(true);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", primaryKey: true, notNull: true, comment: "採番" });
    expect(r.columns[1]).toMatchObject({ physicalName: "customer_name", dataType: "VARCHAR", length: 100, notNull: true });
    expect(r.warnings).toEqual([]);
  });

  it("見出しなしは、物理名・表示名・型・長さ… の順とみなす", () => {
    const r = parseColumnTable("id\tID\tbigint\t\t○\t○\nname\t名前\tvarchar\t50");
    expect(r.headerDetected).toBe(false);
    expect(r.columns[0]).toMatchObject({ physicalName: "id", name: "ID", dataType: "BIGINT", notNull: true, primaryKey: true });
    expect(r.columns[1]).toMatchObject({ physicalName: "name", name: "名前", dataType: "VARCHAR", length: 50 });
  });

  it("カンマ区切り (引用符つき) も読む", () => {
    const r = parseColumnTable('物理名,表示名,型\nprice,"価格, 税込",decimal(10,2)');
    expect(r.columns[0]).toMatchObject({ physicalName: "price", name: "価格, 税込", dataType: "DECIMAL", length: 10, scale: 2 });
  });

  it("空行・物理名のない行は読み飛ばし、問題は行番号つきで知らせる", () => {
    const r = parseColumnTable("物理名\t型\n\na\tint\n\tint\nB Col\ttext");
    expect(r.columns.map((c) => c.physicalName)).toEqual(["a", "b_col"]);
    expect(r.warnings.join("\n")).toContain("4 行目: 物理名が空");
    expect(r.warnings.join("\n")).toContain("「B Col」を「b_col」にしました");
  });

  it("型が空・知らない型・長さが数字でない値を知らせる", () => {
    const r = parseColumnTable("物理名\t型\t長さ\na\t\t10\nb\tgeometry\t大\n");
    expect(r.columns[0].dataType).toBe("VARCHAR");
    expect(r.warnings.join("\n")).toContain("型が空");
    expect(r.warnings.join("\n")).toContain("「geometry」は組み込みの型にありません");
    expect(r.warnings.join("\n")).toContain("長さ「大」");
  });

  it("貼り付けの中の重複を知らせる / 空なら空", () => {
    expect(parseColumnTable("a\tx\tint\na\ty\tint").warnings.join("")).toContain("重複");
    expect(parseColumnTable("   \n\n")).toEqual({ columns: [], warnings: [], headerDetected: false });
  });
});

describe("既存カラムとの重複", () => {
  it("同じ物理名は追加せず、別に返す", () => {
    const parsed = parseColumnTable("id\tID\tint\nname\t名前\ttext").columns;
    const { add, duplicates } = splitDuplicates(parsed, [{ physicalName: "id" as never }]);
    expect(add.map((c) => c.physicalName)).toEqual(["name"]);
    expect(duplicates.map((c) => c.physicalName)).toEqual(["id"]);
  });
});
