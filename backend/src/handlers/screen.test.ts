/**
 * 画面の MCP tool (#1591): ブラウザが無くても、画面の追加・更新・削除・遷移が、ファイルに直接書ける。
 * ブラウザがあるときは、これまでどおりブラウザに任せる。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildHarmonyAjv } from "@harmony/shared";
import { handleScreenTool } from "./screen.js";
import { handleEdgeTool } from "./edge.js";
import { handleTabTool } from "./tab.js";
import { handleLayoutTool } from "./layout.js";
import { readProject, readScreenEntity, readScreenFlowPositions } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import { harmonyUiUrl } from "../uiUrl.js";

const SCHEMAS = path.resolve(import.meta.dirname, "../../../schemas/v3");
const ts = "2026-01-01T00:00:00.000Z";

let ROOT = "";
beforeEach(async () => {
  ROOT = path.join(os.tmpdir(), `screen-tool-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(path.join(ROOT, "design", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "design",
    meta: { id: "screen-tool-test", uuid: "00000000-0000-4000-8000-0000000000c1", name: "画面試験", createdAt: ts, updatedAt: ts },
    entities: {},
  }, null, 2));
  vi.spyOn(wsBridge, "hasActiveBrowser").mockReturnValue(false);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const call = async (handler: typeof handleScreenTool, name: string, args: Record<string, unknown> = {}) => {
  const res = await handler(name, args, ROOT, "s") as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return res.content[0].text;
};
const addScreen = (args: Record<string, unknown>) => call(handleScreenTool, "designer__add_screen", args);
const idOf = (message: string) => /ID: ([a-z0-9-]+)/.exec(message)![1];

async function validateHarmony(): Promise<{ ok: boolean; errors: unknown }> {
  const ajv = buildHarmonyAjv();
  ajv.addSchema(JSON.parse(await fs.readFile(path.join(SCHEMAS, "common.v3.schema.json"), "utf-8")));
  const validate = ajv.compile(JSON.parse(await fs.readFile(path.join(SCHEMAS, "harmony.v3.schema.json"), "utf-8")));
  const project = JSON.parse(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8"));
  return { ok: validate(project) as boolean, errors: validate.errors };
}

type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("designer__add_screen: ブラウザが無いとき、ファイルに直接書く", () => {
  it("画面の実体・一覧の索引・フロー図の位置ができる (ブラウザの addScreen と同じ形)", async () => {
    const msg = await addScreen({ name: "顧客一覧", type: "list", path: "/customers" });
    const id = idOf(msg);
    expect(id).toMatch(/^scr-[0-9a-f]{8}$/);
    expect(msg).toContain("顧客一覧");

    const project = await readProject(ROOT) as { entities: { screens: Array<Record<string, unknown>> }; meta: { updatedAt: string } };
    expect(project.entities.screens).toHaveLength(1);
    expect(project.entities.screens[0]).toMatchObject({ id, no: 1, name: "顧客一覧", kind: "list", path: "/customers", purpose: "page", hasDesign: false });
    expect(project.meta.updatedAt).not.toBe(ts);
    expect((await validateHarmony()).ok).toBe(true);

    const entity = await readScreenEntity(id, ROOT) as Record<string, unknown>;
    expect(entity).toMatchObject({ id, name: "顧客一覧", kind: "list", path: "/customers", items: [] });
    expect(typeof entity.uuid).toBe("string");
    expect(entity.layout).toEqual({ version: 1, nodes: [{ id: "pageTitle", type: "heading", props: { text: "顧客一覧", level: 1 } }] });

    const positions = await readScreenFlowPositions(ROOT) as { positions: Record<string, Rect> };
    expect(positions.positions[id]).toMatchObject({ x: 100, y: 150, width: 200, height: 100 });

    // 画面一覧・get_screen_layout (ファイルから読む tool) でも見える
    expect(await call(handleScreenTool, "designer__list_screens")).toContain(id);
    expect(await call(handleLayoutTool, "designer__get_screen_layout", { screenId: id })).toContain("pageTitle");
  });

  it("type 省略時は other、purpose は gadget を指定できる、id を指定できる", async () => {
    const id = idOf(await addScreen({ name: "ガジェット", purpose: "gadget", id: "my-gadget" }));
    expect(id).toBe("my-gadget");
    const project = await readProject(ROOT) as { entities: { screens: Array<Record<string, unknown>> } };
    expect(project.entities.screens[0]).toMatchObject({ id: "my-gadget", kind: "other", purpose: "gadget" });
    expect((await validateHarmony()).ok).toBe(true);
  });

  it("2 つ以上作っても、フロー図の位置が重ならない (位置を決め打ちした画面とも重ならない)", async () => {
    await addScreen({ name: "固定", position: { x: 350, y: 150 } }); // 2 番目の既定の位置に先に置く
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(idOf(await addScreen({ name: `画面${i}` })));
    const { positions } = await readScreenFlowPositions(ROOT) as { positions: Record<string, Rect> };
    const rects = Object.values(positions);
    expect(rects).toHaveLength(13);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
    const project = await readProject(ROOT) as { entities: { screens: Array<{ no: number }> } };
    expect(project.entities.screens.map((s) => s.no)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect((await validateHarmony()).ok).toBe(true);
  });

  it("位置が無い既存の画面 (frontend が既定の位置に置く) とも重ならない", async () => {
    await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
      schemaVersion: "v3", dataDir: "design",
      meta: { id: "screen-tool-test", uuid: "00000000-0000-4000-8000-0000000000c1", name: "画面試験", createdAt: ts, updatedAt: ts },
      entities: { screens: [{ id: "old-a", no: 1, name: "旧A", updatedAt: ts }, { id: "old-b", no: 2, name: "旧B", updatedAt: ts }] },
    }));
    const id = idOf(await addScreen({ name: "新" }));
    const { positions } = await readScreenFlowPositions(ROOT) as { positions: Record<string, Rect> };
    // old-a は (100,150)、old-b は (350,150) の既定の位置
    expect(positions[id]).toMatchObject({ x: 600, y: 150 });
  });

  it("重複 ID は断り、何も書かない", async () => {
    await addScreen({ name: "A", id: "dup-screen" });
    const before = await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8");
    await expect(addScreen({ name: "B", id: "dup-screen" })).rejects.toThrow(/すでにあります/);
    expect(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")).toBe(before);
    const { positions } = await readScreenFlowPositions(ROOT) as { positions: Record<string, unknown> };
    expect(Object.keys(positions)).toEqual(["dup-screen"]);
  });

  it("索引に載っていない実体のファイルがある ID も断る", async () => {
    await fs.writeFile(path.join(ROOT, "design", "screens", "ghost.json"), JSON.stringify({ id: "ghost", name: "幽霊" }));
    await expect(addScreen({ name: "B", id: "ghost" })).rejects.toThrow(/すでにあります/);
  });

  it("不正な引数は断り、何も書かない", async () => {
    const before = await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8");
    await expect(addScreen({})).rejects.toThrow(/name は必須/);
    await expect(addScreen({ name: "  " })).rejects.toThrow(/name は必須/);
    await expect(addScreen({ name: "A", type: "nonsense" })).rejects.toThrow(/type は/);
    await expect(addScreen({ name: "A", purpose: "other" })).rejects.toThrow(/purpose は/);
    await expect(addScreen({ name: "A", id: "Bad_ID" })).rejects.toThrow();
    await expect(addScreen({ name: "A", position: { x: "a", y: 1 } })).rejects.toThrow(/position は/);
    await expect(addScreen({ name: "A", path: 3 })).rejects.toThrow(/path は/);
    expect(await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")).toBe(before);
    await expect(fs.access(path.join(ROOT, "design", "screen-flow-positions.json"))).rejects.toThrow();
  });

  it("harmony.json が無いワークスペースでは、分かりやすく断る", async () => {
    await fs.rm(path.join(ROOT, "harmony.json"));
    await expect(addScreen({ name: "A" })).rejects.toThrow(/harmony.json が見つかりません/);
  });
});

describe("designer__add_screen: ブラウザがあるときは、これまでどおりブラウザに任せる", () => {
  it("sendCommand('addScreen') へ渡し、ファイルは書かない", async () => {
    vi.mocked(wsBridge.hasActiveBrowser).mockReturnValue(true);
    const send = vi.spyOn(wsBridge, "sendCommand").mockResolvedValue({ screenId: "from-browser" });
    const msg = await addScreen({ name: "顧客一覧", type: "list", path: "/c", position: { x: 1, y: 2 } });
    expect(msg).toBe("画面「顧客一覧」を追加しました（ID: from-browser）");
    expect(send).toHaveBeenCalledWith("addScreen", { id: undefined, name: "顧客一覧", type: "list", path: "/c", position: { x: 1, y: 2 }, purpose: "page" });
    const project = await readProject(ROOT) as { entities: { screens?: unknown[] } };
    expect(project.entities.screens).toBeUndefined();
  });
});

describe("ブラウザ有無によらない検査 (#1591 レビュー)", () => {
  it("ブラウザ有りでも、すでにある ID の add_screen は断り、ブラウザへ送らない (既存画面の中身を上書きしない)", async () => {
    await addScreen({ name: "既存", id: "exists-screen" }); // ブラウザ無しで作る
    vi.mocked(wsBridge.hasActiveBrowser).mockReturnValue(true);
    const send = vi.spyOn(wsBridge, "sendCommand").mockResolvedValue({ screenId: "x" });
    await expect(addScreen({ name: "上書き", id: "exists-screen" })).rejects.toThrow(/すでにあります/);
    expect(send).not.toHaveBeenCalled();
    // 索引に無い実体のファイルだけの ID も断る
    await fs.writeFile(path.join(ROOT, "design", "screens", "ghost.json"), JSON.stringify({ id: "ghost" }));
    await expect(addScreen({ name: "B", id: "ghost" })).rejects.toThrow(/すでにあります/);
    // ファイルに無い ID は通す (ブラウザ側の未保存の画面は backend から見えない)
    send.mockResolvedValue({ screenId: "new-one" });
    expect(await addScreen({ name: "新規", id: "new-one" })).toContain("new-one");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("拡張の画面種別は schema (^[a-z][a-z0-9_-]*:[a-z][a-zA-Z0-9]*$) と同じ: retail:storeFront / my_ns:thing は通り、retail:store-front は断る", async () => {
    expect(await addScreen({ name: "A", type: "retail:storeFront", id: "ext-a" })).toContain("ext-a");
    expect(await addScreen({ name: "B", type: "my_ns:thing", id: "ext-b" })).toContain("ext-b");
    await expect(addScreen({ name: "C", type: "retail:store-front" })).rejects.toThrow(/type は/);
    expect((await validateHarmony()).ok).toBe(true);
  });

  it("update_screen の type は、ブラウザ有りでも検査する (不正なら送らない)", async () => {
    vi.mocked(wsBridge.hasActiveBrowser).mockReturnValue(true);
    const send = vi.spyOn(wsBridge, "sendCommand").mockResolvedValue({ success: true });
    await expect(call(handleScreenTool, "designer__update_screen", { screenId: "a", type: "nonsense" })).rejects.toThrow(/type は/);
    expect(send).not.toHaveBeenCalled();
    await call(handleScreenTool, "designer__update_screen", { screenId: "a", type: "list" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("画面の更新・削除・遷移: ブラウザが無いとき、ファイルに直接書く", () => {
  it("update_screen は索引と実体をそろえて直す。指定しない項目 (pageLayoutId) は触らない", async () => {
    const id = idOf(await addScreen({ name: "旧名", type: "list", path: "/a" }));
    await call(handleScreenTool, "designer__update_screen", { screenId: id, pageLayoutId: "main-layout" });
    await call(handleScreenTool, "designer__update_screen", { screenId: id, name: "新名", type: "detail", path: "/b", description: "説明" });
    const project = await readProject(ROOT) as { entities: { screens: Array<Record<string, unknown>> } };
    expect(project.entities.screens[0]).toMatchObject({ name: "新名", kind: "detail", path: "/b", pageLayoutId: "main-layout" });
    const entity = await readScreenEntity(id, ROOT) as Record<string, unknown>;
    expect(entity).toMatchObject({ name: "新名", kind: "detail", path: "/b", description: "説明" });
    await call(handleScreenTool, "designer__update_screen", { screenId: id, pageLayoutId: "" });
    const after = await readProject(ROOT) as { entities: { screens: Array<Record<string, unknown>> } };
    expect(after.entities.screens[0].pageLayoutId).toBeUndefined();
    expect((await validateHarmony()).ok).toBe(true);
    await expect(call(handleScreenTool, "designer__update_screen", { screenId: "no-such" , name: "x" })).rejects.toThrow(/見つかりません/);
  });

  it("add_edge / remove_edge / get_flow / remove_screen (遷移・実体・位置も消す)", async () => {
    const a = idOf(await addScreen({ name: "A" }));
    const b = idOf(await addScreen({ name: "B" }));
    const e1 = idOf(await call(handleEdgeTool, "designer__add_edge", { source: a, target: b, label: "開く", trigger: "click" }));
    const e2 = idOf(await call(handleEdgeTool, "designer__add_edge", { source: b, target: a }));
    expect([e1, e2]).toEqual(["tr-01", "tr-02"]);
    await expect(call(handleEdgeTool, "designer__add_edge", { source: a, target: "no-such" })).rejects.toThrow(/見つかりません/);
    await expect(call(handleEdgeTool, "designer__add_edge", { source: a, target: b, trigger: "bogus" })).rejects.toThrow(/スキーマに合いません/);
    expect((await validateHarmony()).ok).toBe(true);

    const flow = await call(handleEdgeTool, "designer__get_flow");
    expect(flow).toContain("画面 (2件)");
    expect(flow).toContain("遷移 (2件)");
    expect(flow).toContain("flowchart TD");

    await call(handleEdgeTool, "designer__remove_edge", { edgeId: "tr-02" });
    await expect(call(handleEdgeTool, "designer__remove_edge", { edgeId: "tr-02" })).rejects.toThrow(/見つかりません/);

    await call(handleScreenTool, "designer__remove_screen", { screenId: a });
    const project = await readProject(ROOT) as { entities: { screens: Array<{ id: string; no: number }>; screenTransitions: unknown[] } };
    expect(project.entities.screens).toEqual([expect.objectContaining({ id: b, no: 1 })]);
    expect(project.entities.screenTransitions).toEqual([]);
    expect(await readScreenEntity(a, ROOT)).toBeNull();
    const { positions } = await readScreenFlowPositions(ROOT) as { positions: Record<string, unknown> };
    expect(Object.keys(positions)).toEqual([b]);
    expect((await validateHarmony()).ok).toBe(true);
    await expect(call(handleScreenTool, "designer__remove_screen", { screenId: a })).rejects.toThrow(/見つかりません/);
  });

  it("save_screen / save_all は、ブラウザが無ければ未保存の編集は無いと答える (エラーにしない)", async () => {
    expect(await call(handleTabTool, "designer__save_all")).toContain("未保存の編集はありません");
    const id = idOf(await addScreen({ name: "A" }));
    const msg = await call(handleTabTool, "designer__save_screen", { screenId: id });
    expect(msg).toContain("未保存の編集はありません");
    expect(msg).toContain("editSession__save");
    // 存在しない画面は成功にしない
    await expect(call(handleTabTool, "designer__save_screen", { screenId: "no-such" })).rejects.toThrow(/その画面はありません/);
  });
});

describe("ブラウザが本当に要る tool: 案内の URL は、いま動いている Harmony の画面", () => {
  it("open_tab などは、理由と URL つきで断る (環境変数が無ければ開発の 5173)", async () => {
    vi.stubEnv("HARMONY_STATIC_DIR", "");
    vi.stubEnv("HARMONY_UI_URL", "");
    await expect(call(handleTabTool, "designer__list_tabs")).rejects.toThrow(/http:\/\/localhost:5173 を開いてください \(タブはブラウザの画面の状態です\)/);
    await expect(call(handleEdgeTool, "designer__navigate_screen", { screenId: "x" })).rejects.toThrow(/画面の表示を切り替える操作です/);
    vi.unstubAllEnvs();
  });

  it("harmonyUiUrl: 配布 image / sidecar (画面を backend が配る) は backend のポート、開発は 5173、HARMONY_UI_URL が優先", () => {
    expect(harmonyUiUrl({})).toBe("http://localhost:5173");
    expect(harmonyUiUrl({ HARMONY_STATIC_DIR: "/app/dist" })).toBe("http://localhost:5179");
    expect(harmonyUiUrl({ HARMONY_STATIC_DIR: "/app/dist", DESIGNER_MCP_PORT: "5189" })).toBe("http://localhost:5189");
    expect(harmonyUiUrl({ HARMONY_STATIC_DIR: "/app/dist", HARMONY_UI_URL: "http://example.test:8080/" })).toBe("http://example.test:8080");
  });
});
