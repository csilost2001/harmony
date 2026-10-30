/**
 * テーブルの MCP tool (#1568): harmony.json は v3 の entities.tables に書く (最上位に tables / updatedAt を足さない)。
 * add_table の引数は physicalName (物理名) と name (表示名)。旧形式の項目は repair_registry で取り除ける。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildHarmonyAjv } from "@harmony/shared";
import { handleTableTool } from "./table.js";
import { handleDesignTool } from "./design.js";
import { handleExportTool } from "./export.js";
import { readProject } from "../projectStorage.js";
import { inspectWorkspacePath } from "../workspaceInit.js";
import { repairRegistry, scanWorkspaceHealth } from "../workspaceHealth.js";

const SCHEMAS = path.resolve(import.meta.dirname, "../../../schemas/v3");
const ts = "2026-01-01T00:00:00.000Z";

let ROOT = "";
beforeEach(async () => {
  ROOT = path.join(os.tmpdir(), `table-tool-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(path.join(ROOT, "design", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "design",
    meta: { id: "table-tool-test", uuid: "00000000-0000-4000-8000-0000000000b1", name: "テーブル試験", createdAt: ts, updatedAt: ts },
    entities: {},
  }, null, 2));
});
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

const text = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await handleTableTool(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return res.content[0].text;
};
const idOf = (message: string) => /ID: (table-[0-9a-f]+)/.exec(message)![1];

async function validateHarmony(): Promise<{ ok: boolean; errors: unknown }> {
  const ajv = buildHarmonyAjv();
  ajv.addSchema(JSON.parse(await fs.readFile(path.join(SCHEMAS, "common.v3.schema.json"), "utf-8")));
  const validate = ajv.compile(JSON.parse(await fs.readFile(path.join(SCHEMAS, "harmony.v3.schema.json"), "utf-8")));
  const project = JSON.parse(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8"));
  return { ok: validate(project) as boolean, errors: validate.errors };
}

const columns = [
  { id: "id-col", physicalName: "id", name: "ID", dataType: "INTEGER", notNull: true },
  { id: "amount-col", physicalName: "amount", name: "金額", dataType: "INTEGER" },
];

describe("designer__add_table / update_table / remove_table は v3 の harmony.json を保つ", () => {
  it("追加 → 更新 → 削除のあとも、harmony.json は v3 スキーマに合い、entities.tables が最新である", async () => {
    const added = await text("designer__add_table", { physicalName: "expenses", name: "経費", category: "トランザクション" });
    const id = idOf(added);
    expect((await validateHarmony()).ok).toBe(true);

    const def = { id, physicalName: "expenses", name: "経費明細", category: "トランザクション", columns };
    await text("designer__update_table", { tableId: id, definition: def });
    const v = await validateHarmony();
    expect(v.ok, JSON.stringify(v.errors)).toBe(true);
    const project = await readProject(ROOT) as Record<string, unknown>;
    expect(project).not.toHaveProperty("tables");
    expect(project).not.toHaveProperty("updatedAt");
    const entries = (project.entities as { tables: Array<Record<string, unknown>> }).tables;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id, no: 1, name: "経費明細", physicalName: "expenses", category: "トランザクション", columnCount: 2 });

    const list = await text("designer__list_tables");
    expect(list).toContain("expenses");
    expect(list).toContain("経費明細");
    expect(list).toContain("カラム:2");

    await text("designer__remove_table", { tableId: id });
    const after = await validateHarmony();
    expect(after.ok, JSON.stringify(after.errors)).toBe(true);
    expect(((await readProject(ROOT)) as { entities: { tables: unknown[] } }).entities.tables).toEqual([]);
    expect(await text("designer__list_tables")).toContain("まだ定義されていません");
  });

  it("2 件目の並び順 (no) は続き番号になり、更新しても変わらない", async () => {
    const a = idOf(await text("designer__add_table", { physicalName: "orders", name: "注文" }));
    const b = idOf(await text("designer__add_table", { physicalName: "customers", name: "顧客" }));
    await text("designer__update_table", { tableId: a, definition: { id: a, physicalName: "orders", name: "注文", columns } });
    const entries = ((await readProject(ROOT)) as { entities: { tables: Array<{ id: string; no: number }> } }).entities.tables;
    expect(entries.map((e) => [e.id, e.no])).toEqual([[a, 1], [b, 2]]);
  });

  it("add_table は physicalName と name で v3 の形のファイルを作り、check_design に warning を出さない", async () => {
    const id = idOf(await text("designer__add_table", { physicalName: "expenses", name: "経費", description: "経費の申請" }));
    const file = JSON.parse(await fs.readFile(path.join(ROOT, "design", "tables", `${id}.json`), "utf-8"));
    expect(file).toMatchObject({ id, physicalName: "expenses", name: "経費", description: "経費の申請", columns: [] });
    expect(file).not.toHaveProperty("logicalName");
    expect(typeof file.uuid).toBe("string");

    const res = await handleDesignTool("designer__check_design", {}, ROOT, "s") as { content: Array<{ text: string }> };
    const r = JSON.parse(res.content[0].text) as { issues: Array<{ severity: string; message: string }> };
    const tableIssues = r.issues.filter((i) => /physicalName|logicalName|経費|expenses/.test(i.message) && i.severity !== "info");
    expect(tableIssues, JSON.stringify(tableIssues)).toEqual([]);
  });

  it("旧引数 logicalName は、分かりやすいエラーで断る。物理名の形が違うときも断る", async () => {
    await expect(text("designer__add_table", { name: "expenses", logicalName: "経費" })).rejects.toThrow(/logicalName は使えません.*physicalName/);
    await expect(text("designer__add_table", { name: "経費" })).rejects.toThrow(/physicalName/);
    await expect(text("designer__add_table", { physicalName: "Expenses", name: "経費" })).rejects.toThrow(/snake_case/);
  });

  it("harmony.json が無いワークスペースでは、書く前に止まる (テーブルのファイルも作らない)", async () => {
    await fs.rm(path.join(ROOT, "harmony.json"));
    await expect(text("designer__add_table", { physicalName: "expenses", name: "経費" })).rejects.toThrow(/harmony\.json/);
    expect(await fs.readdir(path.join(ROOT, "design", "tables"))).toEqual([]);
  });

  it("DDL と ER の tool も、v3 の一覧 (entities.tables) からテーブルを見つける", async () => {
    const id = idOf(await text("designer__add_table", { physicalName: "expenses", name: "経費" }));
    await text("designer__update_table", { tableId: id, definition: { id, physicalName: "expenses", name: "経費", columns } });
    const res = await handleExportTool("designer__generate_ddl", {}, ROOT, "s") as { content: Array<{ text: string }> };
    expect(res.content[0].text).toContain("CREATE TABLE"); // 見つかれば DDL が出る (一覧が最上位の tables だった頃は「対象が見つかりません」だった)
  });
});

describe("旧形式の項目 (最上位の tables / updatedAt) の修復", () => {
  const breakWorkspace = async () => {
    const id = idOf(await text("designer__add_table", { physicalName: "expenses", name: "経費" }));
    const project = await readProject(ROOT) as Record<string, unknown>;
    // 旧形式の tool が書いていた壊れ方を再現する
    await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
      ...project,
      tables: [{ id, name: "経費", category: "トランザクション", columnCount: 6, updatedAt: ts }],
      updatedAt: ts,
    }, null, 2));
    return id;
  };

  it("壊れた harmony.json は、画面で開けず、修復の案内が付く。MCP では開いて直せる状態と分かる", async () => {
    await breakWorkspace();
    expect((await validateHarmony()).ok).toBe(false);
    const inspect = await inspectWorkspacePath(ROOT);
    expect(inspect.status).toBe("invalid");
    if (inspect.status === "invalid") {
      expect(inspect.reason).toContain("designer__repair_registry");
      expect(inspect.repairable).toBe(true);
    }
    const health = await scanWorkspaceHealth(ROOT);
    const hit = health.find((i) => i.code === "registry-legacy-keys");
    expect(hit?.maintenance).toBe(true);
    expect(hit?.message).toContain("tables");
    expect(hit?.message).toContain("updatedAt");
  });

  it("repairRegistry は、予行では書かず旧形式の項目を挙げ、apply で取り除く。もう一度やると何も起きない", async () => {
    await breakWorkspace();
    const before = await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8");
    const dry = await repairRegistry(ROOT, false);
    expect(dry.applied).toBe(false);
    expect(dry.removeKeys.sort()).toEqual(["tables", "updatedAt"]);
    expect(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")).toBe(before);

    const done = await repairRegistry(ROOT, true);
    expect(done.applied).toBe(true);
    const v = await validateHarmony();
    expect(v.ok, JSON.stringify(v.errors)).toBe(true);
    expect((await inspectWorkspacePath(ROOT)).status).toBe("ready");
    expect(await repairRegistry(ROOT, true)).toMatchObject({ applied: false, removeKeys: [] });
  });

  it("designer__repair_registry (MCP) でも同じく、予行 → apply で直る", async () => {
    await breakWorkspace();
    const call = async (args: Record<string, unknown>) => {
      const res = await handleDesignTool("designer__repair_registry", args, ROOT, "s") as { content: Array<{ text: string }> };
      return JSON.parse(res.content[0].text) as { removeKeys: string[]; applied: boolean };
    };
    const dry = await call({});
    expect(dry).toMatchObject({ applied: false });
    expect(dry.removeKeys.sort()).toEqual(["tables", "updatedAt"]);
    expect(await call({ apply: true })).toMatchObject({ applied: true });
    expect((await validateHarmony()).ok).toBe(true);
  });
});
