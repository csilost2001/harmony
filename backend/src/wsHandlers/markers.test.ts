/**
 * マーカーの RPC: 画面での変更を、いまの内容へ重ねて保存する (AI が並行して足したマーカーを消さない)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { markerHandlers } from "./markers.js";
import { writeTable, readTable } from "../projectStorage.js";
import type { RpcContext } from "./types.js";

const ROOT = path.join(os.tmpdir(), `marker-rpc-${process.pid}-${Date.now()}`);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const mk = (id: string, body: string, over: Record<string, unknown> = {}) => ({ id, kind: "todo", body, author: "human", createdAt: "2026-01-01T00:00:00.000Z", ...over });

async function call(method: keyof typeof markerHandlers, params: unknown) {
  let result: unknown; let error: string | undefined;
  const ctx = { params, clientId: "c", root: () => ROOT, wsId: () => ROOT, respond: (r: unknown) => { result = r; }, respondError: (e: string) => { error = e; }, bridge: { broadcast: () => undefined } } as unknown as RpcContext;
  await markerHandlers[method](ctx);
  return { result: result as Record<string, unknown> | undefined, error };
}

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000009", name: "検査用", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: {},
  }));
  await writeTable("orders", { id: "orders", name: "注文", physicalName: "orders", columns: [], authoring: { markers: [mk(U1, "既存 (AI が付けた)", { author: "ai" })] } }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("マーカーの RPC", () => {
  it("listMarkers: 設計のマーカー。無い設計は空", async () => {
    expect((await call("listMarkers", { entityType: "table", entityId: "orders" })).result?.markers).toHaveLength(1);
    expect((await call("listMarkers", { entityType: "table", entityId: "ghost" })).result?.markers).toEqual([]);
  });

  it("applyMarkerChanges: 追加・更新・削除を、いまの内容へ重ねる。画面が知らない (AI が足した) マーカーは残る", async () => {
    // 画面が読んだあとに、AI が U2 を足したとする
    await call("applyMarkerChanges", { entityType: "table", entityId: "orders", changes: { added: [mk(U2, "AI が後から足した", { author: "ai" })] } });
    // 画面は、自分が足した U3 だけを送る (U2 を知らない)
    const r = await call("applyMarkerChanges", { entityType: "table", entityId: "orders", changes: { added: [mk(U3, "画面で足した", { anchor: { fieldPath: "$.columns[c1]" } })] } });
    expect((r.result?.markers as Array<{ id: string }>).map((m) => m.id)).toEqual([U1, U2, U3]);
    // 更新 (解決) と削除
    const r2 = await call("applyMarkerChanges", { entityType: "table", entityId: "orders", changes: { updated: [mk(U3, "画面で足した", { resolvedAt: "2026-01-03T00:00:00.000Z", resolution: "済" })], removedIds: [U1] } });
    const list = r2.result?.markers as Array<{ id: string; resolution?: string }>;
    expect(list.map((m) => m.id)).toEqual([U2, U3]);
    expect(list[1].resolution).toBe("済");
    // ファイルにも、authoring.markers で入っている
    const t = await readTable("orders", ROOT) as { authoring?: { markers?: unknown[] } };
    expect(t.authoring?.markers).toHaveLength(2);
  });

  it("形の違うマーカー (UUID でない id・空の本文・知らない種類・長すぎる本文) は、保存しない", async () => {
    const before = ((await call("listMarkers", { entityType: "table", entityId: "orders" })).result?.markers as unknown[]).length;
    await call("applyMarkerChanges", { entityType: "table", entityId: "orders", changes: { added: [
      mk("mk-123", "UUID でない"), mk(U1, ""), mk(U1, "x", { kind: "weird" }), mk(U1, "x".repeat(20001)), mk(U1, "x", { author: "robot" }), null, "str",
    ] } });
    const after = ((await call("listMarkers", { entityType: "table", entityId: "orders" })).result?.markers as unknown[]).length;
    expect(after).toBe(before);
    // 使えない欄は捨てる
    await call("applyMarkerChanges", { entityType: "table", entityId: "orders", changes: { added: [mk(U1, "余計な欄つき", { evil: "x", anchor: { fieldPath: "$.a", extra: 1 } })] } });
    const m = ((await call("listMarkers", { entityType: "table", entityId: "orders" })).result?.markers as Array<Record<string, unknown>>).find((x) => x.id === U1)!;
    expect(m.evil).toBeUndefined();
    expect(m.anchor).toEqual({ fieldPath: "$.a" });
  });

  it("listAllMarkers: 全設計のマーカーと、件数 (総数・未解決)", async () => {
    const r = await call("listAllMarkers", { unresolvedOnly: true });
    const items = r.result?.items as Array<{ entityType: string; entityId: string; entityName: string; marker: { resolvedAt?: string } }>;
    expect(items.every((i) => !i.marker.resolvedAt)).toBe(true);
    expect(items[0]).toMatchObject({ entityType: "table", entityId: "orders", entityName: "注文" });
    expect(r.result?.total).toBeGreaterThanOrEqual(3);
    expect(r.result?.unresolved).toBeLessThan(r.result?.total as number);
  });

  it("入力の誤りは、例外 (応答は、wsBridge が、エラーとして返す)", async () => {
    await expect(call("listMarkers", { entityType: "nope", entityId: "x" })).rejects.toThrow("entityType");
    await expect(call("applyMarkerChanges", { entityType: "table", entityId: "../x", changes: {} })).rejects.toThrow();
    expect((await call("applyMarkerChanges", { entityType: "table", entityId: "ghost", changes: {} })).error).toContain("見つかりません");
  });
});
