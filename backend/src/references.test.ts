import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { findReferences } from "./references.js";
import { writeScreenEntity, writeBusinessFlow, writeReport } from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `references-${process.pid}-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000009", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: {
      screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }, { id: "list", name: "一覧", kind: "list", path: "/list" }],
      screenTransitions: [{ id: "t1", sourceScreenId: "list", targetScreenId: "cart", trigger: "click", kind: "navigation" }],
    },
  }));
  const mk = (id: string, name: string) => writeScreenEntity(id, {
    id, uuid: `11111111-1111-4111-8111-11111111111${id === "cart" ? 1 : 2}`, name, kind: "form", path: `/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [],
  }, ROOT);
  await mk("cart", "カート"); await mk("list", "一覧");
  await writeBusinessFlow("order", { name: "注文", lanes: [{ id: "a", name: "顧客" }], steps: [{ id: "s1", lane: "a", kind: "task", name: "カートを見る", screenRef: "cart" }] }, ROOT);
  await writeReport("slip", { name: "伝票", output: { format: "pdf" }, trigger: { kind: "screen", screenRef: "cart" }, sections: [] }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("参照元の検索", () => {
  it("画面を参照している業務フロー・帳票・画面の遷移を、設計ごとにまとめて返す", async () => {
    const r = await findReferences("screen", "cart", ROOT);
    expect(r.exists).toBe(true);
    const keys = r.referrers.map((x) => `${x.kind}:${x.id}`);
    expect(keys).toContain("businessFlow:order");
    expect(keys).toContain("report:slip");
    expect(keys).toContain("screenFlow:screen-flow");
    expect(r.referrers.find((x) => x.id === "order")?.name).toBe("注文");
    // 設計の一覧表そのもの (harmony.json の画面の並び) と自分自身は参照元にしない
    expect(keys.some((k) => k.startsWith("screen:cart"))).toBe(false);
    expect(r.total).toBeGreaterThanOrEqual(3);
  });

  it("誰からも参照されていなければ空", async () => {
    const r = await findReferences("screen", "list", ROOT);
    expect(r.referrers.filter((x) => x.kind !== "screenFlow")).toEqual([]);
  });

  it("存在しない ID は exists=false", async () => {
    expect((await findReferences("screen", "nothing", ROOT)).exists).toBe(false);
  });
});
