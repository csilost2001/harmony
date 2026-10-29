/**
 * 参照の付け替え (#60): 選んだ参照元だけ A → B へ。A は残る。予行・実行・取り消し。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { previewReplaceReferences, replaceReferences, undoReplaceReferences, _clearReplaceUndoForTest } from "./replaceReferences.js";
import { harmonyFile, ensureDataDir, writeTable, writeProcessFlow } from "./projectStorage.js";

const TMP = path.join(os.tmpdir(), `replace-refs-${process.pid}-${Date.now()}`);
let n = 0;
async function makeWorkspace(): Promise<string> {
  const root = path.join(TMP, `ws-${++n}`);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(harmonyFile(root), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "t", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, extensionsApplied: [], entities: {} }, null, 2));
  await ensureDataDir(root, "harmony");
  return root;
}
const flowPath = (root: string, id: string) => path.join(root, "harmony", "process-flows", `${id}.json`);
const readJson = async <T,>(p: string) => JSON.parse(await fs.readFile(p, "utf-8")) as T;
const seedFlow = (root: string, id: string, tableIds: string[]) =>
  writeProcessFlow(id, { id, name: id, steps: tableIds.map((t, i) => ({ id: `s${i}`, kind: "db", tableId: t })) }, root);

beforeEach(() => _clearReplaceUndoForTest());
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {}); });

async function seed() {
  const root = await makeWorkspace();
  await writeTable("old-orders", { id: "old-orders", name: "旧", columns: [] }, root);
  await writeTable("new-orders", { id: "new-orders", name: "新", columns: [] }, root);
  await seedFlow(root, "flow-a", ["old-orders", "old-orders", "other"]);
  await seedFlow(root, "flow-b", ["old-orders"]);
  await seedFlow(root, "flow-c", ["unrelated"]);
  return root;
}

describe("previewReplaceReferences", () => {
  it("参照元ごとの数が分かり、何も書き換えない", async () => {
    const root = await seed();
    const before = await fs.readFile(flowPath(root, "flow-a"), "utf-8");
    const p = await previewReplaceReferences("table", "old-orders", "new-orders", root);
    expect(p.fromExists && p.toExists).toBe(true);
    expect(p.files.map((f) => [f.entityId, f.count])).toEqual([["flow-a", 2], ["flow-b", 1]]);
    expect(p.totalRefs).toBe(3);
    expect(await fs.readFile(flowPath(root, "flow-a"), "utf-8")).toBe(before);
  });
  it("付け替え先の候補 (同じ種類。付け替え元は除く) が出る。付け替え元と同じ ID で呼んでも、参照元と候補が分かる", async () => {
    const root = await seed();
    const p = await previewReplaceReferences("table", "old-orders", "old-orders", root);
    expect(p.candidates).toEqual(["new-orders"]);
    expect(p.files.map((f) => f.entityId)).toEqual(["flow-a", "flow-b"]);
  });
  it("参照元を選ぶと、その分だけ数える", async () => {
    const root = await seed();
    const p = await previewReplaceReferences("table", "old-orders", "new-orders", root, ["process-flows/flow-b.json"]);
    expect(p.files.map((f) => f.entityId)).toEqual(["flow-b"]);
  });
});

describe("replaceReferences", () => {
  it("選んだ参照元だけ付け替え、選ばなかった参照元と、元の設計 (A) は、そのまま残る", async () => {
    const root = await seed();
    const r = await replaceReferences("table", "old-orders", "new-orders", root, ["process-flows/flow-a.json"]);
    expect(r.replaced.map((f) => f.entityId)).toEqual(["flow-a"]);
    const a = await readJson<{ steps: Array<{ tableId: string }> }>(flowPath(root, "flow-a"));
    expect(a.steps.map((s) => s.tableId)).toEqual(["new-orders", "new-orders", "other"]);
    const b = await readJson<{ steps: Array<{ tableId: string }> }>(flowPath(root, "flow-b"));
    expect(b.steps[0].tableId).toBe("old-orders"); // 選ばなかった
    await expect(fs.stat(path.join(root, "harmony", "tables", "old-orders.json"))).resolves.toBeTruthy(); // A は残る
  });
  it("付け替え先が無い・同じ・参照元が空のときは、書き換えずに断る", async () => {
    const root = await seed();
    await expect(replaceReferences("table", "old-orders", "ghost", root, ["process-flows/flow-a.json"])).rejects.toThrow(/見つかりません/);
    await expect(replaceReferences("table", "old-orders", "old-orders", root, ["process-flows/flow-a.json"])).rejects.toThrow(/同じ/);
    await expect(replaceReferences("table", "old-orders", "new-orders", root, [])).rejects.toThrow(/選んでください/);
    const a = await readJson<{ steps: Array<{ tableId: string }> }>(flowPath(root, "flow-a"));
    expect(a.steps[0].tableId).toBe("old-orders");
  });
  it("参照元を、ほかの人が編集中なら、付け替えない", async () => {
    const root = await seed();
    const busy = { state: "Active", participants: new Map([["x", { sessionId: "other", role: "Edit" }]]) };
    await expect(replaceReferences("table", "old-orders", "new-orders", root, ["process-flows/flow-a.json"], {
      sessionId: "me", fetchEditSessionsForRef: (kind) => (kind === "processFlow" ? [busy as never] : []),
    })).rejects.toThrow(/編集中/);
  });
});

describe("undoReplaceReferences", () => {
  it("取り消すと、付け替えの前の内容に戻る。2 回目は取り消せない", async () => {
    const root = await seed();
    const before = await fs.readFile(flowPath(root, "flow-a"), "utf-8");
    const { operationId } = await replaceReferences("table", "old-orders", "new-orders", root, ["process-flows/flow-a.json", "process-flows/flow-b.json"]);
    const r = await undoReplaceReferences(operationId, root);
    expect(r.restored.sort()).toEqual(["process-flows/flow-a.json", "process-flows/flow-b.json"]);
    expect(await fs.readFile(flowPath(root, "flow-a"), "utf-8")).toBe(before);
    await expect(undoReplaceReferences(operationId, root)).rejects.toThrow(/取り消せる付け替え/);
  });
  it("付け替えのあとに、その設計が編集されていたら、取り消さない (編集を消さない)", async () => {
    const root = await seed();
    const { operationId } = await replaceReferences("table", "old-orders", "new-orders", root, ["process-flows/flow-a.json"]);
    const a = await readJson<{ name: string }>(flowPath(root, "flow-a"));
    await fs.writeFile(flowPath(root, "flow-a"), JSON.stringify({ ...a, name: "編集した" }, null, 2));
    await expect(undoReplaceReferences(operationId, root)).rejects.toThrow(/変更されている/);
    expect((await readJson<{ name: string }>(flowPath(root, "flow-a"))).name).toBe("編集した");
  });
});
