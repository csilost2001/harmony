/**
 * 保存時のスキーマ検査で付く警告のマーカー: 違反があれば付き、解消したら解決済みになる (残り続けない)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, readTable } from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `validator-markers-${process.pid}-${Date.now()}`);
type Marker = { kind: string; body: string; resolvedAt?: string; resolution?: string; validatorPath?: string };
const markersOf = (t: unknown) => (((t as { authoring?: { markers?: Marker[] } }).authoring?.markers) ?? []);

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

describe("検査の警告マーカー", () => {
  it("違反 (カラムが 0 件) で、日本語の警告が付き、保存は妨げない", async () => {
    await writeTable("customers", table([]), ROOT);
    const m = markersOf(await readTable("customers", ROOT)).filter((x) => x.kind === "validator");
    expect(m).toHaveLength(1);
    expect(m[0].body).toContain("件数が少なすぎます");
    expect(m[0].resolvedAt).toBeUndefined();
  });

  it("同じ違反のまま保存し直しても、重複して増えない", async () => {
    await writeTable("customers", table([]), ROOT);
    expect(markersOf(await readTable("customers", ROOT)).filter((x) => x.kind === "validator")).toHaveLength(1);
  });

  it("違反を直して保存すると、警告は解決済みになる (未解決のまま残らない)", async () => {
    const before = (await readTable("customers", ROOT)) as { authoring?: unknown };
    await writeTable("customers", { ...table([column]), authoring: before.authoring }, ROOT);
    const m = markersOf(await readTable("customers", ROOT)).filter((x) => x.kind === "validator");
    expect(m).toHaveLength(1);
    expect(m[0].resolvedAt).toBeTruthy();
    expect(m[0].resolution).toContain("解消");
  });
});
