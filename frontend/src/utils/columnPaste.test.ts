import { describe, it, expect } from "vitest";
import { columnUpdates, columnsToTsv, headerField, parseRows, parseBoolean, parseColumnTable, parseDataType, splitDuplicates, toPhysicalName } from "./columnPaste";

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
    expect(parseColumnTable("   \n\n")).toEqual({ columns: [], warnings: [], headerDetected: false, fields: [] });
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

describe("カラムの表へ書き出し", () => {
  it("書き出した表を貼り付け直すと、同じカラムが読める (往復)", () => {
    const cols = [
      { id: "c1", physicalName: "id", name: "ID", dataType: "BIGINT", notNull: true, primaryKey: true, autoIncrement: true },
      { id: "c2", physicalName: "price", name: "価格", dataType: "DECIMAL", length: 10, scale: 2, notNull: true, defaultValue: "0", comment: "税込" },
      { id: "c3", physicalName: "note", name: "備考", dataType: "TEXT" },
    ] as never[];
    const tsv = columnsToTsv(cols);
    expect(tsv.split("\n")[0]).toBe("物理名\t表示名\tデータ型\t長さ\tNOT NULL\tPK\tUK\t連番\tデフォルト\t備考");
    const back = parseColumnTable(tsv);
    expect(back.warnings).toEqual([]);
    expect(back.columns).toEqual([
      { physicalName: "id", name: "ID", dataType: "BIGINT", notNull: true, primaryKey: true, autoIncrement: true },
      { physicalName: "price", name: "価格", dataType: "DECIMAL", length: 10, scale: 2, notNull: true, defaultValue: "0", comment: "税込" },
      { physicalName: "note", name: "備考", dataType: "TEXT" },
    ]);
  });
});

describe("Excel のコピー (引用符つきのセル)", () => {
  it("改名・引用符・タブを含むセルを `\"...\"` で囲んだ形を読む (備考に改行があっても、偽のカラムを作らない)", () => {
    const text = ["物理名\t表示名\t型\t備考", 'note\t備考\ttext\t"1 行目\n2 行目"', 'title\t題名\tvarchar(50)\t"""引用""付き"', "last\t最後\tint\t"].join("\n");
    const r = parseColumnTable(text);
    expect(r.columns.map((c) => c.physicalName)).toEqual(["note", "title", "last"]);
    expect(r.columns[0].comment).toBe("1 行目\n2 行目");
    expect(r.columns[1].comment).toBe('"引用"付き');
    expect(r.warnings).toEqual([]);
  });

  it("行番号は、貼り付けた文のとおり (複数行のセルがあっても数がずれない)", () => {
    const rows = parseRows('a\t"x\ny"\nb\tz', "\t");
    expect(rows.map((r) => [r.no, r.cells])).toEqual([[1, ["a", "x\ny"]], [3, ["b", "z"]]]);
    const r = parseColumnTable('物理名\t備考\nok\t"a\nb"\n\tx');
    expect(r.warnings.join("")).toContain("4 行目: 物理名が空");
  });

  it("書き出し (columnsToTsv) → 貼り付けの往復で、備考の改行は落とさず空白にする", () => {
    const tsv = columnsToTsv([{ id: "c", physicalName: "a", name: "A", dataType: "TEXT", comment: "x\ny" }] as never[]);
    expect(parseColumnTable(tsv).columns[0].comment).toBe("x y");
  });
});

describe("「NULL」の見出し (NOT NULL と取り違えない)", () => {
  it("「NULL 可」の列は、○ なら NOT NULL にしない / 空 (×) なら NOT NULL にする", () => {
    const r = parseColumnTable("物理名\t型\tNULL可\na\tint\t○\nb\tint\t\nc\tint\t×");
    expect(r.columns.map((c) => c.notNull)).toEqual([undefined, undefined, true]);
  });
  it("単独の「NULL」は見出しとして扱わない (意味が決められないので、列を読み飛ばす)", () => {
    expect(headerField("NULL")).toBeNull();
    expect(headerField("NULL可")).toBe("nullable");
  });
});

describe("閉じていない引用符", () => {
  it("警告を出す (以降の行が 1 セルに吸収されたことに気づけるように)", () => {
    const r = parseColumnTable('物理名\ta\tb\nx\t"閉じていない\ny\tz');
    expect(r.warnings.join("")).toContain("閉じていない引用符");
  });
});

describe("既存カラムの更新 (同じ物理名の行)", () => {
  const existing = [
    { id: "c1", physicalName: "id", name: "ID", dataType: "BIGINT", notNull: true, primaryKey: true },
    { id: "c2", physicalName: "price", name: "価格", dataType: "DECIMAL", length: 10, scale: 2, comment: "旧" },
    { id: "c3", physicalName: "note", name: "備考", dataType: "TEXT" },
  ] as never[];

  it("表にある項目だけを書き換える (表に無い項目は既存のまま)。変わらないカラムは出さない", () => {
    const r = parseColumnTable("物理名\t表示名\t備考\nprice\t税込価格\t\nid\tID\t\nnote\t備考\t新しい説明");
    const up = columnUpdates(r.columns, existing, r.fields);
    expect(up.map((u) => u.physicalName)).toEqual(["price", "note"]);
    expect(up[0].patch).toEqual({ name: "税込価格", comment: undefined });
    expect(up[1].patch).toEqual({ comment: "新しい説明" });
    // 表に無い「データ型」「長さ」は、既存のまま
    expect(Object.keys(up[0].patch)).not.toContain("dataType");
  });

  it("型の列があるとき、型と長さを書き換え、空の長さは外す。型が空なら既存のまま", () => {
    const r = parseColumnTable("物理名\tデータ型\tNOT NULL\nprice\tdecimal(12,3)\t○\nnote\t\t");
    const up = columnUpdates(r.columns, existing, r.fields);
    expect(up.find((u) => u.physicalName === "price")?.patch).toMatchObject({ length: 12, scale: 3, notNull: true });
    expect(up.find((u) => u.physicalName === "note")).toBeUndefined();
  });

  it("既存に無い物理名は更新の対象にしない", () => {
    const r = parseColumnTable("物理名\t表示名\nnew_col\t新規");
    expect(columnUpdates(r.columns, existing, r.fields)).toEqual([]);
  });
});

describe("既存カラムの更新: 空欄の扱い", () => {
  const existing = [{ id: "c1", physicalName: "name", name: "氏名", dataType: "VARCHAR", length: 50, notNull: false }] as never[];
  it("表示名が空欄なら、既存の表示名は書き換えない", () => {
    const r = parseColumnTable("物理名\t表示名\nname\t");
    expect(columnUpdates(r.columns, existing, r.fields)).toEqual([]);
  });
  it("NOT NULL が false の既存と、空欄 (未設定) は、同じ扱い (変更として数えない)", () => {
    const r = parseColumnTable("物理名\tNOT NULL\nname\t");
    expect(columnUpdates(r.columns, existing, r.fields)).toEqual([]);
  });
});

