/**
 * 業務フロー・帳票の保存層の堅牢さ (PR #1483 レビューの指摘):
 * - 改名追従はファイル名に書き戻す (中の id と食い違っても別名の重複ファイルを作らない)
 * - 壊れた JSON は黙って消えず、一覧に unreadable として出る。読み出しはエラー。保存は壊れたファイルを退避してから行う
 * - 開いたあとに他で更新されていたら、保存せず競合として知らせる (楽観ロック)
 * - 改名追従の 1 件の失敗は警告として返し、他の文書の更新は続ける
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writeBusinessFlow, readBusinessFlow, listBusinessFlowsDetailed, renameBusinessFlowRefsInProject,
  writeReport, listReportsDetailed, readReport, DocConflictError,
} from "./projectStorage.js";

const ROOT = path.join(os.tmpdir(), `biz-docs-${process.pid}-${Date.now()}`);
const dir = (d: string) => path.join(ROOT, "harmony", d);
const flow = (screenRef = "cart") => ({
  name: "フロー", lanes: [{ id: "a", name: "A" }],
  steps: [{ id: "s", lane: "a", kind: "start", name: "開始", screenRef, next: [{ to: "e" }] }, { id: "e", lane: "a", kind: "end", name: "終了" }],
});

beforeAll(async () => {
  await fs.mkdir(dir("screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-00000000000b", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [] },
  }));
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("改名追従は読んだファイルへ書き戻す", () => {
  it("ファイル名と中の id が食い違っていても、別名の重複ファイルを作らない", async () => {
    await writeBusinessFlow("mismatch", flow("cart"), ROOT);
    const file = path.join(dir("business-flows"), "mismatch.json");
    const raw = JSON.parse(await fs.readFile(file, "utf-8"));
    await fs.writeFile(file, JSON.stringify({ ...raw, id: "other-name" }));
    const res = await renameBusinessFlowRefsInProject("screen", "cart", "basket", ROOT);
    expect(res.changed).toEqual(["mismatch"]);
    expect((await fs.readdir(dir("business-flows"))).filter((f) => f.endsWith(".json"))).toEqual(["mismatch.json"]);
    expect(JSON.parse(await fs.readFile(file, "utf-8")).steps[0].screenRef).toBe("basket");
  });
});

describe("壊れた JSON", () => {
  it("一覧から黙って消えず unreadable に出る。読み出しはエラー", async () => {
    await writeBusinessFlow("ok-flow", flow(), ROOT);
    await fs.writeFile(path.join(dir("business-flows"), "broken.json"), "{ not json");
    const listed = await listBusinessFlowsDetailed(ROOT);
    expect(listed.unreadable).toEqual(["broken.json"]);
    expect(listed.flows.map((f) => f.id)).toContain("ok-flow");
    await expect(readBusinessFlow("broken", ROOT)).rejects.toThrow(/JSON が壊れています/);
    expect(await readBusinessFlow("nothing", ROOT)).toBeNull();
  });

  it("保存は壊れたファイルを退避してから新しい内容を書く。改名追従は警告を返し、他の文書は更新する", async () => {
    const res = await renameBusinessFlowRefsInProject("screen", "cart", "basket2", ROOT);
    expect(res.warnings.join("\n")).toContain("broken.json");
    expect(res.changed).toContain("ok-flow");
    await writeBusinessFlow("broken", flow(), ROOT);
    const files = await fs.readdir(dir("business-flows"));
    expect(files.some((f) => f.startsWith("broken.json.broken-"))).toBe(true);
    expect((await listBusinessFlowsDetailed(ROOT)).unreadable).toEqual([]);
  });

  it("帳票も同様に unreadable が出る", async () => {
    await writeReport("ok-report", { name: "帳票", sections: [] }, ROOT);
    await fs.writeFile(path.join(dir("reports"), "bad.json"), "[1,");
    const listed = await listReportsDetailed(ROOT);
    expect(listed.unreadable).toEqual(["bad.json"]);
    await expect(readReport("bad", ROOT)).rejects.toThrow(/壊れています/);
  });
});

describe("楽観ロック (他で更新されていたら保存しない)", () => {
  it("開いたときの更新日時と違えば競合。同じなら保存でき、指定なしは上書き", async () => {
    const first = await writeBusinessFlow("lock-flow", flow(), ROOT);
    await new Promise((r) => setTimeout(r, 5));
    const other = await writeBusinessFlow("lock-flow", { ...flow(), name: "他の人の変更" }, ROOT); // 他で更新
    await expect(writeBusinessFlow("lock-flow", { ...flow(), name: "自分の変更" }, ROOT, first.updatedAt as string)).rejects.toBeInstanceOf(DocConflictError);
    expect((await readBusinessFlow("lock-flow", ROOT))!.name).toBe("他の人の変更");
    const mine = await writeBusinessFlow("lock-flow", { ...flow(), name: "読み直したあとの変更" }, ROOT, other.updatedAt as string);
    expect(mine.name).toBe("読み直したあとの変更");
    await new Promise((r) => setTimeout(r, 5));
    await writeBusinessFlow("lock-flow", { ...flow(), name: "強制" }, ROOT);
    expect((await readBusinessFlow("lock-flow", ROOT))!.name).toBe("強制");
  });

  it("新規作成 (まだ無い) のときは確認しない。帳票も同じ", async () => {
    await expect(writeBusinessFlow("brand-new", flow(), ROOT, "2020-01-01T00:00:00.000Z")).resolves.toBeTruthy();
    const r = await writeReport("lock-report", { name: "帳票", sections: [] }, ROOT);
    await new Promise((x) => setTimeout(x, 5));
    await writeReport("lock-report", { name: "他", sections: [] }, ROOT);
    await expect(writeReport("lock-report", { name: "自分", sections: [] }, ROOT, r.updatedAt as string)).rejects.toThrow(/他で更新されています/);
  });
});
