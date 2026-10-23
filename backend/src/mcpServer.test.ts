/**
 * AI の入口 (#1539): 実際の MCP プロトコル (initialize / tools / resources / prompts) で、案内・資料・手順・プロファイルを確かめる。
 * サーバは createMcpServer を、メモリ上の transport でつなぐ (HTTP の起動はしない)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { tools } from "./tools.js";
import { isReadOnlyTool } from "./security/mcpAccess.js";
import { PROFILE_NAMES, PROFILES, isInProfile, parseProfiles, profilesFromRequest } from "./security/mcpProfiles.js";
import { PROMPT_SKILLS, findDocsRoot, getPrompt, listPrompts, listResources, readResource } from "./mcpKnowledge.js";
import { NEXT_STEPS } from "./projectContext.js";
import { connect as wsConnect, disconnect as wsDisconnect, setActivePath } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = `mcp-entry-test-${process.pid}`;

async function open(profiles: string[] = []) {
  const server = createMcpServer(SESSION, profiles);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const names = (list: Array<{ name: string }>) => list.map((t) => t.name);

beforeAll(() => {
  wsConnect(SESSION);
  setActivePath(SESSION, path.join(REPO, "examples/retail"));
});
afterAll(() => wsDisconnect(SESSION));

describe("接続時の案内 (instructions)", () => {
  it("最初に呼ぶ tool と資料の入口を伝え、resources / prompts を使えると宣言する", async () => {
    const { client, close } = await open();
    try {
      const inst = client.getInstructions() ?? "";
      expect(inst).toContain("designer__get_project_context");
      expect(inst).toContain("harmony://docs/ai-index");
      expect(inst).toContain("designer__check_design");
      const caps = client.getServerCapabilities();
      expect(caps?.resources).toBeDefined();
      expect(caps?.prompts).toBeDefined();
    } finally { await close(); }
  });
});

describe("プロファイル (tool の絞り込み)", () => {
  it("名前の解釈: full は絞らない・複数はカンマ・知らない名前は unknown に分ける・URL が環境変数に優先する", () => {
    expect(parseProfiles("")).toEqual({ names: [], unknown: [] });
    expect(parseProfiles("full")).toEqual({ names: [], unknown: [] });
    expect(parseProfiles("flow, table")).toEqual({ names: ["flow", "table"], unknown: [] });
    expect(parseProfiles("flow,nope")).toEqual({ names: ["flow"], unknown: ["nope"] });
    expect(profilesFromRequest("/mcp?profile=table", { HARMONY_MCP_PROFILE: "flow" }).names).toEqual(["table"]);
    expect(profilesFromRequest("/mcp", { HARMONY_MCP_PROFILE: "flow" }).names).toEqual(["flow"]);
    expect(profilesFromRequest("/mcp", {}).names).toEqual([]);
  });

  it("どのプロファイルも、実在する tool だけを見せ、全部より少なく、土台の tool を含む", () => {
    const all = tools.map((t) => t.name);
    for (const p of Object.keys(PROFILES)) {
      const shown = all.filter((n) => isInProfile(n, [p]));
      expect(shown.length, p).toBeGreaterThan(8);
      expect(shown.length, p).toBeLessThan(all.length);
      for (const base of ["designer__get_project_context", "designer__check_design", "designer__workspace_open", "designer__find_references"]) expect(shown, `${p} に ${base}`).toContain(base);
    }
    // 規則が空振りしていない (どの規則も、いまの tool に 1 つ以上当たる)
    for (const [p, prof] of Object.entries(PROFILES)) for (const re of prof.patterns) expect(all.some((n) => re.test(n.replace(/^designer__/, ""))), `${p}: ${re}`).toBe(true);
  });

  it("read / review は読み取りの tool を含み、read は書き込みの tool を一つも含まない", () => {
    const all = tools.map((t) => t.name);
    const read = all.filter((n) => isInProfile(n, ["read"]));
    expect(read.filter((n) => !isReadOnlyTool(n))).toEqual([]);
    const review = all.filter((n) => isInProfile(n, ["review"]));
    expect(review).toContain("designer__add_review_findings");
    expect(review).not.toContain("designer__remove_table");
  });

  it("tools/list: 全部 → flow で絞られ、処理フローの tool が残りテーブルの書き込みが消える", async () => {
    const full = await open();
    const flow = await open(["flow"]);
    try {
      const fullNames = names((await full.client.listTools()).tools);
      const flowNames = names((await flow.client.listTools()).tools);
      expect(fullNames).toContain("designer__remove_table");
      expect(flowNames).toContain("designer__add_step");
      expect(flowNames).toContain("designer__get_project_context");
      expect(flowNames).not.toContain("designer__remove_table");
      expect(flowNames.length).toBeLessThan(fullNames.length / 2);
    } finally { await full.close(); await flow.close(); }
  });

  it("一覧に出ない tool は、名前を知っていても呼べない", async () => {
    const { client, close } = await open(["flow"]);
    try {
      await expect(client.callTool({ name: "designer__remove_table", arguments: { tableId: "x" } })).rejects.toThrow(/プロファイル/);
    } finally { await close(); }
  });

  it("プロファイル名の一覧と PROFILES が食い違わない", () => {
    expect(PROFILE_NAMES.sort()).toEqual(["full", ...Object.keys(PROFILES)].sort());
  });
});

describe("Resources (資料)", () => {
  it("リポジトリの資料を見つけ、入口・仕様書の索引・各仕様書・各スキーマを一覧に出す", () => {
    expect(findDocsRoot()).toBe(REPO);
    const uris = listResources().map((r) => r.uri);
    for (const u of ["harmony://project/context", "harmony://docs/ai-index", "harmony://spec/index", "harmony://schema/index", "harmony://spec/design-check", "harmony://schema/process-flow", "harmony://schema/table"]) expect(uris, u).toContain(u);
  });

  it("仕様書の説明に、状態と要約が付く", () => {
    const r = listResources().find((x) => x.uri === "harmony://spec/design-check");
    expect(r?.description).toMatch(/^\[current\] /);
  });

  it("resources/read: 入口・索引・仕様書・スキーマを読める", async () => {
    const { client, close } = await open();
    try {
      const text = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      expect(await text("harmony://docs/ai-index")).toContain("# AI 向けの入口");
      expect(JSON.parse(await text("harmony://spec/index")).specs.length).toBeGreaterThan(80);
      expect(await text("harmony://spec/design-check")).toContain("design-check.json");
      expect(JSON.parse(await text("harmony://schema/table")).$schema).toBeTruthy();
      expect(JSON.parse(await text("harmony://schema/index")).schemas.map((s: { kind: string }) => s.kind)).toContain("process-flow");
    } finally { await close(); }
  });

  it("パスをたどる名前・未知の名前・形の違う URI は断る (許可リストにある名前だけ読める)", async () => {
    for (const uri of ["harmony://spec/..%2F..%2Fpackage", "harmony://spec/../../package.json", "harmony://spec/nope", "harmony://schema/..%2Fx", "harmony://docs/other", "file:///etc/passwd", "harmony://spec/index.json"]) {
      await expect(readResource(uri, null), uri).rejects.toThrow();
    }
  });

  it("project/context: ワークスペースが選ばれていなければ、案内つきで断る", async () => {
    await expect(readResource("harmony://project/context", null)).rejects.toThrow(/workspace_open/);
  });
});

describe("Prompts (手順)", () => {
  it("設計の作成・点検用のスキルだけを出す (開発用のスキルは出さない)", () => {
    const list = listPrompts().map((p) => p.name);
    expect(list.sort()).toEqual([...PROMPT_SKILLS].sort());
    for (const dev of ["issues", "issues-cdx", "review-pr", "review-issue", "publish-dev-image", "publish-harmony-image", "release-review"]) expect(list).not.toContain(dev);
  });

  it("prompts/get: 引数が $ARGUMENTS に入り、$& などの特殊な並びも壊さない", async () => {
    const { client, close } = await open();
    try {
      const r = await client.getPrompt({ name: "create-flow", arguments: { arguments: "order-flow 受注 $& $1" } });
      const text = (r.messages[0].content as { text: string }).text;
      expect(text).toContain("order-flow 受注 $& $1");
      expect(text).not.toContain("$ARGUMENTS");
      expect(text).toContain("create-flow");
      await expect(client.getPrompt({ name: "issues" })).rejects.toThrow();
      await expect(client.getPrompt({ name: "../x" })).rejects.toThrow();
    } finally { await close(); }
  });

  it("引数なしでも読める (引数の形を案内する)", () => {
    const p = getPrompt("review-flow", undefined);
    expect((p.messages[0].content as { text: string }).text).toContain("引数の形");
  });
});

describe("designer__get_project_context (設計全体の要約)", () => {
  it("retail の要約: 件数・設計の id と名前・規約・マーカー・次の案内", async () => {
    const { client, close } = await open();
    try {
      const r = await client.callTool({ name: "designer__get_project_context", arguments: { limit: 5 } });
      const ctx = JSON.parse((r.content as Array<{ text: string }>)[0].text);
      expect(ctx.project.name).toContain("リテール");
      expect(ctx.techStack).toBeTruthy();
      expect(ctx.counts.flows).toBeGreaterThan(5);
      expect(ctx.designs.flows.total).toBe(ctx.counts.flows);
      expect(ctx.designs.flows.items.length).toBe(5); // limit
      expect(ctx.designs.flows.shown).toBe(5);
      expect(ctx.designs.flows.items[0]).toMatchObject({ id: expect.any(String), actions: expect.any(Number), steps: expect.any(Number) });
      expect(ctx.designs.tables.items[0].columns).toBeGreaterThan(0);
      expect(typeof ctx.markers.unresolved).toBe("number");
      expect(ctx.next).toEqual([...NEXT_STEPS]);
      // 同じ内容を resource でも読める
      const res = await client.readResource({ uri: "harmony://project/context" });
      expect(JSON.parse((res.contents[0] as { text: string }).text).counts).toEqual(ctx.counts);
    } finally { await close(); }
  });

  it("読み取り専用の環境でも呼べる (読み取りの tool)", () => {
    expect(isReadOnlyTool("designer__get_project_context")).toBe(true);
  });

  it("案内にある tool の名前と資料の名前が、実在する", () => {
    const toolNames = new Set(tools.map((t) => t.name));
    for (const m of NEXT_STEPS.join("\n").matchAll(/designer__[a-z_]+/g)) expect(toolNames.has(m[0]), m[0]).toBe(true);
    for (const m of NEXT_STEPS.join("\n").matchAll(/(?:get|resolve)_[a-z_]+|find_all_markers/g)) {
      if (m[0].startsWith("designer__")) continue;
      expect(toolNames.has(`designer__${m[0]}`) || ["get_screen_layout", "get_table", "get_process_flow"].includes(m[0]), m[0]).toBe(true);
    }
    const uris = new Set(listResources().map((r) => r.uri));
    expect(uris.has("harmony://docs/ai-index")).toBe(true);
    expect(uris.has("harmony://spec/index")).toBe(true);
  });
});
