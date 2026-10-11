import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, writeProcessFlow } from "./projectStorage.js";
import { searchDesign, normalizeForSearch } from "./designSearch.js";

const ROOT = path.join(os.tmpdir(), `design-search-${process.pid}-${Date.now()}`);
const ts = "2026-01-01T00:00:00.000Z";

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-00000000000c", name: "t", createdAt: ts, updatedAt: ts }, entities: {},
  }));
  await writeTable("orders", {
    id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", comment: "受注の親テーブル", createdAt: ts, updatedAt: ts,
    columns: [
      { id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true },
      { id: "ship", no: 2, physicalName: "ship_date", name: "出荷予定日", comment: "在庫引当の後に決まる", dataType: "DATE" },
    ],
  }, ROOT);
  await writeProcessFlow("order-confirm", {
    meta: { id: "order-confirm", name: "注文確定", flowType: "common", createdAt: ts, updatedAt: ts },
    actions: [{ id: "act-001", name: "確定", trigger: "click", steps: [
      { id: "step-01", kind: "compute", description: "在庫を確認する", subSteps: [{ id: "step-02", kind: "log", description: "不足なら在庫切れを記録する" }] },
    ] }],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("設計の本文検索", () => {
  it("カラムの備考・工程の説明 (入れ子の中も) から、どこに合ったかつきで探せる", async () => {
    const hits = await searchDesign(ROOT, "在庫");
    expect(hits.map((h) => `${h.kind}:${h.id}`).sort()).toEqual(["process-flow:order-confirm", "table:orders"]);
    const t = hits.find((h) => h.kind === "table")!;
    expect(t.matches).toEqual([{ where: "カラム ship_date", text: "在庫引当の後に決まる" }]);
    const f = hits.find((h) => h.kind === "process-flow")!;
    expect(f.matches.map((m) => m.where)).toEqual(["工程 step-01", "工程 step-02"]);
  });

  it("空白区切りは、すべての語が 1 つの文字列に合うものだけ。全角半角・かなの差は無視", async () => {
    expect((await searchDesign(ROOT, "在庫 切れ")).map((h) => h.id)).toEqual(["order-confirm"]);
    expect((await searchDesign(ROOT, "ｼｭｯｶ")).length).toBe(0);
    expect(normalizeForSearch("ＡＢＣ　ひらがな")).toBe("abc ひらがな");
  });

  it("1 文字・空は探さない。設計そのものの名前だけに合うものは返さない (名前検索の側で拾う)", async () => {
    expect(await searchDesign(ROOT, "在")).toEqual([]);
    expect(await searchDesign(ROOT, "")).toEqual([]);
    expect(await searchDesign(ROOT, "注文確定")).toEqual([]);
  });
});
