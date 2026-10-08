/**
 * プロジェクト独自部品 (layout-components.json) の保存: 1 件ずつの追加・置換・削除、
 * 同時更新で別の部品を失わないこと、使用中の部品は削除できないこと。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readLayoutComponents, upsertLayoutComponent, deleteLayoutComponent, findLayoutComponentUsages, writeScreenEntity,
} from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `layout-components-${process.pid}-${Date.now()}`);
const part = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, params: [], nodes: [{ id: "t", type: "text", props: { text: id } }], ...extra });

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000003", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }] },
  }));
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("layout-components.json", () => {
  it("無ければ空の定義集合を返す", async () => {
    expect(await readLayoutComponents(ROOT)).toEqual({ version: 1, components: [] });
  });

  it("追加と置換は id で照合し、$schema 付きで保存する", async () => {
    await upsertLayoutComponent(part("box-a"), ROOT);
    await upsertLayoutComponent(part("box-a", { label: "改名" }), ROOT);
    const doc = await readLayoutComponents(ROOT);
    expect(doc.components).toHaveLength(1);
    expect(doc.components[0].label).toBe("改名");
    const raw = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "layout-components.json"), "utf-8"));
    expect(raw.$schema).toContain("layout-components.v3.schema.json");
  });

  it("同時に別の部品を保存しても、どちらも残る", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => upsertLayoutComponent(part(`par-${i}`), ROOT)));
    const ids = (await readLayoutComponents(ROOT)).components.map((c) => c.id);
    for (let i = 0; i < 8; i++) expect(ids).toContain(`par-${i}`);
    expect(ids).toContain("box-a");
  });

  it("使われている部品は削除せず使用箇所を返す。force で削除できる", async () => {
    await writeScreenEntity("cart", {
      id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [],
      layout: { version: 1, nodes: [{ id: "sec", type: "section", children: [{ id: "u", type: "component", componentRef: "box-a" }] }] },
    }, ROOT);
    await upsertLayoutComponent(part("outer", { nodes: [{ id: "i", type: "component", componentRef: "par-0" }] }), ROOT);

    expect(await findLayoutComponentUsages("box-a", ROOT)).toEqual({ screens: ["cart"], components: [] });
    const refused = await deleteLayoutComponent("box-a", ROOT);
    expect(refused.deleted).toBe(false);
    expect(refused.usages.screens).toEqual(["cart"]);
    expect((await readLayoutComponents(ROOT)).components.some((c) => c.id === "box-a")).toBe(true);

    expect((await deleteLayoutComponent("par-0", ROOT)).usages.components).toEqual(["outer"]);
    expect((await deleteLayoutComponent("box-a", ROOT, true)).deleted).toBe(true);
    expect((await readLayoutComponents(ROOT)).components.some((c) => c.id === "box-a")).toBe(false);
    expect((await deleteLayoutComponent("par-1", ROOT)).deleted).toBe(true);
  });
});
