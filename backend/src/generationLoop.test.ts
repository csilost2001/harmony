/**
 * 生成と検証のループ (#1547): 生成の指示書・テスト観点のカバレッジ・変更に絞ったテスト観点・ずれ検査の CLI。
 * 実際の MCP プロトコル (メモリ上の transport) で、retail の複製に対して呼ぶ。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcpServer.js";
import { connect as wsConnect, disconnect as wsDisconnect, setActivePath } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SESSION = `gen-loop-${process.pid}`;
const WS = path.join(os.tmpdir(), `gen-loop-ws-${process.pid}-${Date.now()}`);
let client: Client; let closeAll: () => Promise<void>;
const call = async (name: string, args: Record<string, unknown> = {}) => {
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
  wsConnect(SESSION); setActivePath(SESSION, WS);
  const server = createMcpServer(SESSION);
  client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closeAll = async () => { await client.close(); await server.close(); };
});
afterAll(async () => { await closeAll(); wsDisconnect(SESSION); await fs.rm(WS, { recursive: true, force: true }); });

describe("生成の指示書 (get_generation_brief)", () => {
  it("処理フロー: 何を作るか・技術スタック・流れ・使うテーブル・規約の参照(値つき)・画面の項目・テスト観点・記録の呼び方", async () => {
    const t = await call("designer__get_generation_brief", { processFlowId: "cart-add" });
    expect(t).toMatch(/^# 生成の指示書: カート追加 \(処理フロー `cart-add`\)/);
    for (const h of ["## 何を作るか", "## 技術スタック", "## 処理の流れ", "## 使うテーブル", "## 規約の参照 (@conv.*)", "## 呼び出す画面: ", "## テスト観点", "## 生成したら"]) expect(t, h).toContain(h);
    expect(t).toMatch(/- アクション `act-001`[^\n]*POST/);
    expect(t).toContain("### 店舗マスタ"); // 使うテーブルの定義
    expect(t).toMatch(/`store_code`[^\n]*(VARCHAR|CHAR)/);
    expect(t).toMatch(/`@conv\.limit\.cartItemMaxQuantity` = /); // 規約の値まで解く
    expect(t).toContain("`cart-add.act-001.TV-"); // テスト観点の ID
    expect(t).toContain('{ "kind": "processFlow", "id": "cart-add" }'); // 記録の呼び方
    expect(t).not.toContain("@inputs."); // 流れは言葉
  });

  it("画面: 項目の制約・呼ぶ処理フロー・テスト観点", async () => {
    const t = await call("designer__get_generation_brief", { screenId: "cart" });
    expect(t).toMatch(/^# 生成の指示書: カート \(画面 `cart`\)/);
    expect(t).toContain("## 画面項目");
    expect(t).toMatch(/`addProductCode`[^\n]*必須/);
    expect(t).toContain('designer__get_generation_brief { processFlowId: "cart-add" }');
    expect(t).toContain("`cart.addProductCode.");
    expect(t).toContain('{ "kind": "screen", "id": "cart" }');
  });

  it("ドメインの単位・丸めと、工程の結果の形があれば、「単位・丸め・結果の形」の節に出す。なければ節ごと出さない", async () => {
    expect(await call("designer__get_generation_brief", { processFlowId: "cart-add" })).not.toContain("## 単位・丸め・結果の形");
    const f = path.join(WS, "harmony/process-flows/unit-brief.json");
    await fs.writeFile(f, JSON.stringify({
      meta: { id: "unit-brief", name: "金額", flowType: "common" },
      context: { catalogs: { domains: { Price: { type: "number", unit: "JPY", rounding: "half-up" }, Plain: { type: "string" } } } },
      actions: [{ id: "a1", steps: [{ id: "s1", kind: "dbAccess", tableId: "store-master", operation: "SELECT", outputBinding: { name: "stores", shape: "list" } }] }],
    }));
    const t = await call("designer__get_generation_brief", { processFlowId: "unit-brief" });
    expect(t).toContain("## 単位・丸め・結果の形");
    expect(t).toContain("- ドメイン `Price`: 単位 JPY / 丸め half-up");
    expect(t).not.toContain("`Plain`");
    expect(t).toContain("- 変数 `stores` (工程 `s1`): 一覧 (0 件以上)");
  });

  it("壊れた設計 (工程が null・文字列・actions が配列でない) でも落ちず、壊れた部分を飛ばして出す", async () => {
    const f = path.join(WS, "harmony/process-flows/broken-brief.json");
    await fs.writeFile(f, JSON.stringify({ meta: { id: "broken-brief", name: "壊れた", flowType: "common" }, actions: [{ id: "a1", steps: [null, "x", 5, { id: "s1", kind: "dbAccess", tableId: "store-master", operation: "SELECT" }] }, "not-an-action"] }));
    const t = await call("designer__get_generation_brief", { processFlowId: "broken-brief" });
    expect(t).toContain("# 生成の指示書: 壊れた");
    expect(t).toContain("### 店舗マスタ"); // 読める工程のテーブルは出る
    // 設計全体の検査も止まらない。壊れた部分は、スキーマの違反として知らされる
    const chk = await J("designer__check_design");
    expect(chk.issues.some((i: { section: string; message: string }) => i.section.includes("壊れた") && /スキーマ/.test(i.message))).toBe(true);
    await fs.rm(f);
  });

  it("引数がない・ないものは断る", async () => {
    await expect(call("designer__get_generation_brief", {})).rejects.toThrow(/どちらかを指定/);
    await expect(call("designer__get_generation_brief", { processFlowId: "no-such-flow" })).rejects.toThrow(/見つかりません/);
    await expect(call("designer__get_generation_brief", { screenId: "no-such-screen" })).rejects.toThrow(/見つかりません/);
  });
});

describe("テスト観点のカバレッジ (check_test_coverage) とずれ検査", () => {
  it("記録がなければ 0 件で、記録のしかたを案内する", async () => {
    const r = await J("designer__check_test_coverage");
    expect(r.covered).toBe(0);
    expect(r.total).toBeGreaterThan(50);
    expect(r.note).toContain("record_generation");
  });

  it("テストを生成して記録すると、本文に書かれた観点の ID を数える。テストでない生成物は読まない", async () => {
    const sheet = await J("designer__get_test_viewpoints", { flowIds: ["cart-add"] });
    const ids: string[] = sheet.flows[0].cases.map((c: { id: string }) => c.id);
    expect(ids.length).toBeGreaterThan(2);
    await fs.mkdir(path.join(WS, "generated"), { recursive: true });
    await fs.writeFile(path.join(WS, "generated/cart-add.test.ts"), `// ${ids[0]}\nit("${ids[1]}", () => {});\n`);
    await fs.writeFile(path.join(WS, "generated/cart-add.service.ts"), `// ${ids[2]} (テストではないファイルに書いた ID は数えない)\n`);
    await J("designer__record_generation", { outputs: [
      { path: "generated/cart-add.test.ts", sources: [{ kind: "processFlow", id: "cart-add" }] },
      { path: "generated/cart-add.service.ts", sources: [{ kind: "processFlow", id: "cart-add" }] },
    ] });
    const r = await J("designer__check_test_coverage", { flowIds: ["cart-add"] });
    expect(r.total).toBe(ids.length);
    expect(r.covered).toBe(2);
    expect(r.testFiles).toEqual(["generated/cart-add.test.ts"]);
    expect(r.note).toContain("目安");
    expect(r.uncovered.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([ids[2]]));
    expect(r.uncovered.map((u: { id: string }) => u.id)).not.toContain(ids[0]);
    expect(r.percent).toBeCloseTo((2 / ids.length) * 100, 0);
    expect(r.byTarget[0]).toMatchObject({ total: ids.length, covered: 2 });
  });

  it("ID の部分一致では数えない: TV-1 を書いても TV-10 は覆わない / 別の処理の同じ接尾辞は覆わない", async () => {
    const sheet = await J("designer__get_test_viewpoints", { flowIds: ["cart-add"] });
    const ids: string[] = sheet.flows[0].cases.map((c: { id: string }) => c.id);
    await fs.writeFile(path.join(WS, "generated/cart-add.test.ts"), `// pre-${ids[0]}\n// ${ids[1]}.\n// ${ids[2]}x\nit("${ids[3]}")\n`);
    await J("designer__record_generation", { outputs: [{ path: "generated/cart-add.test.ts", sources: [{ kind: "processFlow", id: "cart-add" }] }] });
    const r = await J("designer__check_test_coverage", { flowIds: ["cart-add"] });
    const uncovered = r.uncovered.map((u: { id: string }) => u.id);
    expect(uncovered).toContain(ids[0]); // 前に文字が付いたものは別の語
    expect(uncovered).not.toContain(ids[1]); // 文末の . は語に含めない
    expect(uncovered).toContain(ids[2]); // あとに文字が続くものは別の語
    expect(uncovered).not.toContain(ids[3]);
    expect(r.covered).toBe(2);
  });

  it("記録した生成物が消えると unreadableFiles に出る", async () => {
    await fs.rm(path.join(WS, "generated/cart-add.test.ts"));
    const r = await J("designer__check_test_coverage", { flowIds: ["cart-add"] });
    expect(r.unreadableFiles).toEqual(["generated/cart-add.test.ts"]);
    expect(r.covered).toBe(0);
  });

  it("CLI: ずれがなければ 0、設計を変えると 1。--coverage --min で割合の下限を見る", async () => {
    const run = (...a: string[]) => spawnSync("npx", ["tsx", path.join(REPO, "scripts/dev/check-generation.mts"), WS, ...a], { cwd: REPO, encoding: "utf8", timeout: 120_000 });
    // 生成物が消えたので output-missing → 1
    let r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("生成物がない");
    // 生成物を戻し、記録し直す
    await fs.writeFile(path.join(WS, "generated/cart-add.test.ts"), "// x\n");
    await J("designer__record_generation", { outputs: [{ path: "generated/cart-add.test.ts", sources: [{ kind: "processFlow", id: "cart-add" }] }] });
    r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ずれ 0");
    // 設計を変える → design-changed
    const f = path.join(WS, "harmony/process-flows/cart-add.json");
    const j = JSON.parse(await fs.readFile(f, "utf8")); j.meta.description = `${j.meta.description} (変更)`; await fs.writeFile(f, JSON.stringify(j));
    r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("設計が変わった");
    // coverage の下限
    r = run("--coverage", "--min", "99");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/テスト観点 \d+ 件のうち/);
    expect(run("--json").stdout).toContain('"generation"');
    expect(spawnSync("npx", ["tsx", path.join(REPO, "scripts/dev/check-generation.mts"), "/nonexistent"], { cwd: REPO, encoding: "utf8" }).status).toBe(2);
    expect(run("--min", "50").status).toBe(2); // --min は --coverage と一緒に
    expect(run("--no-such-flag").status).toBe(2);
  }, 240_000);
});

describe("変更に絞ったテスト観点 (get_test_viewpoints の since)", () => {
  it("過去の時刻なら全部、未来の時刻なら 0 件、1 つだけ変えたらその処理フローだけ", async () => {
    const all = await J("designer__get_test_viewpoints");
    expect(all.total).toBeGreaterThan(50);
    expect((await J("designer__get_test_viewpoints", { since: "2000-01-01T00:00:00Z" })).total).toBe(all.total);
    expect((await J("designer__get_test_viewpoints", { since: new Date(Date.now() + 3600_000).toISOString() })).total).toBe(0);
    const mark = new Date(Date.now() + 1500);
    await new Promise((r) => setTimeout(r, 2200));
    const f = path.join(WS, "harmony/process-flows/cart-summary.json");
    await fs.writeFile(f, await fs.readFile(f, "utf8")); // 更新時刻だけ新しくする
    const some = await J("designer__get_test_viewpoints", { since: mark.toISOString() });
    expect(some.flows.map((x: { flowId: string }) => x.flowId)).toEqual(["cart-summary"]);
    expect(some.screens).toEqual([]);
    // 指定との積: 変わっていないものを指定したら 0 件 (全部に広がらない)
    const both = await J("designer__get_test_viewpoints", { since: mark.toISOString(), flowIds: ["cart-add"] });
    expect(both.flows).toEqual([]);
    expect(both.screens).toEqual([]);
    const scr = await J("designer__get_test_viewpoints", { since: mark.toISOString(), screenIds: ["cart"] });
    expect(scr.screens).toEqual([]);
    expect(scr.flows.map((x: { flowId: string }) => x.flowId)).toEqual(["cart-summary"]);
    await expect(call("designer__get_test_viewpoints", { since: "きのう" })).rejects.toThrow(/ISO/);
  });
});
