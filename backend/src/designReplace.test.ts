import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, writeProcessFlow, writeGenericDefinition, readTable } from "./projectStorage.js";
import {
  _clearReplaceUndoForTest, applyReplace, candidateKey, listReplaceUndo, previewReplace, undoReplace, QUERY_MAX, type ReplaceCandidate, type ReplaceOptions,
} from "./designReplace.js";

let ROOT = "";
const ts = "2026-01-01T00:00:00.000Z";
const pick = (cs: readonly ReplaceCandidate[]) => cs.map((c) => ({ key: c.key, before: c.before }));
const opts = (query: string, replacement: string, caseSensitive = false): ReplaceOptions => ({ query, replacement, caseSensitive });

async function seed() {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-00000000000c", name: "t", createdAt: ts, updatedAt: ts }, entities: {},
  }));
  await writeTable("orders", {
    id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "customer_orders", name: "顧客注文", comment: "顧客ごとの受注", createdAt: ts, updatedAt: ts,
    columns: [
      { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true },
      { id: "cust", no: 2, physicalName: "customer_id", name: "顧客ID", comment: "顧客マスタへの参照", dataType: "BIGINT" },
    ],
  }, ROOT);
  await writeProcessFlow("order-confirm", {
    meta: { id: "order-confirm", name: "注文確定", flowType: "common", createdAt: ts, updatedAt: ts },
    actions: [{ id: "act-001", name: "確定", trigger: "click", steps: [
      { id: "step-01", kind: "compute", description: "顧客の与信を確認する", subSteps: [{ id: "step-02", kind: "log", description: "顧客が未登録なら記録する" }] },
      { id: "step-03", kind: "compute", description: "金額を計算する", expression: "customerRank > 3" },
    ] }],
  }, ROOT);
  await writeGenericDefinition("CustomerMessages", "message", {
    kind: "message", name: "CustomerMessages", purpose: "顧客向けのメッセージ集", responsibilities: ["顧客に通知する"], targets: ["shared"],
  }, ROOT);
}

beforeEach(async () => { ROOT = path.join(os.tmpdir(), `design-replace-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`); await seed(); _clearReplaceUndoForTest(); });
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("検索置換の予行", () => {
  it("名前・備考・工程の説明 (入れ子の中も) から、場所つきで見つけ、置換後の文言を見せる。何も書かない", async () => {
    const before = await fs.readFile(path.join(ROOT, "harmony", "tables", "orders.json"), "utf-8");
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const byKey = new Map(p.candidates.map((c) => [c.key, c]));
    expect(byKey.get(candidateKey("table", "orders", "name"))).toMatchObject({ before: "顧客注文", after: "取引先注文", entityName: "顧客注文" });
    const col = p.candidates.find((c) => c.kind === "table" && c.before === "顧客マスタへの参照");
    expect(col?.where).toContain("カラム 顧客ID");
    expect(p.candidates.some((c) => c.kind === "process-flow" && c.before === "顧客が未登録なら記録する")).toBe(true);
    expect(p.total).toBe(p.candidates.length);
    expect(p.truncated).toBe(false);
    expect(await fs.readFile(path.join(ROOT, "harmony", "tables", "orders.json"), "utf-8")).toBe(before);
  });

  it("物理名・式・ID・汎用定義の識別子 (name) は対象外。汎用定義の目的・責務の説明文は対象", async () => {
    const p = await previewReplace(ROOT, opts("customer", "client"));
    // 物理名 customer_orders / customer_id、式 customerRank、汎用定義の name "CustomerMessages" は、どれも置換の候補に出ない
    expect(p.candidates).toEqual([]);
    const q = await previewReplace(ROOT, opts("顧客", "取引先"));
    expect(q.candidates.some((c) => c.kind === "generic-definition" && c.before === "顧客向けのメッセージ集")).toBe(true);
    expect(q.candidates.some((c) => c.kind === "generic-definition" && c.where.endsWith("名前"))).toBe(false);
  });

  it("識別子だけの name・@ で始まる参照つきの文言は、候補にしない", async () => {
    await writeTable("t2", {
      id: "t2", uuid: "44444444-4444-4444-8444-444444444442", physicalName: "t2", name: "customerRank", comment: "@msg.customer-note[顧客]", createdAt: ts, updatedAt: ts,
      columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT" }],
    }, ROOT);
    const p = await previewReplace(ROOT, opts("customer", "x"));
    expect(p.candidates.filter((c) => c.id === "t2")).toEqual([]);
    const q = await previewReplace(ROOT, opts("顧客", "x"));
    expect(q.candidates.filter((c) => c.id === "t2")).toEqual([]);
  });

  it("大文字小文字は、指定したときだけ区別する。正規表現の記号は、そのままの文字として探す", async () => {
    await writeTable("t3", {
      id: "t3", uuid: "44444444-4444-4444-8444-444444444443", physicalName: "t3", name: "Order (旧) .* 一覧", createdAt: ts, updatedAt: ts,
      columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT" }],
    }, ROOT);
    expect((await previewReplace(ROOT, opts("order", "注文"))).candidates.some((c) => c.id === "t3")).toBe(true);
    expect((await previewReplace(ROOT, opts("order", "注文", true))).candidates.some((c) => c.id === "t3")).toBe(false);
    const star = await previewReplace(ROOT, opts(".*", "★"));
    expect(star.candidates.map((c) => c.after)).toEqual(["Order (旧) ★ 一覧"]);
    expect((await previewReplace(ROOT, opts("(旧)", ""))).candidates[0].after).toBe("Order  .* 一覧");
  });

  it("置換語の「$&」「$1」は、そのままの文字として扱う", async () => {
    const p = await previewReplace(ROOT, opts("顧客注文", "$& $1 $$"));
    expect(p.candidates.find((c) => c.key === candidateKey("table", "orders", "name"))?.after).toBe("$& $1 $$");
  });

  it("探す語が空・長すぎるときは、理由つきで断る。編集中の設計は blocked に出る", async () => {
    await expect(previewReplace(ROOT, opts("", "x"))).rejects.toThrow("探す語を入れてください");
    await expect(previewReplace(ROOT, opts("あ".repeat(QUERY_MAX + 1), "x"))).rejects.toThrow("文字までです");
    const p = await previewReplace(ROOT, opts("顧客", "取引先"), (kind, id) => (kind === "table" && id === "orders" ? "編集中" : null));
    expect(p.blocked).toEqual([{ kind: "table", id: "orders", reason: "編集中" }]);
  });
});

describe("検索置換の適用", () => {
  it("選んだものだけを書き換える。選ばなかったもの・対象外の欄 (物理名・式) は変わらない", async () => {
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const chosen = pick(p.candidates.filter((c) => c.kind === "table" && c.before !== "顧客ごとの受注"));
    const r = await applyReplace(ROOT, opts("顧客", "取引先"), chosen);
    expect(r.replaced).toBe(chosen.length);
    expect(r.files).toBe(1);
    expect(r.skipped).toEqual([]);
    const t = await readTable("orders", ROOT) as { name: string; comment: string; physicalName: string; columns: Array<{ name: string; comment?: string; physicalName: string }> };
    expect(t.name).toBe("取引先注文");
    expect(t.comment).toBe("顧客ごとの受注"); // 選ばなかった
    expect(t.physicalName).toBe("customer_orders");
    expect(t.columns[1]).toMatchObject({ name: "取引先ID", comment: "取引先マスタへの参照", physicalName: "customer_id" });
    const flow = await fs.readFile(path.join(ROOT, "harmony", "process-flows", "order-confirm.json"), "utf-8");
    expect(flow).toContain("顧客の与信を確認する"); // 別の設計は変わらない
    expect(flow).toContain("customerRank > 3");
  });

  it("予行のあとで文言が変えられていたものは、飛ばして理由を返す。ほかは置換する", async () => {
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const keys = pick(p.candidates.filter((c) => c.kind === "table"));
    await writeTable("orders", { ...(await readTable("orders", ROOT) as object), name: "顧客注文 (改)" } as never, ROOT);
    const r = await applyReplace(ROOT, opts("顧客", "取引先"), keys);
    expect(r.skipped.map((s) => s.key)).toContain(candidateKey("table", "orders", "name"));
    expect(r.skipped.find((s) => s.key === candidateKey("table", "orders", "name"))?.reason).toContain("変わっていた");
    expect(r.replaced).toBe(keys.length - 1);
  });

  it("編集中の設計は、書き換えずに飛ばす。ほかの設計は置換する", async () => {
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const r = await applyReplace(ROOT, opts("顧客", "取引先"), pick(p.candidates), (kind) => (kind === "table" ? "編集中のため" : null));
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped.every((s) => s.reason === "編集中のため" && s.key.startsWith("table:"))).toBe(true);
    expect((await readTable("orders", ROOT) as { name: string }).name).toBe("顧客注文");
    expect(r.touched.map((t) => t.kind).sort()).toEqual(["generic-definition", "process-flow"]);
  });

  it("存在しない key・選択が空は、書かずに結果で知らせる / 断る", async () => {
    await expect(applyReplace(ROOT, opts("顧客", "x"), [])).rejects.toThrow("選んでください");
    const r = await applyReplace(ROOT, opts("顧客", "x"), [{ key: candidateKey("table", "ghost", "name"), before: "x" }]);
    expect(r).toMatchObject({ operationId: null, replaced: 0, files: 0 });
    expect(r.skipped).toHaveLength(1);
  });

  it("書き換える前の内容は、保存前の版 (.harmony-backups) にも残る", async () => {
    const p = await previewReplace(ROOT, opts("顧客注文", "取引先注文"));
    await applyReplace(ROOT, opts("顧客注文", "取引先注文"), pick(p.candidates));
    const dir = path.join(ROOT, ".harmony-backups");
    const all: string[] = [];
    const walk = async (d: string) => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else all.push(await fs.readFile(f, "utf-8")); } };
    await walk(dir);
    expect(all.some((t) => t.includes("顧客注文"))).toBe(true);
  });
});

describe("検索置換の取り消し", () => {
  it("置換を取り消すと、元の文字列そのままに戻る (整形も含めて)", async () => {
    const file = path.join(ROOT, "harmony", "tables", "orders.json");
    const original = await fs.readFile(file, "utf-8");
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const r = await applyReplace(ROOT, opts("顧客", "取引先"), pick(p.candidates));
    expect(await fs.readFile(file, "utf-8")).not.toBe(original);
    expect(listReplaceUndo(ROOT).map((u) => u.operationId)).toEqual([r.operationId]);
    const u = await undoReplace(ROOT, r.operationId!);
    expect(u.conflicts).toEqual([]);
    expect(u.restored).toBe(r.files);
    expect(await fs.readFile(file, "utf-8")).toBe(original);
    expect(listReplaceUndo(ROOT)).toEqual([]);
    await expect(undoReplace(ROOT, r.operationId!)).rejects.toThrow("取り消せる置換が見つかりません");
  });

  it("置換のあとで変えられたファイルは、戻さずに知らせる (あとの変更を、古い内容で上書きしない)", async () => {
    const p = await previewReplace(ROOT, opts("顧客", "取引先"));
    const r = await applyReplace(ROOT, opts("顧客", "取引先"), pick(p.candidates));
    const t = await readTable("orders", ROOT) as object;
    await writeTable("orders", { ...t, comment: "あとで書いた備考" } as never, ROOT);
    const u = await undoReplace(ROOT, r.operationId!);
    expect(u.conflicts).toEqual(["tables/orders.json"]);
    expect((await readTable("orders", ROOT) as { comment: string }).comment).toBe("あとで書いた備考");
    expect(u.restored).toBe(r.files - 1);
  });
});
