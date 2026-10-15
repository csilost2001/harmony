/**
 * マーカーの MCP tool: 画面が書く場所 (authoring.markers) を読み書きする。どの設計にも付けられる (#1509)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isUuid } from "@harmony/shared";
import { handleMarkerTool } from "./marker.js";
import { writeTable, writeProcessFlow, writeScreenEntity, readTable, readProcessFlow } from "../projectStorage.js";

const ROOT = path.join(os.tmpdir(), `marker-tool-${process.pid}-${Date.now()}`);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleMarkerTool(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return res.content[0].text;
};
const callJson = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));

/** 画面 (MarkerPanel) が書く形のマーカー */
const uiMarker = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", kind: "todo", body: "画面で付けた指示", author: "human",
  createdAt: "2026-01-01T00:00:00.000Z", anchor: { stepId: "step-1" }, ...over,
});

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000009", name: "検査用", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: {},
  }));
  await writeProcessFlow("flow-a", { id: "flow-a", meta: { id: "flow-a", name: "注文確定" }, actions: [], authoring: { markers: [uiMarker()] } }, ROOT);
  await writeProcessFlow("flow-legacy", {
    id: "flow-legacy", meta: { id: "flow-legacy", name: "古い形" }, actions: [],
    markers: [{ id: "mk-1-abc", kind: "question", body: "古い形の質問", stepId: "s9", author: "human", createdAt: "2026-01-01T00:00:00.000Z" }],
  }, ROOT);
  await writeTable("orders", { id: "orders", name: "注文", physicalName: "orders", columns: [{ id: "col-01", physicalName: "id", name: "ID", dataType: "BIGINT" }] }, ROOT);
  await writeScreenEntity("cart", {
    id: "cart", uuid: "22222222-2222-4222-8222-222222222222", name: "カート", kind: "form", path: "/cart",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [], layout: { version: 1, nodes: [] },
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("マーカーの MCP tool", () => {
  it("画面が付けたマーカー (authoring.markers) を、AI が読める (以前は、別の場所を読んでいて、空だった)", async () => {
    const list = await callJson("designer__list_markers", { processFlowId: "flow-a" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ body: "画面で付けた指示", anchor: { stepId: "step-1" } });
    // entityType + entityId でも同じ
    expect(await callJson("designer__list_markers", { entityType: "processFlow", entityId: "flow-a" })).toHaveLength(1);
  });

  it("AI が付けたマーカーは、authoring.markers に、UUID の id と anchor で保存される (最上位の markers には書かない)", async () => {
    await call("designer__add_marker", { processFlowId: "flow-a", kind: "question", body: "SQL はこれでよいですか", stepId: "step-2", fieldPath: "$.sql" });
    const doc = await readProcessFlow("flow-a", ROOT) as Record<string, unknown> & { authoring?: { markers?: Array<Record<string, unknown>> } };
    expect((doc as { markers?: unknown }).markers).toBeUndefined();
    const added = doc.authoring!.markers!.find((m) => m.body === "SQL はこれでよいですか")!;
    expect(isUuid(added.id)).toBe(true);
    expect(added).toMatchObject({ kind: "question", author: "ai", anchor: { stepId: "step-2", fieldPath: "$.sql" } });
    // 画面が付けたものも残っている
    expect(doc.authoring!.markers!.some((m) => m.body === "画面で付けた指示")).toBe(true);
  });

  it("処理フロー以外 (テーブル) にも付けられる。位置は fieldPath。絞り込み・解決・削除ができる", async () => {
    await call("designer__add_marker", { entityType: "table", entityId: "orders", kind: "todo", body: "金額の列を足して", fieldPath: "$.columns[col-01]" });
    await call("designer__add_marker", { entityType: "table", entityId: "orders", kind: "chat", body: "全体へのメモ" });
    const table = await readTable("orders", ROOT) as { authoring?: { markers?: unknown[] } };
    expect(table.authoring?.markers).toHaveLength(2);
    const onColumn = await callJson("designer__list_markers", { entityType: "table", entityId: "orders", fieldPathPrefix: "$.columns[" });
    expect(onColumn).toHaveLength(1);
    const id = onColumn[0].id as string;
    await call("designer__resolve_marker", { entityType: "table", entityId: "orders", markerId: id, resolution: "金額の列を足した" });
    expect(await callJson("designer__list_markers", { entityType: "table", entityId: "orders" })).toHaveLength(1); // 未解決だけ
    const all = await callJson("designer__list_markers", { entityType: "table", entityId: "orders", unresolvedOnly: false });
    expect(all.find((m: { id: string }) => m.id === id)).toMatchObject({ resolution: "金額の列を足した" });
    await call("designer__remove_marker", { entityType: "table", entityId: "orders", markerId: id });
    expect(await callJson("designer__list_markers", { entityType: "table", entityId: "orders", unresolvedOnly: false })).toHaveLength(1);
  });

  it("画面 (Screen) にも付けられる", async () => {
    await call("designer__add_marker", { entityType: "screen", entityId: "cart", kind: "attention", body: "ボタンの位置", fieldPath: "$.layout.nodes[n1]" });
    const list = await callJson("designer__list_markers", { entityType: "screen", entityId: "cart" });
    expect(list).toHaveLength(1);
    expect(list[0].anchor).toEqual({ fieldPath: "$.layout.nodes[n1]" });
  });

  it("全設計を横断して、種類・id・名前つきで返す。古い形のマーカー (最上位の markers) も、新しい形で見える", async () => {
    const r = await callJson("designer__find_all_markers");
    const byEntity = (id: string) => r.markers.filter((m: { entityId: string }) => m.entityId === id);
    expect(byEntity("flow-a").length).toBeGreaterThanOrEqual(2);
    expect(byEntity("flow-a")[0]).toMatchObject({ entityType: "processFlow", entityName: "注文確定", processFlowId: "flow-a", processFlowName: "注文確定" });
    expect(byEntity("orders")[0]).toMatchObject({ entityType: "table", entityName: "注文" });
    expect(byEntity("orders")[0].processFlowId).toBeUndefined();
    const legacy = byEntity("flow-legacy");
    expect(legacy).toHaveLength(1);
    expect(isUuid(legacy[0].id)).toBe(true);
    expect(legacy[0]).toMatchObject({ body: "古い形の質問", anchor: { stepId: "s9" } });
    // 種類で絞る
    const onlyTables = await callJson("designer__find_all_markers", { entityType: "table" });
    expect(onlyTables.markers.every((m: { entityType: string }) => m.entityType === "table")).toBe(true);
    // kind で絞る
    const todos = await callJson("designer__find_all_markers", { kind: "todo" });
    expect(todos.markers.every((m: { kind: string }) => m.kind === "todo")).toBe(true);
  });

  it("古い形のマーカーを解決すると、新しい形で保存される (最上位の markers は消える)", async () => {
    const [m] = await callJson("designer__list_markers", { processFlowId: "flow-legacy" });
    await call("designer__resolve_marker", { processFlowId: "flow-legacy", markerId: m.id, resolution: "済" });
    const doc = await readProcessFlow("flow-legacy", ROOT) as { markers?: unknown; authoring?: { markers?: Array<{ resolution?: string }> } };
    expect(doc.markers).toBeUndefined();
    expect(doc.authoring?.markers?.[0]).toMatchObject({ resolution: "済" });
  });

  it("入力の誤りを、分かる言葉で返す", async () => {
    await expect(call("designer__list_markers", { entityType: "nope", entityId: "x" })).rejects.toThrow("entityType");
    await expect(call("designer__list_markers", { entityType: "table" })).rejects.toThrow("entityId");
    await expect(call("designer__list_markers", {})).rejects.toThrow("processFlowId");
    await expect(call("designer__list_markers", { entityType: "table", entityId: "ghost" })).rejects.toThrow("見つかりません");
    await expect(call("designer__list_markers", { entityType: "table", entityId: "../x" })).rejects.toThrow();
    await expect(call("designer__add_marker", { processFlowId: "flow-a", kind: "validator", body: "x" })).rejects.toThrow("kind");
    await expect(call("designer__add_marker", { processFlowId: "flow-a", body: "x" })).rejects.toThrow("kind, body");
    await expect(call("designer__resolve_marker", { processFlowId: "flow-a", markerId: "nope" })).rejects.toThrow("見つかりません");
    await expect(call("designer__remove_marker", { processFlowId: "flow-a" })).rejects.toThrow("markerId");
  });

  it("対象外のツール名は null", async () => {
    expect(await handleMarkerTool("designer__other", {}, ROOT, "s")).toBeNull();
  });
});
