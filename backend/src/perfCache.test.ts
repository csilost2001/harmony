/**
 * 検査の増分化 (fileMemo) と先読み (prewarm) のテスト。
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFileMemo } from "./fileMemo.js";
import { ensureDataDir, harmonyFile, resolveDataRoot, writeTable } from "./projectStorage.js";
import { collectSchemaIssues } from "./schemaIssues.js";
import { scanWorkspaceHealth } from "./workspaceHealth.js";

const TMP = path.join(os.tmpdir(), `perf-cache-${process.pid}-${Date.now()}`);
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("fileMemo", () => {
  it("ファイルの状態が変わらないあいだは使い回し、変わったら計算し直す。ファイルが無ければ覚えない", async () => {
    await fs.mkdir(TMP, { recursive: true });
    const f = path.join(TMP, "a.json");
    await fs.writeFile(f, "1");
    const memo = createFileMemo<number>();
    const compute = vi.fn(async () => Number(await fs.readFile(f, "utf-8")));
    expect(await memo.get(f, compute)).toBe(1);
    expect(await memo.get(f, compute)).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
    await fs.writeFile(f, "22"); // 大きさが変わる
    expect(await memo.get(f, compute)).toBe(22);
    expect(compute).toHaveBeenCalledTimes(2);
    await fs.rm(f);
    await expect(memo.get(f, async () => { throw new Error("no file"); })).rejects.toThrow("no file");
    expect(memo.size).toBe(0);
  });

  it("依存先のファイルの状態が変わっても、計算し直す", async () => {
    const f = path.join(TMP, "main.json"), dep = path.join(TMP, "dep.json");
    await fs.writeFile(f, "m"); await fs.writeFile(dep, "d1");
    const memo = createFileMemo<string>();
    const compute = vi.fn(async () => `v:${await fs.readFile(dep, "utf-8")}`);
    expect(await memo.get(f, compute, [dep])).toBe("v:d1");
    await memo.get(f, compute, [dep]);
    expect(compute).toHaveBeenCalledTimes(1);
    await fs.writeFile(dep, "d22");
    expect(await memo.get(f, compute, [dep])).toBe("v:d22");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("計算のあいだに書き換えられたら、覚えない (古い内容の結果を、新しい状態の印で覚えない)", async () => {
    const f = path.join(TMP, "race.json");
    await fs.writeFile(f, "x");
    const memo = createFileMemo<string>();
    const first = await memo.get(f, async () => { const v = await fs.readFile(f, "utf-8"); await fs.writeFile(f, "xyz"); return v; });
    expect(first).toBe("x");
    expect(memo.size).toBe(0);
    expect(await memo.get(f, async () => fs.readFile(f, "utf-8"))).toBe("xyz");
  });
});

describe("検査は、変わったファイルの分だけ計算し直す (結果は全件を計算したときと同じ)", () => {
  it("スキーマ違反・健全性: 1 件を直す・壊すと、その分だけ結果が変わる", async () => {
    const root = path.join(TMP, "ws");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(harmonyFile(root), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "pc", name: "pc", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, extensionsApplied: [], entities: {} }));
    await ensureDataDir(root, "harmony");
    const col = { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true };
    const tbl = (i: number, columns: unknown[]) => ({
      id: `t-${i}`, uuid: `44444444-4444-4444-8444-44444444444${i}`, physicalName: `t_${i}`, name: `表${i}`,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", columns,
    });
    for (let i = 0; i < 5; i++) await writeTable(`t-${i}`, tbl(i, [col]), root);
    expect(await collectSchemaIssues(root)).toEqual([]);
    expect(await scanWorkspaceHealth(root)).toEqual(expect.not.arrayContaining([expect.objectContaining({ severity: "error" })]));

    // 1 件だけ、スキーマ違反 (カラム 0 件) にする
    await writeTable("t-2", tbl(2, []), root);
    const issues = await collectSchemaIssues(root);
    expect(issues).toHaveLength(1);
    expect(issues[0].section).toBe("テーブル 表2");
    // 直すと、消える
    await writeTable("t-2", tbl(2, [col]), root);
    expect(await collectSchemaIssues(root)).toEqual([]);

    // 1 件だけ壊す (JSON として読めない) → error。直すと消える
    const broken = path.join(root, "harmony", "tables", "t-3.json");
    const good = await fs.readFile(broken, "utf-8");
    await fs.writeFile(broken, "{ not json");
    expect((await scanWorkspaceHealth(root)).filter((i) => i.severity === "error").map((i) => i.section)).toEqual(["テーブル tables/t-3.json"]);
    await fs.writeFile(broken, good + "\n");
    expect((await scanWorkspaceHealth(root)).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("resolveDataRoot: harmony.json の状態が変わらないあいだは読み直さず、変わったら読み直す", () => {
  it("dataDir を書き換えると、次の呼び出しで新しい値になる / 読めなくなったらエラー", async () => {
    const root = path.join(TMP, "ws-datadir");
    await fs.mkdir(root, { recursive: true });
    const manifest = (dataDir: string) => JSON.stringify({ schemaVersion: "v3", dataDir, meta: { id: "dd", name: "dd", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, entities: {} });
    await fs.writeFile(harmonyFile(root), manifest("a"));
    expect(await resolveDataRoot(root)).toBe(path.join(root, "a"));
    expect(await resolveDataRoot(root)).toBe(path.join(root, "a"));
    await fs.writeFile(harmonyFile(root), manifest("b")); // 同じ大きさ。更新時刻だけが違う
    expect(await resolveDataRoot(root)).toBe(path.join(root, "b"));
    await fs.writeFile(harmonyFile(root), "{ broken");
    await expect(resolveDataRoot(root)).rejects.toThrow(/パースに失敗/);
    await fs.rm(harmonyFile(root));
    await expect(resolveDataRoot(root)).rejects.toThrow(/見つかりません/);
  });
});
