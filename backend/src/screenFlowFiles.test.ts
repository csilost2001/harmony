/**
 * ブラウザ無しの画面フローの書き込み (#1591 レビュー): 同時に来た呼び出しが消えない・途中で失敗したら戻る。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const hoisted = vi.hoisted(() => ({ failWriteProject: false }));
vi.mock("./projectStorage.js", async (orig) => {
  const actual = await orig<typeof import("./projectStorage.js")>();
  return {
    ...actual,
    writeProject: (async (...args: Parameters<typeof actual.writeProject>) => {
      if (hoisted.failWriteProject) throw new Error("書き込み失敗 (試験)");
      return actual.writeProject(...args);
    }) as typeof actual.writeProject,
  };
});

import { addScreenToFiles, addEdgeToFiles, removeScreenFromFiles, removeEdgeFromFiles, updateScreenInFiles } from "./screenFlowFiles.js";
import { readProject, readScreenFlowPositions } from "./projectStorage.js";

const ts = "2026-01-01T00:00:00.000Z";
let ROOT = "";
beforeEach(async () => {
  hoisted.failWriteProject = false;
  ROOT = path.join(os.tmpdir(), `screenflow-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(path.join(ROOT, "design", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "design",
    meta: { id: "screenflow-test", uuid: "00000000-0000-4000-8000-0000000000e1", name: "試験", createdAt: ts, updatedAt: ts },
    entities: {},
  }));
});
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const add = (name: string, id?: string) => addScreenToFiles(ROOT, { name, id, purpose: "page" });
const screensOf = async () => ((await readProject(ROOT)) as { entities: { screens?: Array<{ id: string; no: number }>; screenTransitions?: Array<{ id: string }> } }).entities;
const posOf = async () => ((await readScreenFlowPositions(ROOT)) as { positions: Record<string, Rect> } | null)?.positions ?? {};
const entityFiles = async () => (await fs.readdir(path.join(ROOT, "design", "screens"))).filter((f) => f.endsWith(".json")).sort();

describe("同時に来た呼び出しは、1 本ずつ処理される (黙って消えない)", () => {
  it("6 件同時の add_screen: 索引 6 件・位置 6 件・実体 6 件・no は 1..6・位置は重ならない", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => add(`画面${i}`)));
    const e = await screensOf();
    expect(e.screens).toHaveLength(6);
    expect(e.screens!.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(e.screens!.map((s) => s.id))).toEqual(new Set(results.map((r) => r.screenId)));
    const pos = await posOf();
    expect(Object.keys(pos)).toHaveLength(6);
    const rects = Object.values(pos);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
    expect(await entityFiles()).toHaveLength(6);
  });

  it("同じ id を 3 件同時に指定: 1 件だけ成功し、2 件は断られる", async () => {
    const settled = await Promise.allSettled([add("A", "same-id"), add("B", "same-id"), add("C", "same-id")]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(String(r.reason.message)).toMatch(/すでにあります/);
    expect((await screensOf()).screens).toHaveLength(1);
    expect(await entityFiles()).toEqual(["same-id.json"]);
  });

  it("add_screen と add_edge / remove_screen / update_screen / remove_edge の同時: どれも結果に反映される", async () => {
    await add("基準A", "base-a");
    await add("基準B", "base-b");
    await addEdgeToFiles(ROOT, { source: "base-a", target: "base-b", label: "", trigger: "click" }); // tr-01
    const ops = await Promise.all([
      add("新1", "new-1"),
      add("新2", "new-2"),
      addEdgeToFiles(ROOT, { source: "base-b", target: "base-a", label: "戻る" }),
      updateScreenInFiles(ROOT, "base-a", { name: "基準A改" }),
      add("新3", "new-3"),
      removeEdgeFromFiles(ROOT, "tr-01"),
    ]);
    expect(ops).toHaveLength(6);
    const e = await screensOf();
    expect(e.screens!.map((s) => s.id).sort()).toEqual(["base-a", "base-b", "new-1", "new-2", "new-3"]);
    expect(e.screens!.map((s) => s.no).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(e.screenTransitions!).toHaveLength(1); // tr-01 を消し、戻る を足した
    expect(e.screenTransitions![0].id).not.toBe("tr-01");
    expect((e.screens as unknown as Array<{ id: string; name: string }>).find((s) => s.id === "base-a")!.name).toBe("基準A改");
    expect(Object.keys(await posOf()).sort()).toEqual(["base-a", "base-b", "new-1", "new-2", "new-3"]);

    // 追加と削除の同時
    await Promise.all([add("新4", "new-4"), removeScreenFromFiles(ROOT, "new-1"), add("新5", "new-5")]);
    const after = await screensOf();
    expect(after.screens!.map((s) => s.id).sort()).toEqual(["base-a", "base-b", "new-2", "new-3", "new-4", "new-5"]);
    expect(after.screens!.map((s) => s.no).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.keys(await posOf()).sort()).toEqual(["base-a", "base-b", "new-2", "new-3", "new-4", "new-5"]);
    expect(await entityFiles()).toHaveLength(6);
  });
});

describe("途中で失敗したら、書いたものを全て戻す", () => {
  it("索引の書き込みが失敗: 実体も位置も残らない (位置ファイルが元から無ければ作らない)", async () => {
    hoisted.failWriteProject = true;
    await expect(add("失敗", "will-fail")).rejects.toThrow(/書き込み失敗/);
    expect(await entityFiles()).toEqual([]);
    expect(await readScreenFlowPositions(ROOT)).toBeNull();
    hoisted.failWriteProject = false;
    expect((await screensOf()).screens).toBeUndefined();
  });

  it("位置ファイルが元からあるとき、失敗しても元の位置のまま", async () => {
    await add("先", "first");
    const before = await posOf();
    hoisted.failWriteProject = true;
    await expect(add("失敗", "will-fail")).rejects.toThrow(/書き込み失敗/);
    expect(await posOf()).toEqual(before);
    expect(await entityFiles()).toEqual(["first.json"]);
    // 同じ ID をやり直せる (位置が引き継がれない)
    hoisted.failWriteProject = false;
    const r = await add("再", "will-fail");
    expect(r.screenId).toBe("will-fail");
  });
});
