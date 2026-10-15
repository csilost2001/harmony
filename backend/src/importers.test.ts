import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildHarmonyAjv, buildXlsx, importOpenApi, readXlsx, rowsToTsv } from "@harmony/shared";

const schemasDir = path.resolve(__dirname, "../../schemas/v3");
function flowValidator() {
  const ajv = buildHarmonyAjv();
  for (const f of fs.readdirSync(schemasDir).filter((n) => n.endsWith(".json"))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(schemasDir, f), "utf-8")));
  const id = JSON.parse(fs.readFileSync(path.join(schemasDir, "process-flow.v3.schema.json"), "utf-8")).$id;
  return ajv.getSchema(id)!;
}

const SPEC = {
  openapi: "3.0.3", info: { title: "注文 API" },
  security: [{ bearer: [] }],
  components: {
    schemas: { Order: { type: "object", required: ["id"], properties: { id: { type: "integer" }, total: { type: "number" }, placedAt: { type: "string", format: "date-time" } } } },
    parameters: { OrderId: { name: "orderId", in: "path", required: true, schema: { type: "integer" }, description: "注文 ID" } },
  },
  paths: {
    "/orders/{orderId}": {
      parameters: [{ $ref: "#/components/parameters/OrderId" }],
      get: { operationId: "getOrder", summary: "注文を取得", responses: { "200": { description: "成功", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } }, "404": { description: "なし" }, default: { description: "その他" } } },
    },
    "/orders": {
      post: { operationId: "createOrder", summary: "注文を作成", security: [], requestBody: { content: { "application/json": { schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "string" } }, note: { type: "string" } } } } } }, responses: { "201": { description: "作成" } } },
    },
  },
};

describe("OpenAPI の取り込み", () => {
  const r = importOpenApi(SPEC);
  it("operation ごとに、入口・入力・出力・応答をもつ処理フローの骨組みを作る", () => {
    expect(r.flows.map((f) => f.id)).toEqual(["get-order", "create-order"]);
    const get = r.flows[0].flow.actions[0] as Record<string, unknown>;
    expect(get.httpRoute).toEqual({ method: "GET", path: "/orders/:orderId", auth: "required" });
    expect(get.inputs).toEqual([{ name: "orderId", type: "integer", required: true, description: "注文 ID" }]);
    expect((get.outputs as Array<{ name: string; type: unknown }>).map((o) => [o.name, o.type])).toEqual([["id", "integer"], ["total", "number"], ["placedAt", "datetime"]]);
    expect((get.responses as Array<{ id: string }>).map((x) => x.id)).toEqual(["200-ok", "404-not-found"]);
    const post = r.flows[1].flow.actions[0] as Record<string, unknown>;
    expect((post.httpRoute as { auth: string }).auth).toBe("none"); // operation の security: [] は、全体の設定を打ち消す
    expect(post.inputs).toEqual([{ name: "items", type: { kind: "array", itemType: "string" }, required: true }, { name: "note", type: "string" }]);
    expect(r.warnings.some((w) => w.includes("default"))).toBe(true);
  });
  it("作った処理フローは、処理フローのスキーマに合う", () => {
    const validate = flowValidator();
    for (const f of r.flows) {
      const doc = { ...f.flow, meta: { ...f.flow.meta, uuid: "10d555e2-8041-4192-86f3-9e2a3ac581ab", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } };
      expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it("共通のスキーマを多数の operation から $ref で参照しても、結果の大きさと時間に上限がある (警告して打ち切る)", () => {
    const props = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`p${i}`, { type: "string" }]));
    const paths = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`/r${i}`, { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Big" } } } }, responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Big" } } } } } } }]));
    const t0 = Date.now();
    const r = importOpenApi({ openapi: "3.0.0", components: { schemas: { Big: { type: "object", properties: props } } }, paths });
    expect(Date.now() - t0).toBeLessThan(3000);
    const fields = r.flows.reduce((n, f) => n + ((f.flow.actions[0].inputs as unknown[] | undefined)?.length ?? 0) + ((f.flow.actions[0].outputs as unknown[] | undefined)?.length ?? 0), 0);
    expect(fields).toBeLessThanOrEqual(50_000);
    expect(JSON.stringify(r).length).toBeLessThan(20_000_000);
    expect(r.flows[0].flow.actions[0].inputs).toHaveLength(200); // 1 つのスキーマは 200 個まで
    expect(r.warnings.some((w) => w.includes("項目が多いため"))).toBe(true);
  });
  it("読めない文書・外部参照・同名の operation は、止まらずに扱う", () => {
    expect(importOpenApi("x").warnings[0]).toContain("OpenAPI");
    const dup = importOpenApi({ openapi: "3.0.0", paths: { "/a": { get: { operationId: "x", responses: {} }, post: { operationId: "x", responses: {} } } } });
    expect(dup.flows.map((f) => f.id)).toEqual(["x", "x-2"]);
    const ext = importOpenApi({ openapi: "3.0.0", paths: { "/a": { get: { parameters: [{ $ref: "other.yaml#/p" }], responses: {} } } } });
    expect(ext.warnings.some((w) => w.includes("外部の参照"))).toBe(true);
  });
});

describe("Excel の読み込み", () => {
  const inflate = async (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));
  it("書き出した xlsx を、行・セルとして読み戻せる (空のセル・改行・記号を含む)", async () => {
    const bytes = buildXlsx([{ name: "カラム", rows: [{ cells: ["物理名", "表示名", "型"], style: 1 }, { cells: ["id", "ID & 番号", "BIGINT"] }, { cells: ["a", "", "x\ny"] }] }]);
    const sheets = await readXlsx(bytes, inflate);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("カラム");
    expect(sheets[0].rows).toEqual([["物理名", "表示名", "型"], ["id", "ID & 番号", "BIGINT"], ["a", "", "x\ny"]]);
    expect(rowsToTsv(sheets[0].rows)).toBe("物理名\t表示名\t型\nid\tID & 番号\tBIGINT\na\t\tx y");
  });
  it("共有文字列・数値のセルを読める (Excel が作る形)", async () => {
    // Excel が作る形: sharedStrings と、t="s" / 数値のセル
    const { createZip } = await import("@harmony/shared");
    const zip = createZip([
      { name: "xl/workbook.xml", data: '<workbook xmlns:r="x"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/sharedStrings.xml", data: '<sst><si><t>名前</t></si><si><r><t>田</t></r><r><t>中</t></r></si></sst>' },
      { name: "xl/worksheets/sheet1.xml", data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="3"><c r="B3" t="s"><v>1</v></c></row></sheetData></worksheet>' },
    ]);
    const [s] = await readXlsx(zip, inflate);
    expect(s.rows).toEqual([["名前", "", "42"], [], ["", "田中"]]);
  });
  const sheetZip = async (sheetXml: string) => {
    const { createZip } = await import("@harmony/shared");
    return createZip([
      { name: "xl/workbook.xml", data: '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    ]);
  };
  it("行番号が上限 (2 万行) を超える行は、読み飛ばす。数百バイトのファイルが、巨大な配列を作らない・画面を止めない", async () => {
    const t0 = Date.now();
    const [s] = await readXlsx(await sheetZip('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>先頭</t></is></c></row><row r="4294967294"><c r="A1" t="inlineStr"><is><t>遠い行</t></is></c></row><row r="100000000"><c r="A1"><v>1</v></c></row><row r="20001"><c r="A1"><v>2</v></c></row><row r="20000"><c r="A1"><v>末尾</v></c></row></sheetData></worksheet>'), inflate);
    expect(s.rows.length).toBe(20000); // 20000 行目 (最後の行) まで。それより後ろは読まない
    expect(s.rows[0]).toEqual(["先頭"]);
    expect(s.rows[19999]).toEqual(["末尾"]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rowsToTsv(s.rows).length).toBeLessThan(100_000);
  });
  it("閉じていないタグを大量に並べても、入力の大きさに比例した時間で済む (数十万要素でも 1 秒台)", async () => {
    const t0 = Date.now();
    const [s] = await readXlsx(await sheetZip(`<worksheet><sheetData>${"<row>".repeat(300_000)}</sheetData></worksheet>`), inflate);
    expect(s.rows).toEqual([]);
    const [s2] = await readXlsx(await sheetZip(`<worksheet><sheetData><row r="1">${"<c r=\"A1\"><is><t>".repeat(200_000)}</row></sheetData></worksheet>`), inflate);
    expect(s2.rows.length).toBeLessThanOrEqual(1);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it("タグ名の続き (`<rows>`・`<tr>` を `<row>`・`<t>` と取り違えない)・列の上限・自己終了の要素を扱う", async () => {
    const [s] = await readXlsx(await sheetZip('<worksheet><sheetData><rows><row r="1"><c r="A1" t="inlineStr"><is><tr>x</tr><t>本物</t></is></c><c r="B1"/><c r="GZZ1"><v>9</v></c></row></rows></sheetData></worksheet>'), inflate);
    expect(s.rows).toEqual([["本物", ""]]); // GZZ は 200 列を超える。B1 は空
  });
  it("xlsx でないファイルは、日本語の理由で失敗する", async () => {
    const { createZip } = await import("@harmony/shared");
    await expect(readXlsx(createZip([{ name: "a.txt", data: "x" }]), inflate)).rejects.toThrow(/Excel/);
  });
});
