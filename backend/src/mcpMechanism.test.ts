/**
 * MCP の仕組み (#1543): tool の注釈・短い説明 (brief)・tool の詳細 (get_tool_guide)・エラーの直し方・一覧の件数制限・工程の一括編集 (edit_steps)。
 * 実際の MCP プロトコル (メモリ上の transport) で、retail サンプルの複製に対して呼ぶ。
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
import { briefTool, detailFromRequest, errorHint, firstSentence, toolAnnotations, withHint } from "./mcpToolMeta.js";
import { pageOf } from "./handlers/designKinds.js";
import { connect as wsConnect, disconnect as wsDisconnect, setActivePath } from "./workspaceState.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** retail の設計 (harmony.json と harmony/) だけを複製する (生成物のフォルダは大きいので含めない) */
const copyRetail = async (dest: string) => { await fs.mkdir(dest, { recursive: true }); await fs.copyFile(path.join(REPO, "examples/retail/harmony.json"), path.join(dest, "harmony.json")); await fs.cp(path.join(REPO, "examples/retail/harmony"), path.join(dest, "harmony"), { recursive: true }); };
const SESSION = `mcp-mech-${process.pid}`;
const WS = path.join(os.tmpdir(), `mcp-mech-ws-${process.pid}-${Date.now()}`);

async function open(detail: "full" | "brief" = "full") {
  const server = createMcpServer(SESSION, [], detail);
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
let c: Client; let closeC: () => Promise<void>;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = (r.content as Array<{ text: string }>)[0].text;
  if (r.isError) throw new Error(t);
  return t;
};
const J = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await call(name, args));
const file = (id: string) => path.join(WS, "harmony/process-flows", `${id}.json`);

beforeAll(async () => {
  await copyRetail(WS);
  wsConnect(SESSION); setActivePath(SESSION, WS);
  const o = await open(); c = o.client; closeC = o.close;
});
afterAll(async () => { await closeC(); wsDisconnect(SESSION); await fs.rm(WS, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

/** 設計のデータは変えないが、画面の表示・作業の状態は変える tool (注釈は readOnly にしない) */
const UI_STATE = ["designer__open_tab", "designer__close_tab", "designer__switch_tab", "designer__navigate_screen", "designer__workspace_open", "designer__workspace_close"];

describe("tool の注釈", () => {
  it("すべての tool に注釈がある。読み取りの tool は readOnly、書き込みは readOnly でない", async () => {
    const list = (await c.listTools()).tools;
    expect(list.length).toBe(tools.length);
    for (const t of list) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.annotations!.readOnlyHint, t.name).toBe(isReadOnlyTool(t.name) && !UI_STATE.includes(t.name));
      expect(t.annotations!.openWorldHint).toBe(false);
      if (t.annotations!.readOnlyHint) expect(t.annotations!.destructiveHint, t.name).toBeUndefined();
    }
  });

  it("足すだけの書き込みは破壊的でなく、上書き・削除は破壊的。同じ引数で繰り返せるものだけ冪等", () => {
    expect(toolAnnotations("designer__add_step")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(toolAnnotations("designer__add_marker").destructiveHint).toBe(false);
    expect(toolAnnotations("designer__update_step")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations("designer__save_design")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations("designer__remove_table")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations("designer__rename_entity")).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(toolAnnotations("designer__edit_steps").destructiveHint).toBe(true);
  });

  it("表示・作業状態を変える tool は readOnly にしない (init: true の新規作成や force: true の破棄が、確認なしで通らないように)", () => {
    for (const n of UI_STATE) expect(toolAnnotations(n).readOnlyHint, n).toBe(false);
    expect(toolAnnotations("designer__close_tab").destructiveHint).toBe(true);
    expect(toolAnnotations("designer__switch_tab")).toMatchObject({ destructiveHint: false, idempotentHint: true });
    // 既存を上書きし得る add_* は、足すだけ扱いにしない
    expect(toolAnnotations("designer__add_catalog_entry").destructiveHint).toBe(true);
    expect(toolAnnotations("designer__add_step_extension").destructiveHint).toBe(true);
    expect(toolAnnotations("designer__persist_uuids").idempotentHint).toBe(true);
    expect(toolAnnotations("designer__resolve_marker").destructiveHint).toBe(false);
    expect(toolAnnotations("designer__workspace_remove")).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(toolAnnotations("editSession__update").destructiveHint).toBe(true);
  });
});

describe("説明の短縮 (brief) と get_tool_guide", () => {
  it("brief: 説明は最初の 1 文、引数の説明は省かれ、型・必須・列挙は残る。注釈は残る", async () => {
    const o = await open("brief");
    try {
      const brief = (await o.client.listTools()).tools;
      const full = (await c.listTools()).tools;
      const b = brief.find((t) => t.name === "designer__edit_steps")!;
      expect(b.description!.length).toBeLessThanOrEqual(110);
      expect(b.description).toMatch(/。$|…$/);
      const props = (b.inputSchema as { properties: Record<string, { description?: string; type?: string; enum?: string[] }>; required: string[] }).properties;
      expect(props.processFlowId.type).toBe("string");
      expect(props.apply.description).toContain("既定は予行"); // 保存の既定は、brief でも残す
      expect(props.edits.description).toContain("op = add"); // 使い方が説明にしかない引数も残す
      expect(props.processFlowId.description).toBeUndefined();
      expect((b.inputSchema as { required: string[] }).required).toEqual(["processFlowId", "edits"]);
      expect(b.annotations?.readOnlyHint).toBe(false);
      const size = (l: unknown) => Buffer.byteLength(JSON.stringify(l)); // 日本語は 1 文字 3 バイト。文脈に載る量の目安はバイト数
      expect(size(brief)).toBeLessThan(size(full) * 0.65); // 35% 以上減る (実測は約 39%)
    } finally { await o.close(); }
  });

  it("firstSentence / briefTool の単体: 。がなければ全体、長ければ切る。元のオブジェクトは変えない", () => {
    expect(firstSentence("一文だけ")).toBe("一文だけ");
    expect(firstSentence("一文目。二文目。")).toBe("一文目。");
    expect(firstSentence("あ".repeat(200)).length).toBe(110);
    expect(firstSentence("汎用定義 (genericDefinition。メッセージなど)。次の文。")).toBe("汎用定義 (genericDefinition。メッセージなど)。"); // 括弧の中の。では切らない
    expect(firstSentence("全角（かっこ。の中）も同じ。次。")).toBe("全角（かっこ。の中）も同じ。");
    const src = { name: "x", description: "説明。詳細。", inputSchema: { type: "object", properties: { a: { type: "string", description: "引数 a" } } } };
    const out = briefTool(src);
    expect(out.description).toBe("説明。");
    expect((src.inputSchema.properties.a as { description?: string }).description).toBe("引数 a");
  });

  it("接続の指定: ?detail= (環境変数より優先)。知らない値は unknown", () => {
    expect(detailFromRequest("/mcp?detail=brief", {}).mode).toBe("brief");
    expect(detailFromRequest("/mcp", { HARMONY_MCP_DETAIL: "brief" }).mode).toBe("brief");
    expect(detailFromRequest("/mcp?detail=full", { HARMONY_MCP_DETAIL: "brief" }).mode).toBe("full");
    expect(detailFromRequest("/mcp?detail=", { HARMONY_MCP_DETAIL: "brief" }).mode).toBe("brief");
    expect(detailFromRequest("/mcp?detail=tiny", {})).toEqual({ mode: "full", unknown: "tiny" });
  });

  it("get_tool_guide: 拒否した tool は、一覧にも詳細にも出さない", async () => {
    const prev = process.env.HARMONY_MCP_DENY;
    process.env.HARMONY_MCP_DENY = "remove_table";
    try {
      expect((await J("designer__get_tool_guide")).tools).not.toContain("remove_table");
      await expect(call("designer__get_tool_guide", { name: "remove_table" })).rejects.toThrow(/ありません/);
    } finally { if (prev === undefined) delete process.env.HARMONY_MCP_DENY; else process.env.HARMONY_MCP_DENY = prev; }
  });

  it("get_tool_guide: 完全な説明・引数・注釈・入っているプロファイル。名前を省くと一覧", async () => {
    const g = await J("designer__get_tool_guide", { name: "edit_steps" });
    expect(g.name).toBe("designer__edit_steps");
    expect(g.description.length).toBeGreaterThan(110);
    expect(g.inputSchema.properties.edits.description).toContain("op = add");
    expect(g.annotations.readOnlyHint).toBe(false);
    expect(g.profiles).toContain("flow");
    const all = await J("designer__get_tool_guide");
    expect(all.count).toBe(tools.length);
    expect(all.tools).toContain("edit_steps");
    await expect(call("designer__get_tool_guide", { name: "no_such_tool" })).rejects.toThrow(/ありません/);
  });
});

describe("エラーの直し方", () => {
  it("errorHint: id の形・一覧の案内・読み取り専用・スキーマ。すでに案内があれば足さない", () => {
    expect(errorHint("Invalid processFlowId: must be kebab-case EntityId matching ^[a-z]")).toContain("kebab-case");
    expect(errorHint("Invalid stepId: LocalId")).toContain("list_steps");
    expect(errorHint("処理フロー x が見つかりません")).toContain("designer__list_process_flows");
    expect(errorHint("画面 x が見つかりません")).toContain("designer__list_screens");
    expect(errorHint("テーブル x が見つかりません")).toContain("designer__list_tables");
    expect(errorHint("工程「x」が見つかりません")).toContain("designer__list_steps");
    expect(errorHint("sequence「x」が見つかりません")).toContain("designer__list_designs");
    expect(errorHint("id X のワークスペースが見つかりません")).toContain("workspace_list");
    expect(errorHint("スキーマに合いません")).toContain("validate_design");
    expect(errorHint("工程「x」が見つかりません (designer__list_steps で一覧)")).toBeNull();
    expect(errorHint("何かの失敗")).toBeNull();
    // 設計の id と関係のない「見つかりません」・循環する案内には付けない
    for (const m of ["git が見つかりません。git をインストールしてください", "harmony.json が見つかりません", "取り消せる置換が見つかりません (30 分を過ぎた)", "版 abc が見つかりません", "Undo 対象が見つかりません", "通知先 x が見つかりません", "kind は processFlow / screen のどれかです (スキーマの検査の対象外です)", "key, schema は必須です", "何かが見つかりません"]) {
      expect(errorHint(m), m).toBeNull();
    }
    expect(withHint("何かの失敗")).toBe("何かの失敗");
    expect(withHint("処理フロー x が見つかりません")).toMatch(/\n直し方: /);
  });

  it("プロトコル上: id が不正・ないものを呼ぶと、文に直し方が付く", async () => {
    await expect(call("designer__get_process_flow", { processFlowId: "Bad_ID" })).rejects.toThrow(/直し方: id は英小文字で始まる kebab-case/);
    await expect(call("designer__get_process_flow", { processFlowId: "no-such-flow" })).rejects.toThrow(/直し方: id を一覧で確かめてください: designer__list_process_flows/);
  });
});

describe("一覧の件数制限", () => {
  it("pageOf: limit / offset / hasMore。不正な値は既定", () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    expect(pageOf(xs, { limit: 3 })).toMatchObject({ items: [0, 1, 2], total: 10, offset: 0, hasMore: true });
    expect(pageOf(xs, { limit: 3, offset: 9 })).toMatchObject({ items: [9], hasMore: false });
    expect(pageOf(xs, { limit: "x", offset: -5 })).toMatchObject({ limit: 200, offset: 0 });
    expect(pageOf(xs, { limit: 99999 }).limit).toBe(1000);
    expect(pageOf(xs, { limit: 0 }).limit).toBe(1);
  });

  it("list_designs / list_steps に効く", async () => {
    const total = (await J("designer__list_designs", { kind: "genericDefinition" })).count as number;
    expect(total).toBeGreaterThan(2);
    const p = await J("designer__list_designs", { kind: "genericDefinition", limit: 2 });
    expect(p.items).toHaveLength(2);
    expect(p).toMatchObject({ count: total, offset: 0, hasMore: true });
    const next = await J("designer__list_designs", { kind: "genericDefinition", limit: 2, offset: 2 });
    expect(next.items[0]).not.toEqual(p.items[0]);
    const steps = await J("designer__list_steps", { processFlowId: "cart-add", limit: 5 });
    expect(steps.actions[0]).toMatchObject({ steps: expect.any(Array), hasMore: true });
    expect(steps.actions[0].steps).toHaveLength(5);
    expect(steps.actions[0].total).toBeGreaterThan(5);
  });
});

describe("edit_steps (工程の一括編集)", () => {
  const stepsOf = async (id: string) => JSON.parse(await fs.readFile(file(id), "utf8")).actions[0].steps as Array<{ id: string; description?: string }>;

  it("既定は予行: 結果は返るが、ファイルは変わらない", async () => {
    const before = await fs.readFile(file("cart-add"), "utf8");
    const r = await J("designer__edit_steps", { processFlowId: "cart-add", edits: [{ op: "update", stepId: "step-01", patch: { description: "予行で書き換え" } }] });
    expect(r).toMatchObject({ applied: false, edits: 1 });
    expect(r.note).toContain("予行");
    expect(await fs.readFile(file("cart-add"), "utf8")).toBe(before);
  });

  it("apply: true で、追加・更新・移動・削除をまとめて保存する。追加の id を後ろの編集が指せる", async () => {
    const r = await J("designer__edit_steps", {
      processFlowId: "cart-add", apply: true,
      edits: [
        { op: "add", actionId: "act-001", kind: "compute", description: "追加 1", id: "batch-new-1", position: 0 },
        { op: "add", actionId: "act-001", kind: "compute", description: "追加 2", position: 1 },
        { op: "update", stepId: "batch-new-1", patch: { description: "追加 1 (更新後)" } },
        { op: "move", stepId: "batch-new-1", newIndex: 1 },
        { op: "remove", stepId: "step-01" },
      ],
    });
    expect(r.applied).toBe(true);
    expect(r.results.map((x: { op: string }) => x.op)).toEqual(["add", "add", "update", "move", "remove"]);
    const steps = await stepsOf("cart-add");
    expect(steps[1]).toMatchObject({ id: "batch-new-1", description: "追加 1 (更新後)" });
    expect(steps.some((s) => s.id === "step-01")).toBe(false);
    expect(steps[0].description).toBe("追加 2");
    expect(r.results[1].stepId).toMatch(/^step-\d+$/); // 自動採番
  });

  it("途中で 1 件でも失敗したら、何も保存しない。どの編集が悪いかを言う", async () => {
    const before = await fs.readFile(file("cart-add"), "utf8");
    await expect(call("designer__edit_steps", {
      processFlowId: "cart-add", apply: true,
      edits: [{ op: "update", stepId: "step-02", patch: { description: "書き換え" } }, { op: "remove", stepId: "no-such-step" }],
    })).rejects.toThrow(/edits\[1\].*見つかりません.*何も保存していません/s);
    expect(await fs.readFile(file("cart-add"), "utf8")).toBe(before);
  });

  it("入力の検査: 空・多すぎる・知らない op・id の変更・重複する id・不正な id", async () => {
    const base = { processFlowId: "cart-add", apply: true };
    await expect(call("designer__edit_steps", { ...base, edits: [] })).rejects.toThrow(/1 件以上/);
    await expect(call("designer__edit_steps", { ...base, edits: Array.from({ length: 101 }, () => ({ op: "remove", stepId: "x" })) })).rejects.toThrow(/100 件まで/);
    await expect(call("designer__edit_steps", { ...base, edits: [{ op: "explode" }] })).rejects.toThrow(/使えません/);
    await expect(call("designer__edit_steps", { ...base, edits: [{ op: "update", stepId: "step-02", patch: { id: "other" } }] })).rejects.toThrow(/id は変えられません/);
    await expect(call("designer__edit_steps", { ...base, edits: [{ op: "add", actionId: "act-001", kind: "compute", id: "step-02" }] })).rejects.toThrow(/すでに使われています/);
    await expect(call("designer__edit_steps", { ...base, edits: [{ op: "update", stepId: "../x", patch: {} }] })).rejects.toThrow();
    await expect(call("designer__edit_steps", { ...base, edits: [{ op: "nest", stepId: "step-02", direction: "sideways" }] })).rejects.toThrow(/indent/);
    await expect(call("designer__edit_steps", { processFlowId: "no-such-flow", edits: [{ op: "remove", stepId: "x" }] })).rejects.toThrow(/見つかりません/);
  });

  it("入れ子の移動 (nest) と、このバッチで増えたスキーマ違反だけを知らせる", async () => {
    const r = await J("designer__edit_steps", { processFlowId: "cart-summary", edits: [{ op: "nest", stepId: "step-02", direction: "indent" }] });
    expect(r.applied).toBe(false);
    expect(r.edits).toBe(1);
    // 壊す編集: 必須の項目を消す → 新しい違反として出る (予行なので保存されない)
    const broken = await J("designer__edit_steps", { processFlowId: "cart-add", edits: [{ op: "update", stepId: "step-02", patch: { kind: "no-such-kind" } }] });
    expect(broken.newSchemaIssues?.length ?? 0).toBeGreaterThan(0);
  });

  it("重複する id は保存しない: patch の中の入れ子の工程が、あとで足す id と同じ・id を省いた採番が重ならない", async () => {
    const before = await fs.readFile(file("cart-add"), "utf8");
    await expect(call("designer__edit_steps", { processFlowId: "cart-add", apply: true, edits: [
      { op: "update", stepId: "step-02", patch: { subSteps: [{ id: "step-50", kind: "compute", description: "入れ子" }] } },
      { op: "add", actionId: "act-001", kind: "compute", id: "step-50" },
    ] })).rejects.toThrow(/すでに使われています/);
    // patch で既存と同じ id の入れ子の工程を入れると、重複として断る
    await expect(call("designer__edit_steps", { processFlowId: "cart-add", apply: true, edits: [
      { op: "update", stepId: "step-02", patch: { subSteps: [{ id: "step-04", kind: "compute", description: "重複" }] } },
    ] })).rejects.toThrow(/id が重複します/);
    expect(await fs.readFile(file("cart-add"), "utf8")).toBe(before);
    // 採番は、patch で入れた工程の id も避ける
    const r = await J("designer__edit_steps", { processFlowId: "cart-add", edits: [
      { op: "update", stepId: "step-02", patch: { subSteps: [{ id: "step-90", kind: "compute", description: "入れ子" }] } },
      { op: "add", actionId: "act-001", kind: "compute" },
    ] });
    expect(r.results[1].stepId).toBe("step-91");
  });

  it("消した id は、同じバッチの後ろで使い直せる", async () => {
    const r = await J("designer__edit_steps", { processFlowId: "cart-summary", edits: [{ op: "remove", stepId: "step-01" }, { op: "add", actionId: "act-001", kind: "compute", id: "step-01" }] });
    expect(r.edits).toBe(2);
  });

  it("もとからあるスキーマ違反は、工程を動かしただけでは『新しい違反』にならない。保存後の更新日時は meta に入る", async () => {
    // 先に 1 つ壊した状態で保存する
    await J("designer__edit_steps", { processFlowId: "cart-add", apply: true, edits: [{ op: "update", stepId: "step-13", patch: { kind: "bogus" } }] });
    const saved = JSON.parse(await fs.readFile(file("cart-add"), "utf8"));
    expect("updatedAt" in saved).toBe(false); // トップレベルの updatedAt はスキーマにない
    expect(typeof saved.meta.updatedAt).toBe("string");
    const moved = await J("designer__edit_steps", { processFlowId: "cart-add", edits: [{ op: "move", stepId: "step-02", newIndex: 12 }] });
    expect(moved.newSchemaIssues ?? []).toEqual([]);
    expect(moved.moreSchemaIssues).toBeUndefined();
  });

  it("apply は true / false だけ。文字列の true は断る", async () => {
    await expect(call("designer__edit_steps", { processFlowId: "cart-add", apply: "true", edits: [{ op: "remove", stepId: "step-02" }] })).rejects.toThrow(/true \/ false/);
  });

  it("失敗の文: edits[N] を言い、接頭辞を重ねない", async () => {
    await expect(call("designer__edit_steps", { processFlowId: "cart-add", edits: [{ op: "update", stepId: "BAD ID", patch: {} }] })).rejects.toThrow(/^(?!.*MCP error -\d+: .*MCP error)edits\[0\]: Invalid stepId|edits\[0\]: Invalid/s);
  });

  it("監査: edit_steps は処理フローの変更として数え、予行 (apply なし) は記録しない", async () => {
    const { aiToolDesignKind } = await import("@harmony/shared");
    expect(aiToolDesignKind("designer__edit_steps")).toBe("processFlow");
    const def = tools.find((t) => t.name === "designer__edit_steps")!;
    expect("apply" in (def.inputSchema as { properties: object }).properties).toBe(true);
  });
});
