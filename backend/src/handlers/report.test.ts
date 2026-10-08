/**
 * 帳票: 保存 (id の固定・作成日時の保持・$schema)、MCP tool (一覧・取得・保存・削除と検証結果)、
 * 画面 / テーブル ID の改名への追従 (取り消しも含む)、schema への適合 (サンプル含む)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildHarmonyAjv } from "@harmony/shared";
import { handleReportTool } from "./report.js";
import { readReport, writeScreenEntity, writeTable, deleteReport } from "../projectStorage.js";
import { renameEntityId, undoEntityRename } from "../renameEntity.js";

const ROOT = path.join(os.tmpdir(), `report-${process.pid}-${Date.now()}`);
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await handleReportTool(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return JSON.parse(res.content[0].text);
};
const report = (extra: Record<string, unknown> = {}) => ({
  name: "納品書",
  output: { format: "pdf", paper: "A4", orientation: "portrait" },
  trigger: { kind: "screen", screenRef: "cart" },
  params: [{ id: "orderId", label: "注文" }],
  sections: [
    { id: "lines", kind: "detail", name: "明細", fields: [
      { id: "name", kind: "field", label: "商品名", source: "item.name_col", width: 60 },
      { id: "qty", kind: "field", label: "数量", source: "item.qty_col", format: "#,##0", align: "right", width: 40 },
    ] },
    { id: "total", kind: "reportFooter", fields: [{ id: "sum", kind: "aggregate", label: "合計", source: "item.qty_col", aggregate: "sum" }] },
  ],
  ...extra,
});
const ts = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-00000000000a", name: "t", createdAt: ts, updatedAt: ts },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }], tables: [{ id: "item", name: "明細" }] },
  }));
  await writeScreenEntity("cart", { id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart", createdAt: ts, updatedAt: ts, items: [] }, ROOT);
  await writeTable("item", {
    id: "item", uuid: "22222222-2222-4222-8222-222222222222", name: "明細", physicalName: "item", createdAt: ts, updatedAt: ts,
    columns: [{ id: "name-col", physicalName: "name_col", name: "名", dataType: "VARCHAR", length: 50 }, { id: "qty-col", physicalName: "qty_col", name: "数", dataType: "INTEGER" }],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("帳票の MCP tool", () => {
  it("保存すると id がファイル名に固定され、$schema と日時が付き、検証の指摘は無い", async () => {
    expect((await call("designer__list_reports", {})).reports).toEqual([]);
    const res = await call("designer__save_report", { reportId: "note", report: report({ id: "別の id" }) });
    expect(res.saved).toBe(true);
    expect(res.counts).toEqual({ error: 0, warning: 0, info: 0 });
    const raw = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "reports", "note.json"), "utf-8"));
    expect(raw.id).toBe("note");
    expect(raw.$schema).toContain("report.v3.schema.json");
  });

  it("上書きしても作成日時は変わらない", async () => {
    const before = await readReport("note", ROOT);
    await new Promise((r) => setTimeout(r, 5));
    await call("designer__save_report", { reportId: "note", report: report({ name: "納品書 (改)" }) });
    const after = await readReport("note", ROOT);
    expect(after!.createdAt).toBe(before!.createdAt);
    expect(after!.updatedAt).not.toBe(before!.updatedAt);
  });

  it("問題があっても保存し、検証結果を返す (存在しない列・画面)", async () => {
    const r = report({ trigger: { screenRef: "ghost" } });
    (r.sections[0].fields as any[])[0].source = "item.ghost_col";
    const res = await call("designer__save_report", { reportId: "broken", report: r });
    expect(res.saved).toBe(true);
    expect(res.issues.map((i: any) => i.code).sort()).toEqual(["unknown-column", "unknown-screen"]);
    const list = await call("designer__list_reports", {});
    expect(list.reports.map((x: any) => [x.id, x.sections, x.fields])).toEqual([["broken", 2, 3], ["note", 2, 3]]);
    expect((await call("designer__get_report", { reportId: "broken" })).issues).toHaveLength(2);
  });

  it("形が違うものは保存しない / 不正な id を拒否する", async () => {
    await expect(call("designer__save_report", { reportId: "bad", report: { name: "x" } })).rejects.toThrow();
    await expect(call("designer__save_report", { reportId: "Bad Id", report: report() })).rejects.toThrow();
  });

  it("画面・テーブル ID の改名に追従し、取り消すと戻る", async () => {
    const a = await renameEntityId("screen", "cart", "basket", ROOT);
    expect((await readReport("note", ROOT))!.trigger).toMatchObject({ screenRef: "basket" });
    await undoEntityRename(a.operation.operationId, ROOT);
    expect((await readReport("note", ROOT))!.trigger).toMatchObject({ screenRef: "cart" });

    const b = await renameEntityId("table", "item", "line", ROOT);
    const renamed = await readReport("note", ROOT) as any;
    expect(renamed.sections[0].fields[0].source).toBe("line.name_col");
    expect(renamed.sections[1].fields[0].source).toBe("line.qty_col");
    await undoEntityRename(b.operation.operationId, ROOT);
    expect((await readReport("note", ROOT) as any).sections[0].fields[0].source).toBe("item.name_col");
  });

  it("削除できる。無いものは false", async () => {
    expect((await call("designer__delete_report", { reportId: "broken" })).deleted).toBe(true);
    expect(await deleteReport("broken", ROOT)).toBe(false);
  });
});

describe("report.v3.schema", () => {
  const SCHEMAS = path.resolve(__dirname, "../../../schemas/v3");
  const compile = async () => {
    const ajv = buildHarmonyAjv();
    for (const f of ["common.v3.schema.json", "report.v3.schema.json"]) ajv.addSchema(JSON.parse(await fs.readFile(path.join(SCHEMAS, f), "utf-8")));
    return ajv.getSchema("https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/report.v3.schema.json")!;
  };
  it("保存した原本と retail のサンプルはスキーマに適合する", async () => {
    const validate = await compile();
    expect(validate(await readReport("note", ROOT)), JSON.stringify(validate.errors)).toBe(true);
    const dir = path.resolve(__dirname, "../../../examples/retail/harmony/reports");
    for (const f of await fs.readdir(dir)) {
      const d = JSON.parse(await fs.readFile(path.join(dir, f), "utf-8"));
      expect(validate(d), `${f}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });
  it("未知のプロパティ・不正な部の種類は不適合", async () => {
    const validate = await compile();
    const d = JSON.parse(JSON.stringify(await readReport("note", ROOT)));
    d.sections[0].kind = "weird";
    expect(validate(d)).toBe(false);
    d.sections[0].kind = "detail"; d.extra = 1;
    expect(validate(d)).toBe(false);
  });
});
