/**
 * 設計を AI が読み書きする tool (シーケンス・ビュー・汎用定義・規約・技術スタック・検索・工程単位の取得・流れの文章・分岐の分析・検証だけ・変更の差分・比較)。
 * retail サンプルを一時フォルダに複製し、実際の MCP プロトコル (メモリ上の transport) で呼ぶ。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { connect as wsConnect, disconnect as wsDisconnect, setActivePath } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = `design-access-${process.pid}`;
const WS = path.join(os.tmpdir(), `design-access-ws-${process.pid}-${Date.now()}`);

let client: Client;
let closeAll: () => Promise<void>;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const t = (r.content as Array<{ text: string }>)[0].text;
  if (r.isError) throw new Error(t);
  return t;
};
const J = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));

beforeAll(async () => {
  await fs.cp(path.join(REPO, "examples/retail"), WS, { recursive: true });
  wsConnect(SESSION);
  setActivePath(SESSION, WS);
  const server = createMcpServer(SESSION);
  client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closeAll = async () => { await client.close(); await server.close(); };
});
afterAll(async () => {
  await closeAll();
  wsDisconnect(SESSION);
  await fs.rm(WS, { recursive: true, force: true });
});

describe("シーケンス・ビュー・ビュー定義・汎用定義", () => {
  it("一覧: 種類ごとに件数と要約が返る (retail にある)", async () => {
    for (const kind of ["sequence", "view", "viewDefinition"]) {
      const r = await J("designer__list_designs", { kind });
      expect(r.count, kind).toBeGreaterThan(0);
      expect(r.items[0].id).toEqual(expect.any(String));
    }
    const g = await J("designer__list_designs", { kind: "genericDefinition" });
    expect(g.count).toBeGreaterThan(0);
    expect(g.items[0]).toMatchObject({ definitionKind: expect.any(String), name: expect.any(String) });
    const only = await J("designer__list_designs", { kind: "genericDefinition", definitionKind: g.items[0].definitionKind });
    expect(only.items.every((i: { definitionKind: string }) => i.definitionKind === g.items[0].definitionKind)).toBe(true);
  });

  it("読む: id / 名前で原本が返り、ないものは案内つきで断る", async () => {
    const list = await J("designer__list_designs", { kind: "sequence" });
    const seq = await J("designer__get_design", { kind: "sequence", id: list.items[0].id });
    expect(seq.id).toBe(list.items[0].id);
    await expect(call("designer__get_design", { kind: "sequence", id: "no-such-sequence" })).rejects.toThrow(/list_designs/);
    const g = await J("designer__list_designs", { kind: "genericDefinition" });
    const one = await J("designer__get_design", { kind: "genericDefinition", definitionKind: g.items[0].definitionKind, name: g.items[0].name });
    expect(one.name).toBe(g.items[0].name);
  });

  it("保存 → 読む → 削除 (シーケンス)。id を design の中の id より優先する", async () => {
    const saved = await J("designer__save_design", { kind: "sequence", id: "seq-added-by-ai", design: { id: "other", name: "AI が足した", description: "テスト" } });
    expect(saved.saved).toBe(true);
    const back = await J("designer__get_design", { kind: "sequence", id: "seq-added-by-ai" });
    expect(back).toMatchObject({ id: "seq-added-by-ai", name: "AI が足した" });
    expect((await J("designer__list_designs", { kind: "sequence" })).items.map((i: { id: string }) => i.id)).toContain("seq-added-by-ai");
    expect((await J("designer__delete_design", { kind: "sequence", id: "seq-added-by-ai" })).deleted).toBe(true);
    await expect(call("designer__get_design", { kind: "sequence", id: "seq-added-by-ai" })).rejects.toThrow();
  });

  it("保存 → 読む → 削除 (汎用定義)", async () => {
    await J("designer__save_design", { kind: "genericDefinition", definitionKind: "message", name: "ai-added-message", design: { description: "AI が足した" } });
    expect(await J("designer__get_design", { kind: "genericDefinition", definitionKind: "message", name: "ai-added-message" })).toMatchObject({ name: "ai-added-message", description: "AI が足した" });
    await J("designer__delete_design", { kind: "genericDefinition", definitionKind: "message", name: "ai-added-message" });
    await expect(call("designer__get_design", { kind: "genericDefinition", definitionKind: "message", name: "ai-added-message" })).rejects.toThrow();
  });

  it("不正な入力は断る: 知らない種類・パスをたどる id / 名前・オブジェクトでない design・知らない汎用定義の種類", async () => {
    await expect(call("designer__list_designs", { kind: "screen" })).rejects.toThrow(/kind/);
    await expect(call("designer__save_design", { kind: "sequence", id: "../../escape", design: {} })).rejects.toThrow();
    await expect(call("designer__save_design", { kind: "genericDefinition", definitionKind: "message", name: "../escape", design: {} })).rejects.toThrow();
    await expect(call("designer__save_design", { kind: "genericDefinition", definitionKind: "nope", name: "x", design: {} })).rejects.toThrow(/definitionKind/);
    await expect(call("designer__save_design", { kind: "sequence", id: "ok-id", design: "文字列" })).rejects.toThrow();
    await expect(fs.stat(path.join(WS, "..", "escape.json"))).rejects.toThrow();
  });
});

describe("規約・技術スタック", () => {
  it("規約: 読んで、直して、保存すると、読み直しで反映される", async () => {
    const c = await J("designer__get_conventions");
    expect(c).toBeTruthy();
    await J("designer__save_conventions", { conventions: { ...c, aiTouched: true } });
    expect((await J("designer__get_conventions")).aiTouched).toBe(true);
    await expect(call("designer__save_conventions", { conventions: "x" })).rejects.toThrow();
  });

  it("技術スタック: 読んで、直して、保存すると、読み直しと get_project_context に反映される", async () => {
    const t = await J("designer__get_tech_stack");
    expect(t).toBeTruthy();
    await J("designer__save_tech_stack", { techStack: { ...t, aiTouched: "yes" } });
    expect((await J("designer__get_tech_stack")).aiTouched).toBe("yes");
    expect((await J("designer__get_project_context")).techStack.aiTouched).toBe("yes");
    await expect(call("designer__save_tech_stack", { techStack: [] })).rejects.toThrow();
  });
});

describe("検索・工程単位の取得・流れの文章・分岐の分析", () => {
  it("設計全体の本文検索: 一致が返る。短すぎる query は断る", async () => {
    const r = await J("designer__search_design", { query: "カート" });
    expect(r.count).toBeGreaterThan(0);
    expect(r.hits[0]).toMatchObject({ kind: expect.any(String), id: expect.any(String), matches: expect.any(Array) });
    await expect(call("designer__search_design", { query: " " })).rejects.toThrow();
  });

  it("list_steps: 番号・id・種類・入れ子の深さが返る", async () => {
    const r = await J("designer__list_steps", { processFlowId: "cart-add" });
    const steps = r.actions[0].steps as Array<{ no: string; id?: string; kind: string; depth: number; type: string }>;
    expect(steps.length).toBeGreaterThan(10);
    expect(steps[0].no).toBe("1");
    expect(steps.some((s) => s.type === "branch-arm" && s.depth > 0)).toBe(true);
    expect(steps.some((s) => s.id === "step-03")).toBe(true);
    await expect(call("designer__list_steps", { processFlowId: "cart-add", actionId: "nope" })).rejects.toThrow(/アクション/);
  });

  it("get_step: 入れ子の中の工程を親の経路つきで返す。ない工程は案内つきで断る", async () => {
    const list = await J("designer__list_steps", { processFlowId: "cart-add" });
    const inner = (list.actions[0].steps as Array<{ id?: string; depth: number; type: string }>).find((s) => s.type === "step" && s.depth >= 2 && s.id);
    expect(inner).toBeTruthy();
    const r = await J("designer__get_step", { processFlowId: "cart-add", stepId: inner!.id });
    expect(r.step.id).toBe(inner!.id);
    expect(r.path.length).toBeGreaterThan(0);
    expect(r.path[0]).toMatchObject({ role: expect.any(String) });
    await expect(call("designer__get_step", { processFlowId: "cart-add", stepId: "no-such-step" })).rejects.toThrow(/list_steps/);
  });

  it("get_flow_story: 条件を言葉にした入れ子の文章 (Markdown) を返す", async () => {
    const t = await call("designer__get_flow_story", { processFlowId: "cart-add" });
    expect(t).toMatch(/^# .+ \(cart-add\)/);
    expect(t).toContain("## アクション:");
    expect(t).toMatch(/- 1 \[/);
    expect(t).toMatch(/のとき/);
    expect(t).not.toMatch(/@inputs\./); // 変数の名前は言葉に直る
  });

  it("analyze_branches: 判定表 (行・列・指摘) を返し、stepId で絞れる", async () => {
    const all = await J("designer__analyze_branches", { processFlowId: "cart-add" });
    expect(all.branches.length).toBeGreaterThan(0);
    const one = await J("designer__analyze_branches", { processFlowId: "cart-add", stepId: "step-03" });
    expect(one.branches).toHaveLength(1);
    expect(one.branches[0]).toMatchObject({ stepId: "step-03", rows: expect.any(Array), columns: expect.any(Array), issues: expect.any(Array) });
    expect(one.note).toContain("最初に成り立った道");
  });
});

describe("検証だけ・変更の差分・比較", () => {
  it("validate_design: 正しい処理フローは valid、壊れたものは理由つきで invalid。何も保存しない", async () => {
    const good = JSON.parse(await fs.readFile(path.join(WS, "harmony/process-flows/cart-add.json"), "utf8"));
    expect((await J("designer__validate_design", { kind: "processFlow", design: good })).valid).toBe(true);
    const broken = await J("designer__validate_design", { kind: "processFlow", design: { meta: 5, actions: "x" } });
    expect(broken.valid).toBe(false);
    expect(broken.issues.length).toBeGreaterThan(0);
    expect(broken.issues[0].message).toContain("スキーマ");
    await expect(fs.stat(path.join(WS, "harmony/process-flows/undefined.json"))).rejects.toThrow();
    await expect(call("designer__validate_design", { kind: "sequence", design: {} })).rejects.toThrow(/kind/);
  });

  it("get_changes_since: 過去の時刻なら全部・未来の時刻なら 0 件。壊れた時刻は断る", async () => {
    const all = await J("designer__get_changes_since", { since: "2000-01-01T00:00:00Z" });
    expect(all.count).toBeGreaterThan(20);
    expect(all.changes[0]).toMatchObject({ kind: expect.any(String), id: expect.any(String), modifiedAt: expect.any(String) });
    expect(all.changes.some((c: { kind: string }) => c.kind === "processFlow")).toBe(true);
    expect(all.changes.every((c: { file: string }) => !c.file.startsWith("."))).toBe(true); // .harmony-backups などは含めない
    const none = await J("designer__get_changes_since", { since: new Date(Date.now() + 3600_000).toISOString() });
    expect(none.count).toBe(0);
    await expect(call("designer__get_changes_since", { since: "きのう" })).rejects.toThrow(/ISO/);
  });

  it("compare_workspaces: 登録されていないワークスペースは断る (任意のパスを読ませない)", async () => {
    await expect(call("designer__compare_workspaces", { other: "/etc" })).rejects.toThrow(/登録済み/);
    await expect(call("designer__compare_workspaces", {})).rejects.toThrow();
  });
});

describe("取り込み (DDL / OpenAPI)", () => {
  const DDL = "CREATE TABLE ai_orders (id SERIAL PRIMARY KEY, customer_name VARCHAR(50) NOT NULL, amount NUMERIC(10,2));";

  it("DDL: 既定は予行 (保存しない)。apply: true で保存し、同じ id は overwrite なしでは置き換えない", async () => {
    const preview = await J("designer__import_ddl", { sql: DDL });
    expect(preview.applied).toBe(false);
    expect(preview.tables).toHaveLength(1);
    expect(preview.tables[0]).toMatchObject({ physicalName: "ai_orders", columns: 3, exists: false });
    const id = preview.tables[0].id as string;
    await expect(fs.stat(path.join(WS, "harmony/tables", `${id}.json`))).rejects.toThrow(); // 予行では書かない

    const applied = await J("designer__import_ddl", { sql: DDL, apply: true });
    expect(applied.written).toEqual([id]);
    expect((await J("designer__get_table", { tableId: id })).physicalName ?? (await J("designer__get_table", { tableId: id })).name).toBeTruthy();

    const again = await J("designer__import_ddl", { sql: DDL, apply: true });
    expect(again.written).toEqual([]);
    expect(again.keptExisting).toEqual([id]);
    expect((await J("designer__import_ddl", { sql: DDL, apply: true, overwrite: true })).written).toEqual([id]);
  });

  it("DDL: 空・大きすぎる入力は断る", async () => {
    await expect(call("designer__import_ddl", { sql: "  " })).rejects.toThrow();
    await expect(call("designer__import_ddl", { sql: "x".repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow(/大きすぎ/);
  });

  it("OpenAPI: 予行 → 保存。工程は空の雛形で、保存した処理フローを list_steps で読める", async () => {
    const spec = { openapi: "3.0.0", info: { title: "ai" }, paths: { "/ai-items": { get: { operationId: "listAiItems", summary: "AI 一覧", responses: { "200": { description: "ok" } } } } } };
    const preview = await J("designer__import_openapi", { spec });
    expect(preview.applied).toBe(false);
    expect(preview.flows).toHaveLength(1);
    const id = preview.flows[0].id as string;
    expect((await J("designer__import_openapi", { spec, apply: true })).written).toEqual([id]);
    const steps = await J("designer__list_steps", { processFlowId: id });
    expect(steps.actions[0].steps).toEqual([]);
    expect((await J("designer__import_openapi", { spec, apply: true })).keptExisting).toEqual([id]);
    await expect(call("designer__import_openapi", { spec: "x" })).rejects.toThrow();
  });
});

describe("設計書の章ごとの取得", () => {
  it("目次と要確認の件数が返り、章を指定すると、その章の文章だけが返る", async () => {
    const toc = await J("designer__get_design_document");
    expect(toc.toc.length).toBeGreaterThan(5);
    expect(toc.issues).toMatchObject({ error: expect.any(Number), warning: expect.any(Number) });
    const t = await call("designer__get_design_document", { chapter: "screens" });
    expect(t).toContain("画面一覧");
    expect(t).not.toContain("<"); // タグは文章に直る
    expect(t).toContain(" | "); // 表は ` | ` 区切りの行
    const html = await call("designer__get_design_document", { chapter: "screens", format: "html" });
    expect(html.startsWith("<section")).toBe(true);
    expect(html.endsWith("</section>")).toBe(true);
    expect(html).not.toContain('id="transitions"'); // 次の章を含まない
  });

  it("ない章・HTML に使えない文字の id は断る", async () => {
    await expect(call("designer__get_design_document", { chapter: "nope" })).rejects.toThrow(/目次/);
    await expect(call("designer__get_design_document", { chapter: '"><script>' })).rejects.toThrow();
  });
});
