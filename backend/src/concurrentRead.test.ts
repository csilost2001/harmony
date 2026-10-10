/**
 * uuid を持たない entity を同時に読んだ時の整合性。
 * 読込時の uuid 補完 (ファイル書き戻し) が並行すると、片方が書き込み途中の空ファイルを読んで
 * null (= 存在しない) を返したり、呼び出しごとに別の uuid を返したりしていた。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readTable } from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `concurrent-read-${process.pid}-${Date.now()}`);
const TABLE_FILE = path.join(ROOT, "harmony", "tables", "orders.json");

beforeAll(async () => {
  await fs.mkdir(path.dirname(TABLE_FILE), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000002", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { tables: [{ id: "orders", physicalName: "orders", name: "注文" }] },
  }));
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("readTable の同時読込", () => {
  it("uuid 補完が並行しても全員が同じ内容を受け取り、ファイルの uuid と一致する", async () => {
    const columns = Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, physicalName: `col_${i}`, name: `列${i}`, dataType: "VARCHAR", length: 100 }));
    await fs.writeFile(TABLE_FILE, JSON.stringify({ id: "orders", physicalName: "orders", name: "注文", columns }, null, 2));

    const results = (await Promise.all(Array.from({ length: 8 }, () => readTable("orders", ROOT)))) as Array<{ uuid?: string } | null>;
    expect(results.every((r) => r !== null)).toBe(true);
    const uuids = new Set(results.map((r) => r?.uuid));
    expect(uuids.size).toBe(1);
    const onDisk = JSON.parse(await fs.readFile(TABLE_FILE, "utf-8")) as { uuid: string };
    expect(onDisk.uuid).toBe(results[0]?.uuid);
    // 呼び出し側が結果を書き換えても他の呼び出しの結果に波及しない
    expect(results[0]).not.toBe(results[1]);
  });

  it("書き込み中に読んでも途中の内容を読まない (一時ファイルを残さない)", async () => {
    const entries = await fs.readdir(path.dirname(TABLE_FILE));
    expect(entries.filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
