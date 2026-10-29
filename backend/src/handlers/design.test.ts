/**
 * 設計全体の MCP tool: 要確認事項の検査 (designer__check_design) とテスト観点表 (designer__get_test_viewpoints)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { handleDesignTool } from "./design.js";
import { writeScreenEntity, writeBusinessFlow, writeTable, writeProcessFlow } from "../projectStorage.js";

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
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

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

describe("designer__rename_entity / designer__undo_rename", () => {
  beforeAll(async () => {
    await writeBusinessFlow("ship", { name: "出荷", lanes: [{ id: "a", name: "店員" }], steps: [{ id: "s1", lane: "a", kind: "task", name: "カートを見る", screenRef: "cart" }] }, ROOT);
  });
  const rename = async (args: Record<string, unknown>) => JSON.parse(await call("designer__rename_entity", args));

  it("既定は予行: 影響を返すだけで、何も書き換えない", async () => {
    const r = await rename({ entityType: "screen", oldId: "cart", newId: "cart-view" });
    expect(r.applied).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(r.references).toEqual(expect.arrayContaining(["businessFlow:ship"]));
    expect(await fs.stat(path.join(ROOT, "harmony", "screens", "cart.json"))).toBeTruthy();
    await expect(fs.stat(path.join(ROOT, "harmony", "screens", "cart-view.json"))).rejects.toThrow();
  });

  it("止める理由 (存在しない・ID の重複) があれば、apply でも実行しない", async () => {
    const missing = await rename({ entityType: "screen", oldId: "nowhere", newId: "x-y", apply: true });
    expect(missing.applied).toBe(false);
    expect(missing.blockers.join("")).toContain("見つかりません");
  });

  it("apply: true で改名し (参照も追従)、undo で戻せる", async () => {
    const done = await rename({ entityType: "screen", oldId: "cart", newId: "cart-view", apply: true });
    expect(done.applied).toBe(true);
    expect(done.operation.operationId).toBeTruthy();
    await fs.stat(path.join(ROOT, "harmony", "screens", "cart-view.json"));
    const flow = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "business-flows", "ship.json"), "utf-8"));
    expect(flow.steps[0].screenRef).toBe("cart-view");

    const undone = JSON.parse(await call("designer__undo_rename", { operationId: done.operation.operationId }));
    expect(undone.undone).toBe(true);
    await fs.stat(path.join(ROOT, "harmony", "screens", "cart.json"));
    const flow2 = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "business-flows", "ship.json"), "utf-8"));
    expect(flow2.steps[0].screenRef).toBe("cart");
  });
});

describe("designer__replace_references / designer__undo_replace_references", () => {
  const replace = async (args: Record<string, unknown>) => JSON.parse(await call("designer__replace_references", args));
  const flowFile = path.join(ROOT, "harmony", "process-flows", "flow-x.json");
  beforeAll(async () => {
    await writeTable("t-old", { id: "t-old", name: "旧", columns: [] }, ROOT);
    await writeTable("t-new", { id: "t-new", name: "新", columns: [] }, ROOT);
    await writeProcessFlow("flow-x", { id: "flow-x", name: "x", steps: [{ id: "s1", kind: "db", tableId: "t-old" }] }, ROOT);
  });

  it("既定は予行: 付け替わる参照元を返すだけで、何も書き換えない", async () => {
    const r = await replace({ entityType: "table", fromId: "t-old", toId: "t-new" });
    expect(r.applied).toBe(false);
    expect(r.blockers).toEqual([]);
    expect(r.files.map((f: { entityId: string }) => f.entityId)).toEqual(["flow-x"]);
    expect(JSON.parse(await fs.readFile(flowFile, "utf-8")).steps[0].tableId).toBe("t-old");
  });

  it("apply でも、参照元 (referrers) を選ばなければ実行しない。付け替え先が無ければ止める", async () => {
    expect((await replace({ entityType: "table", fromId: "t-old", toId: "t-new", apply: true })).applied).toBe(false);
    const missing = await replace({ entityType: "table", fromId: "t-old", toId: "nowhere", referrers: ["process-flows/flow-x.json"], apply: true });
    expect(missing.applied).toBe(false);
    expect(missing.blockers.join("")).toContain("見つかりません");
  });

  it("選んだ参照元だけ付け替え、undo で戻せる", async () => {
    const done = await replace({ entityType: "table", fromId: "t-old", toId: "t-new", referrers: ["process-flows/flow-x.json"], apply: true });
    expect(done.applied).toBe(true);
    expect(JSON.parse(await fs.readFile(flowFile, "utf-8")).steps[0].tableId).toBe("t-new");
    const undone = JSON.parse(await call("designer__undo_replace_references", { operationId: done.operationId }));
    expect(undone.undone).toBe(true);
    expect(JSON.parse(await fs.readFile(flowFile, "utf-8")).steps[0].tableId).toBe("t-old");
  });
});
