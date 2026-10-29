import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable, writeProcessFlow, writeGenericDefinition } from "./projectStorage.js";
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
beforeAll(async () => {
  await writeGenericDefinition("OrderForm", "data-contract", {
    kind: "data-contract", name: "OrderForm", purpose: "納品書の入力契約。引当に使う", responsibilities: ["入力を受ける"], targets: ["backend"],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

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

  it("汎用定義 (種類/名前) も、本文から探せる", async () => {
    const hits = await searchDesign(ROOT, "引当に使う");
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toContain("generic-definition:data-contract/OrderForm");
    expect(hits.find((h) => h.kind === "generic-definition")?.matches[0].text).toContain("引当に使う");
  });
});

describe("検索は、設計のファイルを書き換えない (開いただけ・打っただけで原本を書き換えない)", () => {
  it("uuid の無いシーケンス・ビュー・ビュー定義・ページレイアウト・テーブル・処理フローは、検索・設計書の入力・一覧への補完を通しても変わらない", async () => {
    const root = path.join(os.tmpdir(), `design-search-ro-${process.pid}-${Date.now()}`);
    try {
      const dirs = { sequences: "ユニークな採番の列", views: "ユニークな採番のビュー", "view-definitions": "ユニークな採番の定義", "page-layouts": "ユニークな採番の配置", tables: "ユニークな採番の表" };
      await fs.mkdir(path.join(root, "harmony"), { recursive: true });
      await fs.writeFile(path.join(root, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000e", name: "t", createdAt: ts, updatedAt: ts }, entities: {} }));
      const files: string[] = [];
      for (const [dir, name] of Object.entries(dirs)) {
        await fs.mkdir(path.join(root, "harmony", dir), { recursive: true });
        const f = path.join(root, "harmony", dir, "x-a.json");
        await fs.writeFile(f, JSON.stringify({ id: "x-a", name, physicalName: "x_a", columns: [], description: name })); // uuid なし
        files.push(f);
      }
      await fs.mkdir(path.join(root, "harmony", "process-flows"), { recursive: true });
      const flow = path.join(root, "harmony", "process-flows", "f-a.json");
      await fs.writeFile(flow, JSON.stringify({ meta: { id: "f-a", name: "ユニークな採番の流れ", flowType: "common", createdAt: ts, updatedAt: ts }, actions: [] })); // meta.uuid なし
      files.push(flow);
      const before = await Promise.all(files.map((f) => fs.readFile(f, "utf-8")));
      const dirsBefore = (await fs.readdir(path.join(root, "harmony"))).sort();

      const hits = await searchDesign(root, "ユニークな採番");
      expect(hits.length).toBeGreaterThanOrEqual(5);
      const { mergeUnregisteredEntities } = await import("./registryMerge.js");
      const { readProject } = await import("./projectStorage.js");
      await mergeUnregisteredEntities(await readProject(root), root);

      expect(await Promise.all(files.map((f) => fs.readFile(f, "utf-8")))).toEqual(before);
      expect((await fs.readdir(path.join(root, "harmony"))).sort()).toEqual(dirsBefore); // ディレクトリも作らない
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("汎用定義の種類は、schemas/v3/generic-definitions/ と同じ (種類の追加で、検索の対象から漏れない)", async () => {
    const { GENERIC_DEFINITION_KINDS } = await import("./designSearch.js");
    const dir = path.resolve(__dirname, "../../schemas/v3/generic-definitions");
    const kinds = (await fs.readdir(dir)).filter((f) => f.endsWith(".v3.schema.json")).map((f) => f.replace(".v3.schema.json", "")).sort();
    expect([...GENERIC_DEFINITION_KINDS].sort()).toEqual(kinds);
  });
});
