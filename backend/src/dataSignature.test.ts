import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable } from "./projectStorage.js";
import { dataSignature, memoizeBySignature } from "./dataSignature.js";
import { collectSchemaIssues } from "./schemaIssues.js";

const ROOT = path.join(os.tmpdir(), `data-signature-${process.pid}-${Date.now()}`);
const ts = "2026-01-01T00:00:00.000Z";
const table = (columns: unknown[]) => ({ id: "t1", uuid: "44444444-4444-4444-8444-444444444451", physicalName: "t1", name: "表", createdAt: ts, updatedAt: ts, columns });
const col = { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true };

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000d", name: "t", createdAt: ts, updatedAt: ts }, entities: {} }));
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("データの署名と、結果の使い回し", () => {
  it("ファイルが変わると署名が変わり、変わらなければ同じ", async () => {
    await writeTable("t1", table([col]), ROOT);
    const a = await dataSignature(ROOT);
    expect(await dataSignature(ROOT)).toBe(a);
    await new Promise((r) => setTimeout(r, 20));
    await writeTable("t1", table([col, { ...col, id: "x", no: 2, physicalName: "x" }]), ROOT);
    expect(await dataSignature(ROOT)).not.toBe(a);
  });

  it("署名が同じあいだは再計算せず (同時の問い合わせも共有)、変わったら再計算する", async () => {
    let n = 0;
    const memo = memoizeBySignature(async () => ++n);
    const [x, y] = await Promise.all([memo(ROOT), memo(ROOT)]);
    expect([x, y, await memo(ROOT)]).toEqual([1, 1, 1]);
    await new Promise((r) => setTimeout(r, 20));
    await writeTable("t1", table([col]), ROOT);
    expect(await memo(ROOT)).toBe(2);
  });

  it("スキーマ違反の検査は、データを直すと結果が変わる (古い結果を返さない)", async () => {
    await new Promise((r) => setTimeout(r, 20));
    await writeTable("t1", table([]), ROOT);
    expect((await collectSchemaIssues(ROOT)).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 20));
    await writeTable("t1", table([col]), ROOT);
    expect(await collectSchemaIssues(ROOT)).toEqual([]);
  });
});
