/**
 * 業務部品デザイナ (screen layout) の保存: writeScreenItems が items と layout を
 * 画面 entity に書き込み、layout を持たない payload では既存 layout を保持することの検証。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeScreenEntity, readScreenEntity, writeScreenItems } from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `screen-layout-storage-${process.pid}-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000001", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }] },
  }));
  await writeScreenEntity("cart", {
    id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ id: "qty", label: "数量", type: "integer" }],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("writeScreenItems + layout", () => {
  it("payload の layout を画面 entity に保存する", async () => {
    const layout = { version: 1, nodes: [{ id: "form", type: "form", children: [{ id: "qtyField", type: "field", itemRef: "qty" }] }] };
    await writeScreenItems("cart", { screenId: "cart", items: [{ id: "qty", label: "数量", type: "integer" }], layout }, ROOT);
    const s = (await readScreenEntity("cart", ROOT)) as { layout?: unknown; items: unknown[] };
    expect(s.layout).toEqual(layout);
    expect(s.items).toHaveLength(1);
  });

  it("layout を含まない payload (画面項目画面からの保存) では既存 layout を残す", async () => {
    await writeScreenItems("cart", { screenId: "cart", items: [{ id: "qty", label: "数量 (個)", type: "integer" }] }, ROOT);
    const s = (await readScreenEntity("cart", ROOT)) as { layout?: { nodes: unknown[] }; items: Array<{ label: string }> };
    expect(s.layout?.nodes).toHaveLength(1);
    expect(s.items[0].label).toBe("数量 (個)");
  });
});
