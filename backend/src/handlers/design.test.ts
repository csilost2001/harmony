/**
 * 設計全体の MCP tool: 要確認事項の検査 (designer__check_design) とテスト観点表 (designer__get_test_viewpoints)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { handleDesignTool } from "./design.js";
import { writeScreenEntity, writeBusinessFlow } from "../projectStorage.js";

const ROOT = path.join(os.tmpdir(), `design-tool-${process.pid}-${Date.now()}`);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleDesignTool(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return res.content[0].text;
};

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000009", name: "検査用", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }, { id: "ghost", name: "幽霊", kind: "form", path: "/ghost" }] },
  }));
  await writeScreenEntity("cart", {
    id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ id: "qty", label: "数量", type: "integer", direction: "in", required: true, min: 1, max: 50 }],
    layout: { version: 1, nodes: [{ id: "qty", type: "field", itemRef: "qty" }] },
  }, ROOT);
  // 参照先 (画面) が無い業務フロー → 要確認に出る
  await writeBusinessFlow("order", {
    name: "注文", lanes: [{ id: "a", name: "顧客" }],
    steps: [{ id: "s1", lane: "a", kind: "start", name: "開始", screenRef: "nowhere" }],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("designer__check_design", () => {
  it("要確認事項と件数を返す。読めない画面と参照先のない業務フローが出る", async () => {
    const r = JSON.parse(await call("designer__check_design"));
    expect(r.project).toBe("検査用");
    expect(r.counts.screens).toBe(1);
    expect(r.ok).toBe(false);
    const messages = (r.issues as Array<{ message: string }>).map((i) => i.message).join("\n");
    expect(messages).toContain("画面「ghost」");
    expect(messages).toContain("nowhere");
    expect(r.issues.every((i: { severity: string }) => i.severity !== "info")).toBe(true);
  });

  it("includeInfo で情報も含める", async () => {
    const without = JSON.parse(await call("designer__check_design"));
    const withInfo = JSON.parse(await call("designer__check_design", { includeInfo: true }));
    expect(withInfo.issues.length).toBeGreaterThanOrEqual(without.issues.length);
    expect(withInfo.summary).toEqual(without.summary);
  });
});

describe("designer__get_test_viewpoints", () => {
  it("画面入力の観点を ID つきで返す (範囲の境界値を含む)", async () => {
    const sheet = JSON.parse(await call("designer__get_test_viewpoints"));
    const ids = (sheet.screens[0].cases as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("cart.qty.valid");
    expect(ids).toContain("cart.qty.min-under");
    expect(ids).toContain("cart.qty.max-over");
  });

  it("画面を絞る・存在しない画面なら空・CSV でも返せる", async () => {
    expect(JSON.parse(await call("designer__get_test_viewpoints", { screenIds: ["none"] })).screens).toEqual([]);
    const csv = await call("designer__get_test_viewpoints", { format: "csv" });
    expect(csv).toContain("cart.qty.valid");
  });

  it("関係のないツール名は処理しない", async () => {
    expect(await handleDesignTool("designer__other", {}, ROOT, "s")).toBeNull();
  });
});

describe("designer__find_references", () => {
  it("参照元を返す (業務フローの工程が画面を参照)", async () => {
    const r = JSON.parse(await call("designer__find_references", { entityType: "screen", id: "nowhere" }));
    expect(r.exists).toBe(false);
    expect(r.referrers.map((x: { id: string }) => x.id)).toContain("order");
  });

  it("種類が不正なら InvalidParams", async () => {
    await expect(call("designer__find_references", { entityType: "bogus", id: "x" })).rejects.toThrow();
  });
});
