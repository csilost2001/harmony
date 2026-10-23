/**
 * AI の使い勝手の計測と補助 (#1549): 机上の実行・指摘の直し方・読み取り専用の入口・呼び出しのログと集計・詰まった点の記録。
 * 実際の MCP プロトコル (メモリ上の transport) で、retail の複製に対して呼ぶ。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { tools } from "./tools.js";
import { isReadOnlyTool } from "./security/mcpAccess.js";
import { isInProfile } from "./security/mcpProfiles.js";
import { initServerLog } from "./serverLog.js";
import { connect as wsConnect, disconnect as wsDisconnect, setActivePath } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = `ai-aids-${process.pid}`;
const WS = path.join(os.tmpdir(), `ai-aids-ws-${process.pid}-${Date.now()}`);
const LOGROOT = path.join(os.tmpdir(), `ai-aids-log-${process.pid}-${Date.now()}`);

async function open(opts: { profiles?: string[]; forceReadonly?: boolean } = {}) {
  const server = createMcpServer(SESSION, opts.profiles ?? [], "full", { forceReadonly: opts.forceReadonly });
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
let c: Client; let closeC: () => Promise<void>;
const call = async (name: string, args: Record<string, unknown> = {}, client = c) => {
  const r = await client.callTool({ name, arguments: args });
  const t = (r.content as Array<{ text: string }>)[0].text;
  if (r.isError) throw new Error(t);
  return t;
};
const J = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));

beforeAll(async () => {
  await fs.mkdir(WS, { recursive: true });
  await fs.copyFile(path.join(REPO, "examples/retail/harmony.json"), path.join(WS, "harmony.json"));
  await fs.cp(path.join(REPO, "examples/retail/harmony"), path.join(WS, "harmony"), { recursive: true });
  await fs.mkdir(LOGROOT, { recursive: true });
  initServerLog(LOGROOT); // 呼び出しのログを読むため、一時フォルダへ
  wsConnect(SESSION); setActivePath(SESSION, WS);
  const o = await open(); c = o.client; closeC = o.close;
});
afterAll(async () => { await closeC(); wsDisconnect(SESSION); await fs.rm(WS, { recursive: true, force: true }); await fs.rm(LOGROOT, { recursive: true, force: true }); });

describe("机上の実行 (walk_flow)", () => {
  it("選ぶ道がなければ、最初の分岐で止まり、選べる道を返す", async () => {
    const r = await J("designer__walk_flow", { processFlowId: "cart-add" });
    expect(r.status).toBe("awaiting");
    expect(r.awaiting.kind).toBe("branch");
    expect(r.awaiting.choices.map((x: { n: number }) => x.n)).toEqual([1, 2]);
    expect(r.awaiting.choices[1].id).toBe("else");
    expect(r.log.some((l: { kind: string }) => l.kind === "step")).toBe(true);
    expect(r.notes.join("\n")).toContain("条件は評価しません");
  });

  it("番号・id・ラベルの先頭のどれでも選べ、return の工程で終わる。通った工程数・変数が返る。余った選択肢は知らせる", async () => {
    const byNumber = await J("designer__walk_flow", { processFlowId: "cart-add", choices: [1] });
    expect(byNumber.status).toBe("ended");
    expect(byNumber.log.some((l: { text: string }) => /404/.test(l.text))).toBe(true); // 道 A は 404 を返す
    expect(byNumber.log.map((l: { kind: string }) => l.kind)).toContain("choice");
    const allElse = await J("designer__walk_flow", { processFlowId: "cart-add", choices: Array(30).fill("else") });
    expect(allElse.status).toBe("ended");
    expect(allElse.endReason).toContain("return");
    expect(allElse.steps).toBeGreaterThan(8);
    expect(allElse.defined.length).toBeGreaterThan(0);
    expect(allElse.unusedChoices).toBeGreaterThan(0);
    const byLabel = await J("designer__walk_flow", { processFlowId: "cart-add", choices: ["A"] });
    expect(byLabel.log.some((l: { text: string }) => /404/.test(l.text))).toBe(true);
  });

  it("選べない値・アクションが複数で未指定・不正な choices は断る", async () => {
    await expect(call("designer__walk_flow", { processFlowId: "cart-add", choices: ["zzz"] })).rejects.toThrow(/選べる.*1=b0/);
    await expect(call("designer__walk_flow", { processFlowId: "cart-add", choices: "x" })).rejects.toThrow(/choices/);
    await expect(call("designer__walk_flow", { processFlowId: "cart-add", actionId: "nope" })).rejects.toThrow(/アクション/);
    await fs.writeFile(path.join(WS, "harmony/process-flows/two-actions.json"), JSON.stringify({ meta: { id: "two-actions", name: "2 つ" }, actions: [{ id: "a1", steps: [] }, { id: "a2", steps: [] }] }));
    await expect(call("designer__walk_flow", { processFlowId: "two-actions" })).rejects.toThrow(/actionId を指定/);
    await fs.rm(path.join(WS, "harmony/process-flows/two-actions.json"));
  });

  it("繰り返し: 入る / 繰り返さない / もう 1 回 / 終える", async () => {
    await fs.writeFile(path.join(WS, "harmony/process-flows/loopy.json"), JSON.stringify({ meta: { id: "loopy", name: "繰り返し" }, actions: [{ id: "a1", steps: [
      { id: "l", kind: "loop", description: "明細", loopKind: "collection", collectionSource: "@items", collectionItemName: "item", steps: [{ id: "c", kind: "compute", description: "x", expression: "1" }] },
      { id: "r", kind: "return", description: "終わり" },
    ] }] }));
    const r = await J("designer__walk_flow", { processFlowId: "loopy", choices: ["enter", "again", "again", "exit"] });
    expect(r.status).toBe("ended");
    expect(r.log.filter((l: { stepId?: string }) => l.stepId === "c")).toHaveLength(3); // 3 回
    expect(r.defined).toContain("item");
    expect((await J("designer__walk_flow", { processFlowId: "loopy", choices: ["skip"] })).log.filter((l: { stepId?: string }) => l.stepId === "c")).toHaveLength(0);
    expect((await J("designer__walk_flow", { processFlowId: "loopy", choices: ["enter"] })).awaiting.kind).toBe("loopEnd");
    await fs.rm(path.join(WS, "harmony/process-flows/loopy.json"));
  });
});

describe("指摘の直し方 (check_design の hint)", () => {
  it("正しい設計は指摘 0 件。壊すと、指摘に hint (直し方) が付く", async () => {
    expect((await J("designer__check_design")).issues).toEqual([]);
    const f = path.join(WS, "harmony/process-flows/cart-add.json");
    const orig = await fs.readFile(f, "utf8");
    const j = JSON.parse(orig);
    j.actions[0].steps.find((s: any) => s.kind === "dbAccess").tableId = "no-such-table";
    j.meta.screenId = "no-such-screen";
    await fs.writeFile(f, JSON.stringify(j));
    const r = await J("designer__check_design");
    const issues = r.issues as Array<{ message: string; hint?: string }>;
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.every((i) => typeof i.hint === "string" && i.hint.length > 10)).toBe(true);
    expect(issues.find((i) => /テーブル「no-such-table」/.test(i.message))!.hint).toContain("designer__list_tables");
    expect(issues.find((i) => /呼び出す画面/.test(i.message))!.hint).toContain("designer__list_screens");
    await fs.writeFile(f, orig);
  });
});

describe("読み取り専用の入口 (/mcp-readonly)", () => {
  it("環境変数が full でも、読み取りの tool だけが見え、書く tool は断られる。プロファイルでは緩められない", async () => {
    expect(process.env.HARMONY_MCP_MODE).toBeUndefined();
    const o = await open({ forceReadonly: true });
    try {
      const listed = (await o.client.listTools()).tools.map((t) => t.name);
      expect(listed.length).toBeGreaterThan(30);
      expect(listed.every((n) => isReadOnlyTool(n))).toBe(true);
      expect(listed).not.toContain("designer__save_design");
      expect(listed).not.toContain("designer__edit_steps");
      expect(listed).not.toContain("designer__report_confusion");
      await expect(call("designer__save_design", { kind: "sequence", id: "ro-x", design: {} }, o.client)).rejects.toThrow(/読み取り専用/);
      await expect(call("designer__edit_steps", { processFlowId: "cart-add", edits: [{ op: "remove", stepId: "step-01" }], apply: true }, o.client)).rejects.toThrow(/読み取り専用/);
      await expect(call("designer__workspace_open", { path: path.join(os.tmpdir(), "never-created-ro"), init: true }, o.client)).rejects.toThrow();
      // 読む tool と Resource は使える
      expect(await call("designer__get_flow_story", { processFlowId: "cart-add" }, o.client)).toContain("cart-add");
      const ctx = await o.client.readResource({ uri: "harmony://project/context" });
      expect((ctx.contents[0] as { text: string }).text).toContain("counts");
    } finally { await o.close(); }
    const o2 = await open({ forceReadonly: true, profiles: ["flow"] }); // プロファイルを足しても、書く tool は出ない
    try { expect((await o2.client.listTools()).tools.every((t) => isReadOnlyTool(t.name))).toBe(true); } finally { await o2.close(); }
    // 通常の入口は、書ける
    expect((await c.listTools()).tools.some((t) => t.name === "designer__save_design")).toBe(true);
  });
});

describe("呼び出しのログと集計 (mcp:report)", () => {
  it("成功と失敗が 1 行ずつ残り、引数・結果は残らない。集計が、失敗の多い tool と多い失敗を出す", async () => {
    await call("designer__list_process_flows");
    await expect(call("designer__get_process_flow", { processFlowId: "Bad_ID" })).rejects.toThrow();
    await expect(call("designer__get_process_flow", { processFlowId: "no-such-flow-1" })).rejects.toThrow();
    const logs = path.join(LOGROOT, "logs");
    const text = (await Promise.all((await fs.readdir(logs)).filter((n) => /^harmony-mcp-.*\.log$/.test(n)).map((n) => fs.readFile(path.join(logs, n), "utf8")))).join("\n");
    const lines = text.split("\n").filter((l) => l.includes('"category":"mcp"'));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    const entries = lines.map((l) => JSON.parse(l));
    const ok = entries.find((e) => e.ctx.tool === "designer__list_process_flows");
    expect(ok.ctx).toMatchObject({ ok: true, ms: expect.any(Number) });
    const ng = entries.filter((e) => e.ctx.tool === "designer__get_process_flow");
    expect(ng.length).toBeGreaterThanOrEqual(2);
    expect(ng[0].ctx.ok).toBe(false);
    expect(ng[0].ctx.error).not.toMatch(/^MCP error/);
    expect(text).not.toContain("Bad_ID"); // 引数の値は残さない … ただし、失敗の文に id が入ることはある
  });

  it("集計: 回数・失敗率・p50/p95・多い失敗 (数字と引用を正規化)・失敗の多い tool", async () => {
    const { summarize } = await import(pathToFileURL(path.join(REPO, "scripts/dev/mcp-usage-report.mjs")).href);
    const line = (tool: string, ok: boolean, ms: number, error?: string, ts = new Date().toISOString()) => JSON.stringify({ ts, level: "info", category: "mcp", msg: "tool", ctx: { tool, ok, ms, ...(error ? { error } : {}) } });
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => line("designer__edit_steps", i < 2, 10 + i, i < 2 ? undefined : `edits[${i}]: step-0${i} が見つかりません`)),
      line("designer__list_screens", true, 5), line("designer__list_screens", true, 7),
      line("designer__list_screens", true, 1, undefined, "2000-01-01T00:00:00Z"), // 期間の外
      "これは JSON ではない", JSON.stringify({ category: "other", msg: "x" }),
    ];
    const r = summarize(lines, { sinceMs: Date.parse("2020-01-01") });
    expect(r.total).toBe(8);
    const es = r.rows.find((x: { tool: string }) => x.tool === "edit_steps");
    expect(es).toMatchObject({ calls: 6, failures: 4, failureRate: 66.7 });
    expect(es.topErrors[0]).toMatchObject({ count: 4 });
    expect(es.topErrors[0].message).toContain("#");
    expect(r.suspects).toEqual(["edit_steps"]);
    expect(r.rows[0].tool).toBe("edit_steps"); // 失敗が多い順
    expect(r.rows.find((x: { tool: string }) => x.tool === "list_screens").calls).toBe(2);
    const cli = spawnSync("node", [path.join(REPO, "scripts/dev/mcp-usage-report.mjs"), "--log-dir", path.join(LOGROOT, "logs")], { encoding: "utf8" });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain("MCP の呼び出し");
    expect(spawnSync("node", [path.join(REPO, "scripts/dev/mcp-usage-report.mjs"), "--log-dir", "/nonexistent"], { encoding: "utf8" }).status).toBe(2);
  });
});

describe("詰まった点の記録 (report_confusion)", () => {
  it("記録でき、ワークスペースの .harmony-ops に残り (git に載せない)、件数が増える。集計の CLI が出す", async () => {
    const r1 = await J("designer__report_confusion", { topic: "edit_steps の add の detail の書き方が分からない", tool: "edit_steps", doc: "harmony://docs/recipes", expected: "例が欲しい" });
    expect(r1).toMatchObject({ recorded: true, total: 1 });
    const r2 = await J("designer__report_confusion", { topic: "プロファイルの選び方", detail: "どれを選ぶか迷った" });
    expect(r2.total).toBe(2);
    const dir = path.join(WS, ".harmony-ops");
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toContain("*");
    const saved = JSON.parse(await fs.readFile(path.join(dir, "ai-feedback.json"), "utf8"));
    expect(saved.entries.map((e: { topic: string }) => e.topic)).toEqual(["edit_steps の add の detail の書き方が分からない", "プロファイルの選び方"]);
    const cli = spawnSync("npx", ["tsx", path.join(REPO, "scripts/dev/ai-feedback.mts"), WS], { cwd: REPO, encoding: "utf8", timeout: 120_000 });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain("AI が詰まった点 2 件");
    expect(cli.stdout).toContain("edit_steps");
    expect(JSON.parse(spawnSync("npx", ["tsx", path.join(REPO, "scripts/dev/ai-feedback.mts"), WS, "--json"], { cwd: REPO, encoding: "utf8", timeout: 120_000 }).stdout).total).toBe(2);
  }, 120_000);

  it("topic は必須・文字数の上限・文字列だけ。読み取りの接続・プロファイル read には出ない", async () => {
    await expect(call("designer__report_confusion", {})).rejects.toThrow(/topic は必須/);
    await expect(call("designer__report_confusion", { topic: "x".repeat(201) })).rejects.toThrow(/200 文字まで/);
    await expect(call("designer__report_confusion", { topic: "x", detail: 5 })).rejects.toThrow(/文字列/);
    expect(isInProfile("designer__report_confusion", ["read"])).toBe(false);
    expect(isInProfile("designer__report_confusion", ["flow"])).toBe(true);
    expect(isReadOnlyTool("designer__report_confusion")).toBe(false);
    expect(tools.some((t) => t.name === "designer__report_confusion")).toBe(true);
  });

  it("上限 (500 件) を超えたら古いものから捨てる。読めない記録があるときは捨てて書く", async () => {
    const f = path.join(WS, ".harmony-ops/ai-feedback.json");
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `cf-${i}`, at: "2026-01-01T00:00:00.000Z", topic: `t${i}` }));
    await fs.writeFile(f, JSON.stringify({ entries: many }));
    const r = await J("designer__report_confusion", { topic: "501 件目" });
    expect(r.total).toBe(500);
    const saved = JSON.parse(await fs.readFile(f, "utf8"));
    expect(saved.entries[0].topic).toBe("t1");
    expect(saved.entries[499].topic).toBe("501 件目");
    await fs.writeFile(f, JSON.stringify({ entries: [{ id: "x" }, { id: "cf-ok", at: "2026-01-01T00:00:00.000Z", topic: "読める" }] }));
    expect((await J("designer__report_confusion", { topic: "続き" })).total).toBe(2); // 読めない 1 件を捨てた
  });
});
