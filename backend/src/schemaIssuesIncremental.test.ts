/**
 * スキーマ違反の検査の増分化: 変わっていないファイルは、検査し直さない (validateEntitySchema の呼び出し回数で確かめる)。
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("./projectStorage.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./projectStorage.js")>();
  return { ...orig, validateEntitySchema: vi.fn(orig.validateEntitySchema) };
});

import { ensureDataDir, harmonyFile, validateEntitySchema, writeTable } from "./projectStorage.js";
import { collectSchemaIssues } from "./schemaIssues.js";

const TMP = path.join(os.tmpdir(), `schema-incr-${process.pid}-${Date.now()}`);
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

describe("collectSchemaIssues の増分化", () => {
  it("1 件だけ保存したあとの再検査は、その 1 件だけを検査し直す", async () => {
    const root = path.join(TMP, "ws");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(harmonyFile(root), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "si", name: "si", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, extensionsApplied: [], entities: {} }));
    await ensureDataDir(root, "harmony");
    const col = { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true };
    const tbl = (i: number, columns: unknown[]) => ({
      id: `t-${i}`, uuid: `55555555-5555-4555-8555-55555555555${i}`, physicalName: `t_${i}`, name: `表${i}`,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", columns,
    });
    for (let i = 0; i < 5; i++) await writeTable(`t-${i}`, tbl(i, [col]), root);
    expect(await collectSchemaIssues(root)).toEqual([]);
    const calls = vi.mocked(validateEntitySchema);
    expect(calls.mock.calls.length).toBeGreaterThanOrEqual(5);

    calls.mockClear();
    await new Promise((r) => setTimeout(r, 20));
    await writeTable("t-2", tbl(2, []), root);
    const issues = await collectSchemaIssues(root);
    expect(issues).toHaveLength(1);
    expect(calls).toHaveBeenCalledTimes(1); // 変わった 1 件だけ (他の 4 件は使い回し)

    calls.mockClear();
    expect(await collectSchemaIssues(root)).toHaveLength(1); // 何も変わらなければ、検査し直さない
    expect(calls).not.toHaveBeenCalled();
  });
});
