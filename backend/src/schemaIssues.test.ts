/**
 * 設計の原本のスキーマ違反: 保存しても原本に警告を書き込まず、読み込み時の検査 (collectSchemaIssues) で、
 * 日本語の「要確認」として出る。直せば出なくなる (解決済みの印を原本に残す必要がない)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, readTable, validateEntitySchema } from "./projectStorage.js";
import { collectSchemaIssues } from "./schemaIssues.js";

const ROOT = path.join(os.tmpdir(), `schema-issues-${process.pid}-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-00000000000a", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: {},
  }));
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

const table = (columns: unknown[]) => ({
  id: "customers", uuid: "44444444-4444-4444-8444-444444444444", physicalName: "customers", name: "顧客",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", columns,
});
const column = { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true };

describe("スキーマ違反の要確認", () => {
  it("違反 (カラムが 0 件) があっても保存でき、原本には警告を書き込まない。読み込み時の検査で、日本語の要確認として出る", async () => {
    await writeTable("customers", table([]), ROOT);
    const saved = await readTable("customers", ROOT) as { authoring?: { markers?: unknown[] } };
    expect(saved.authoring?.markers ?? []).toEqual([]);

    const issues = await collectSchemaIssues(ROOT);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning", section: "テーブル 顧客", ref: { kind: "table", id: "customers" } });
    expect(issues[0].message).toContain("スキーマ:");
    expect(issues[0].message).toContain("件数が少なすぎます");
  });

  it("直して保存すれば、要確認から消える", async () => {
    await writeTable("customers", table([column]), ROOT);
    expect(await collectSchemaIssues(ROOT)).toEqual([]);
  });
});

describe("工程の入れ子 (subSteps) のスキーマ (#1487)", () => {
  const load = async () => JSON.parse(await fs.readFile(path.resolve(__dirname, "../../examples/retail/harmony/process-flows/order-confirm.json"), "utf-8"));

  it("どの種類の工程にも subSteps を持たせられる (入れ子の中も)", async () => {
    const f = await load();
    const steps = f.actions[0].steps;
    steps[0].subSteps = [steps[1]];
    steps[0].subSteps[0].subSteps = [steps[2]];
    steps.splice(1, 2);
    expect(await validateEntitySchema("processFlow", f)).toEqual([]);
  });

  it("subSteps の中の工程も、スキーマで検査される (余計な項目は違反)", async () => {
    const f = await load();
    const steps = f.actions[0].steps;
    steps[0].subSteps = [{ ...steps[1], notAField: 1 }];
    steps.splice(1, 1);
    const errs = await validateEntitySchema("processFlow", f);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => e.instancePath.includes("/subSteps/0"))).toBe(true);
  });
});
