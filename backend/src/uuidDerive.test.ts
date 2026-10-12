/**
 * uuid の無い設計ファイル: 読んだだけではファイルを書き換えず、種類 + id (+ プロジェクト固有の値) から決めた uuid を返す。
 * 保存 (writeX) のとき、読んだ値と同じ uuid がファイルに残る (読んだ値を持つ下書きの保存が、immutability violation で失敗しない)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  deriveStableUuid, readTable, writeTable, listAllTables, readSequence, listAllSequences, readView, listAllViews,
  readViewDefinition, listAllViewDefinitions, readPageLayout, listAllPageLayouts, readProcessFlow, listProcessFlows, readScreenEntity,
} from "./projectStorage.js";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROOT = path.join(os.tmpdir(), `uuid-derive-${process.pid}-${Date.now()}`);
const ts = "2026-01-01T00:00:00.000Z";

async function manifest(root: string, metaUuid: string) {
  await fs.mkdir(path.join(root, "harmony"), { recursive: true });
  await fs.writeFile(path.join(root, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "p", uuid: metaUuid, name: "t", createdAt: ts, updatedAt: ts }, entities: {} }));
}
async function put(root: string, dir: string, id: string, body: object) {
  await fs.mkdir(path.join(root, "harmony", dir), { recursive: true });
  const f = path.join(root, "harmony", dir, `${id}.json`);
  await fs.writeFile(f, JSON.stringify({ id, name: id, ...body }));
  return f;
}

beforeAll(async () => { await manifest(ROOT, "11111111-1111-4111-8111-111111111111"); });
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("deriveStableUuid", () => {
  it("v4 の形で、同じ入力なら同じ値。種類・id・プロジェクト固有の値が違えば別の値", () => {
    const a = deriveStableUuid("table", "orders", "p1");
    expect(a).toMatch(V4);
    expect(deriveStableUuid("table", "orders", "p1")).toBe(a);
    expect(deriveStableUuid("view", "orders", "p1")).not.toBe(a);
    expect(deriveStableUuid("table", "orders2", "p1")).not.toBe(a);
    expect(deriveStableUuid("table", "orders", "p2")).not.toBe(a);
  });
});

describe("uuid の無いファイルは、読んでも書き換わらない (7 種類)", () => {
  it("read / list を通しても、ファイルの内容は変わらず、同じ uuid が返る", async () => {
    const files = [
      await put(ROOT, "tables", "t-a", { physicalName: "t_a", columns: [] }),
      await put(ROOT, "sequences", "s-a", { physicalName: "s_a" }),
      await put(ROOT, "views", "v-a", { physicalName: "v_a" }),
      await put(ROOT, "view-definitions", "vd-a", {}),
      await put(ROOT, "page-layouts", "pl-a", {}),
      await put(ROOT, "screens", "sc-a", { kind: "page", path: "/a", purpose: "page", items: [] }),
    ];
    const flowDir = path.join(ROOT, "harmony", "process-flows");
    await fs.mkdir(flowDir, { recursive: true });
    const flow = path.join(flowDir, "f-a.json");
    await fs.writeFile(flow, JSON.stringify({ meta: { id: "f-a", name: "f", flowType: "common", createdAt: ts, updatedAt: ts }, actions: [] }));
    files.push(flow);
    const before = await Promise.all(files.map((f) => fs.readFile(f, "utf-8")));

    const got = [
      await readTable("t-a", ROOT), await readSequence("s-a", ROOT), await readView("v-a", ROOT), await readViewDefinition("vd-a", ROOT),
      await readPageLayout("pl-a", ROOT), await readProcessFlow("f-a", ROOT), await readScreenEntity("sc-a", ROOT),
    ] as Array<Record<string, any>>;
    await Promise.all([listAllTables(ROOT), listAllSequences(ROOT), listAllViews(ROOT), listAllViewDefinitions(ROOT), listAllPageLayouts(ROOT), listProcessFlows(ROOT)]);
    const uuids = got.map((g) => g?.uuid ?? g?.meta?.uuid);
    expect(uuids.every((u) => typeof u === "string" && V4.test(u))).toBe(true);
    expect(await Promise.all(files.map((f) => fs.readFile(f, "utf-8")))).toEqual(before);
    // 読み直しても同じ値
    expect((await readTable("t-a", ROOT) as any).uuid).toBe(uuids[0]);
  });

  it("プロジェクトが違えば、同じ id でも uuid は別の値になる", async () => {
    const other = path.join(os.tmpdir(), `uuid-derive-other-${process.pid}-${Date.now()}`);
    try {
      await manifest(other, "22222222-2222-4222-8222-222222222222");
      await put(other, "tables", "t-a", { physicalName: "t_a", columns: [] });
      const a = (await readTable("t-a", ROOT) as any).uuid;
      const b = (await readTable("t-a", other) as any).uuid;
      expect(b).toMatch(V4);
      expect(b).not.toBe(a);
    } finally { await fs.rm(other, { recursive: true, force: true }); }
  });
});

describe("読んだ uuid と保存で付く uuid が食い違わない", () => {
  it("読む → uuid 無しの本文で保存 → 読んだ uuid を持つ下書きで再保存、が通る", async () => {
    await put(ROOT, "tables", "cust", { physicalName: "cust", columns: [] });
    const read = await readTable("cust", ROOT) as any;
    // AI などが uuid を含まない本文を保存する
    await writeTable("cust", { id: "cust", physicalName: "cust", name: "顧客", createdAt: ts, updatedAt: ts, columns: [] }, ROOT);
    const onDisk = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "tables", "cust.json"), "utf-8"));
    expect(onDisk.uuid).toBe(read.uuid);
    // 利用者の (読んだ uuid を持つ) 下書きの保存も、そのまま通る
    await expect(writeTable("cust", { ...read, name: "顧客 (編集)" }, ROOT)).resolves.toBeUndefined();
  });

  it("ファイルが無い新規作成は、従来どおり乱数 (v4)", async () => {
    await writeTable("brand-new", { id: "brand-new", physicalName: "brand_new", name: "新規", createdAt: ts, updatedAt: ts, columns: [] }, ROOT);
    const saved = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "tables", "brand-new.json"), "utf-8"));
    expect(saved.uuid).toMatch(V4);
    expect(saved.uuid).not.toBe(deriveStableUuid("table", "brand-new", "11111111-1111-4111-8111-111111111111"));
  });
});
