/**
 * 一覧 (harmony.json) に載っていないファイルは、設計書・検査・一覧画面から黙って落ちない。読み出すときに足すだけで、原本は書き換えない。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, writeProcessFlow, readProject } from "./projectStorage.js";
import { mergeUnregisteredEntities } from "./registryMerge.js";
import { loadDesignInputFromRoot } from "./designInput.js";

const ROOT = path.join(os.tmpdir(), `registry-merge-${process.pid}-${Date.now()}`);
const manifest = {
  schemaVersion: "v3", dataDir: "harmony",
  meta: { id: "00000000-0000-4000-8000-00000000000b", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  entities: { tables: [{ id: "registered", no: 1, name: "登録済み", physicalName: "registered", columnCount: 1 }] },
};
const table = (id: string, name: string) => ({
  id, uuid: `44444444-4444-4444-8444-4444444444${id.length}${id.length}`, physicalName: id, name,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true }],
});

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify(manifest, null, 2));
  await writeTable("registered", table("registered", "登録済み"), ROOT);
  await writeTable("loose", table("loose", "手で置いた表"), ROOT);
  await writeProcessFlow("loose-flow", {
    meta: { id: "loose-flow", name: "手で置いたフロー", flowType: "common", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    actions: [],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("一覧に載っていない設計", () => {
  it("読み出すと、一覧の後ろに足される (載っているものはそのまま)", async () => {
    const before = await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8");
    const { project, unregistered } = await mergeUnregisteredEntities(await readProject(ROOT), ROOT);
    const e = (project as { entities: { tables: Array<{ id: string; no: number; name: string; columnCount: number }>; processFlows: Array<{ id: string }> } }).entities;
    expect(e.tables.map((t) => t.id)).toEqual(["registered", "loose"]);
    expect(e.tables[1]).toMatchObject({ no: 2, name: "手で置いた表", columnCount: 1 });
    expect(e.processFlows.map((f) => f.id)).toContain("loose-flow");
    expect(unregistered).toEqual(expect.arrayContaining([{ kind: "table", id: "loose" }, { kind: "processFlow", id: "loose-flow" }]));
    // 書き込まない
    expect(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")).toBe(before);
  });

  it("設計書・検査の入力にも含まれる", async () => {
    const { input, skipped } = await loadDesignInputFromRoot(ROOT);
    const names = (input.tables as unknown as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["登録済み", "手で置いた表"]));
    expect((input.flows as unknown as Array<{ meta: { id: string } }>).map((f) => f.meta.id)).toContain("loose-flow");
    expect(skipped).toEqual([]);
  });
});
