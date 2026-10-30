/**
 * AI の入口 (#1539): 実際の MCP プロトコル (initialize / tools / resources / prompts) で、案内・資料・手順・プロファイルを確かめる。
 * サーバは createMcpServer を、メモリ上の transport でつなぐ (HTTP の起動はしない)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { tools } from "./tools.js";
import { isReadOnlyTool } from "./security/mcpAccess.js";
import { PROFILE_NAMES, PROFILES, isInProfile, parseProfiles, profileRefusal, profilesFromRequest } from "./security/mcpProfiles.js";
import { PROMPT_SKILLS, findDocsRoot, getPrompt, listPrompts, listResources, readResource, schemaDefClosure, splitSections } from "./mcpKnowledge.js";
import { NEXT_STEPS, buildProjectContext } from "./projectContext.js";
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
    expect(profilesFromRequest("/mcp?profile=", { HARMONY_MCP_PROFILE: "flow" }).names).toEqual(["flow"]); // 空は未指定
  });

  it("すべての tool が、どれかのプロファイルに入る (絞った接続で、案内の手順が行き止まりにならない)", () => {
    const orphans = tools.map((t) => t.name).filter((n) => !Object.keys(PROFILES).some((p) => isInProfile(n, [p])));
    expect(orphans).toEqual([]);
  });

  it("read / review だけの接続は、ワークスペースの新規作成 (init: true) を断る。ほかの接続・ほかの呼び出しは断らない", () => {
    expect(profileRefusal("designer__workspace_open", { path: "/x", init: true }, ["read"])).toMatch(/新規作成/);
    expect(profileRefusal("designer__workspace_open", { path: "/x", init: true }, ["review", "read"])).toMatch(/新規作成/);
    expect(profileRefusal("designer__workspace_open", { path: "/x" }, ["read"])).toBeNull();
    expect(profileRefusal("designer__workspace_open", { path: "/x", init: true }, ["flow"])).toBeNull();
    expect(profileRefusal("designer__workspace_open", { path: "/x", init: true }, ["read", "flow"])).toBeNull();
    expect(profileRefusal("designer__workspace_open", { path: "/x", init: true }, [])).toBeNull();
  });

  it("read の接続で workspace_open の init: true を呼ぶと、プロトコル上も断られる", async () => {
    const { client, close } = await open(["read"]);
    try {
      await expect(client.callTool({ name: "designer__workspace_open", arguments: { path: path.join(os.tmpdir(), "never-created"), init: true } })).rejects.toThrow(/新規作成/);
    } finally { await close(); }
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
      expect(flowNames.length).toBeLessThan(fullNames.length * 0.6);
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

  it("資料の許可リスト: 用語集・コードの地図・レシピ・パターン・設計判断・スキーマの索引が読める", async () => {
    const uris = listResources().map((r) => r.uri);
    for (const u of ["harmony://docs/glossary", "harmony://docs/codemap", "harmony://docs/recipes", "harmony://docs/patterns", "harmony://docs/decisions", "harmony://spec/schema-index", "harmony://decisions/0001-branch-first-match"]) expect(uris, u).toContain(u);
    expect(uris).not.toContain("harmony://decisions/README");
    const { client, close } = await open();
    try {
      const text = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      const glossary = JSON.parse(await text("harmony://docs/glossary"));
      expect(glossary.terms.map((t: { term: string }) => t.term)).toEqual(expect.arrayContaining(["処理フロー", "分岐", "判定表", "入力チェック", "DBアクセス"]));
      const idx = JSON.parse(await text("harmony://spec/schema-index"));
      expect(idx.schemas.find((s: { kind: string }) => s.kind === "process-flow").defs.map((d: { name: string }) => d.name)).toContain("BranchStep");
      expect(await text("harmony://decisions/0001-branch-first-match")).toContain("最初に成り立った道");
      expect(await text("harmony://docs/patterns")).toContain("サンプルが示す工程のパターン");
    } finally { await close(); }
  });

  it("大きな仕様書は章ごとに読める: 一覧 → n 番目の章。範囲外・spec 以外・パスをたどる指定は断る", async () => {
    const { client, close } = await open();
    try {
      const text = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      const outline = JSON.parse(await text("harmony://spec/process-flow-runtime-conventions/sections"));
      expect(outline.sections.length).toBeGreaterThan(5);
      expect(outline.sections[0]).toMatchObject({ n: 0, title: "(前書き)" });
      const sec = outline.sections.find((x: { title: string }) => /分岐/.test(x.title)) ?? outline.sections[2];
      const body = await text(`harmony://spec/process-flow-runtime-conventions/${sec.n}`);
      expect(body.startsWith("## ")).toBe(true);
      expect(body.length).toBe(sec.chars);
      // 章の合計は、元の文書より大きく欠けない
      const whole = await text("harmony://spec/process-flow-runtime-conventions");
      const sum = outline.sections.reduce((a: number, x: { chars: number }) => a + x.chars, 0);
      expect(sum).toBeGreaterThan(whole.length * 0.9);
      await expect(client.readResource({ uri: "harmony://spec/process-flow-runtime-conventions/9999" })).rejects.toThrow(/章 9999 がありません/);
      await expect(client.readResource({ uri: "harmony://spec/process-flow-runtime-conventions/.." })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://schema/table/sections" })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://docs/glossary/1" })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://spec/index/sections" })).rejects.toThrow();
    } finally { await close(); }
  });

  it("スキーマの定義 1 つと、参照する定義だけを読める (処理フローのスキーマ 92KB の部分読み)", async () => {
    const { client, close } = await open();
    try {
      const text = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
      const whole = await text("harmony://schema/process-flow");
      const part = JSON.parse(await text("harmony://schema/process-flow/BranchStep"));
      expect(part).toMatchObject({ kind: "process-flow", def: "BranchStep" });
      expect(JSON.stringify(part.definition)).toContain("branches");
      expect(Object.keys(part.dependencies)).toEqual(expect.arrayContaining(["StepBaseProps", "Branch"]));
      // 外部の参照は <種類>#<定義名>
      expect(Object.keys(part.dependencies).some((k) => k.startsWith("common#"))).toBe(true);
      expect(JSON.stringify(part).length).toBeLessThan(whole.length / 4);
      expect(JSON.stringify(part.dependencies.Step)).toContain("26 種類の oneOf"); // 工程の union の中身までは辿らない
      // 入れ子の Step の oneOf まで辿るので、Step 全体を引くと大きい (それでも全体以下)
      expect(Object.keys(JSON.parse(await text("harmony://schema/process-flow/Step")).dependencies).length).toBeGreaterThan(40);
      await expect(client.readResource({ uri: "harmony://schema/process-flow/NoSuchDef" })).rejects.toThrow(/スキーマにありません/);
      await expect(client.readResource({ uri: "harmony://schema/process-flow/__proto__" })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://schema/process-flow/..%2Fx" })).rejects.toThrow();
      await expect(client.readResource({ uri: "harmony://schema/index/Foo" })).rejects.toThrow();
    } finally { await close(); }
    expect(schemaDefClosure(path.join(REPO, "schemas/v3"), "nope", "X")).toBeNull();
    expect(schemaDefClosure(path.join(REPO, "schemas/v3"), "table", "constructor")).toBeNull();
  });

  it("splitSections: コードブロックの中の ## は見出しにしない。frontmatter は除く", () => {
    const md = "---\ndescription: x\n---\n\n# 表題\n\n前書き\n\n## 一\n本文\n```\n## これは見出しではない\n```\n\n## 二\n本文 2\n";
    const sec = splitSections(md);
    expect(sec.map((x) => x.title)).toEqual(["(前書き)", "一", "二"]);
    expect(sec[1].text).toContain("## これは見出しではない");
    expect(sec[0].text).toContain("# 表題");
    expect(splitSections("## だけ\nx").map((x) => x.n)).toEqual([1]);
    expect(splitSections("---\ndescription: x\n---abc\n\n## 一\n").map((x) => x.title)).toContain("一"); // ---abc は frontmatter の閉じではない
    expect(splitSections("")).toEqual([]);
  });

  it("パスをたどる名前・未知の名前・形の違う URI は断る (許可リストにある名前だけ読める)", async () => {
    for (const uri of ["harmony://spec/..%2F..%2Fpackage", "harmony://spec/../../package.json", "harmony://spec/nope", "harmony://schema/..%2Fx", "harmony://docs/other", "file:///etc/passwd", "harmony://spec/index.json"]) {
      await expect(readResource(uri, null), uri).rejects.toThrow();
    }
  });

  it("project/context は tool と同じ権限で守る: HARMONY_MCP_DENY に tool を入れると、resource でも読めない", async () => {
    const { client, close } = await open();
    const prev = process.env.HARMONY_MCP_DENY;
    process.env.HARMONY_MCP_DENY = "get_project_context";
    try {
      await expect(client.readResource({ uri: "harmony://project/context" })).rejects.toThrow(/HARMONY_MCP_DENY/);
    } finally {
      if (prev === undefined) delete process.env.HARMONY_MCP_DENY; else process.env.HARMONY_MCP_DENY = prev;
      await close();
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

describe("get_project_context: 壊れた設計があっても落ちない (draft-state)", () => {
  it("meta のない処理フロー・配列でない actions・工程が数でない処理フロー・本文のないマーカーがあっても、要約を返す", async () => {
    const root = path.join(os.tmpdir(), `ctx-broken-${process.pid}-${Date.now()}`);
    await fs.mkdir(path.join(root, "harmony", "process-flows"), { recursive: true });
    await fs.writeFile(path.join(root, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-0000000000aa", name: "壊れた設計", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, entities: { processFlows: ["f1", "f2", "f3", "f4"].map((id) => ({ id, name: id })) } }));
    const put = (n: string, v: unknown) => fs.writeFile(path.join(root, "harmony", "process-flows", `${n}.json`), typeof v === "string" ? v : JSON.stringify(v));
    await put("a", { id: "f1", name: "meta なし" });
    await put("b", { meta: { id: "f2", name: "actions が配列でない" }, actions: { x: 1 } });
    await put("c", { meta: { id: "f3", name: "steps が数" }, actions: [{ id: "a1", steps: 5 }] });
    await put("d", { meta: { id: "f4", name: "正常" }, actions: [{ id: "a1", steps: [{ id: "s1", kind: "validation" }] }] });
    await put("e", "{ これは JSON ではない");
    try {
      const ctx = await buildProjectContext(root) as { designs: { flows: { total: number; items: Array<{ id: string; steps: number }> } }; unreadable?: string[] };
      const ids = ctx.designs.flows.items.map((f) => f.id);
      expect(ids).toEqual(expect.arrayContaining(["f2", "f3", "f4"])); // actions が配列でない・steps が数でも、数えられないだけで落ちない
      expect(ctx.designs.flows.items.find((f) => f.id === "f2")?.steps).toBe(0);
      expect(ctx.designs.flows.items.find((f) => f.id === "f4")?.steps).toBe(1);
      expect(ctx.unreadable?.length ?? 0).toBeGreaterThan(0); // 読めなかったものは、黙って消さず知らせる
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
  });

  it("limit が数でないときは既定 (NaN にならない)", async () => {
    const ctx = await buildProjectContext(path.join(REPO, "examples/retail"), { limit: Number.NaN }) as { designs: { flows: { shown: number; total: number } } };
    expect(ctx.designs.flows.shown).toBe(Math.min(ctx.designs.flows.total, 60));
  });
});

describe("ワークスペース未選択でも使える workspace の tool", () => {
  const FRESH = `mcp-entry-test-unset-${process.pid}`;
  let tmp: string;
  let prevRecent: string | undefined;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "harmony-mcp-unset-"));
    prevRecent = process.env.DESIGNER_RECENT_FILE; // 最近使った一覧を、本物の HOME に書かない
    process.env.DESIGNER_RECENT_FILE = path.join(tmp, "recent-workspaces.json");
    wsConnect(FRESH);
  });
  afterAll(async () => {
    wsDisconnect(FRESH);
    if (prevRecent === undefined) delete process.env.DESIGNER_RECENT_FILE; else process.env.DESIGNER_RECENT_FILE = prevRecent;
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function openFresh() {
    const server = createMcpServer(FRESH, []);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return { client, close: async () => { await client.close(); await server.close(); } };
  }
  const textOf = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

  it("未選択でも workspace_status / workspace_list は断られず、init: true で開ける。開いたあとはワークスペースが必要な tool も使える", async () => {
    const { client, close } = await openFresh();
    try {
      // ワークスペースが必要な tool は、従来どおり断られる
      await expect(client.callTool({ name: "designer__list_tables", arguments: {} })).rejects.toThrow(/ワークスペースが選択されていません/);

      const status = JSON.parse(textOf(await client.callTool({ name: "designer__workspace_status", arguments: {} })));
      expect(status.active).toBeNull();
      const list = JSON.parse(textOf(await client.callTool({ name: "designer__workspace_list", arguments: {} })));
      expect(list.active).toBeNull();
      expect(Array.isArray(list.workspaces)).toBe(true);

      const dir = path.join(tmp, "proj");
      const opened = await client.callTool({ name: "designer__workspace_open", arguments: { path: dir, init: true } });
      expect(textOf(opened)).toContain("を開きました");
      await expect(fs.stat(path.join(dir, "harmony.json"))).resolves.toBeTruthy();

      const after = JSON.parse(textOf(await client.callTool({ name: "designer__workspace_status", arguments: {} })));
      expect(after.active?.path).toBeTruthy();
      const tablesRes = await client.callTool({ name: "designer__list_tables", arguments: {} });
      expect((tablesRes as { isError?: boolean }).isError).not.toBe(true);

      await client.callTool({ name: "designer__workspace_close", arguments: {} });
      await expect(client.callTool({ name: "designer__list_tables", arguments: {} })).rejects.toThrow(/ワークスペースが選択されていません/);
    } finally { await close(); }
  });
});
