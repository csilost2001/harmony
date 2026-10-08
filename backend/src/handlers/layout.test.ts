/**
 * 画面レイアウト / 独自部品の MCP tool handler。実ファイルで、取得・保存・検証結果・使用中の削除拒否を確認する。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { handleLayoutTool } from "./layout.js";
import { writeScreenEntity } from "../projectStorage.js";

const ROOT = path.join(os.tmpdir(), `layout-tools-${process.pid}-${Date.now()}`);
const SESSION = "test-session";
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await handleLayoutTool(name, args, ROOT, SESSION) as { content: Array<{ text: string }>; isError?: boolean } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  const text = res.content[0].text;
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* エラーメッセージ */ }
  return { data: data as any, isError: res.isError === true, text };
};

const panel = { id: "keyword-panel", label: "キーワード検索", params: [{ id: "kw", label: "項目", kind: "item" }, { id: "caption", label: "表題", kind: "text", default: "検索" }],
  nodes: [{ id: "p", type: "search-panel", props: { title: "{{caption}}" }, children: [{ id: "f", type: "field", itemRef: "{{kw}}" }] }] };

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000004", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }] },
  }));
  await writeScreenEntity("cart", {
    id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ id: "qty", label: "数量", type: "integer" }],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("designer__get/set_screen_layout", () => {
  it("layout が無い画面は layout: null で返す", async () => {
    const { data } = await call("designer__get_screen_layout", { screenId: "cart" });
    expect(data.layout).toBeNull();
    expect(data.items).toHaveLength(1);
  });

  it("layout を保存すると items を保持したまま原本に入り、検証結果が返る (問題があっても保存する)", async () => {
    const layout = { version: 1, nodes: [{ id: "f", type: "field", itemRef: "qty" }, { id: "g", type: "field", itemRef: "ghost" }] };
    const { data } = await call("designer__set_screen_layout", { screenId: "cart", layout });
    expect(data.saved).toBe(true);
    expect(data.counts.error).toBe(1);
    expect(data.issues.some((i: any) => i.code === "missing-item" && i.itemId === "ghost")).toBe(true);
    const back = (await call("designer__get_screen_layout", { screenId: "cart" })).data;
    expect(back.layout.nodes).toHaveLength(2);
    expect(back.items.map((i: any) => i.id)).toEqual(["qty"]);
  });

  it("ボタンの遷移先に存在しない画面を指定すると missing-screen を返す (実在する画面は返さない)", async () => {
    const layout = { version: 1, nodes: [
      { id: "b1", type: "button", props: { label: "戻る", screenRef: "cart" } },
      { id: "b2", type: "button", props: { label: "行き先なし", screenRef: "ghost-screen" } },
    ] };
    const { data } = await call("designer__set_screen_layout", { screenId: "cart", layout });
    const missing = data.issues.filter((i: any) => i.code === "missing-screen");
    expect(missing.map((i: any) => i.nodeId)).toEqual(["b2"]);
  });

  it("形が違う layout・存在しない画面は拒否する", async () => {
    await expect(call("designer__set_screen_layout", { screenId: "cart", layout: { nodes: [] } })).rejects.toThrow(/version: 1/);
    await expect(call("designer__get_screen_layout", { screenId: "nothing" })).rejects.toThrow(/見つかりません/);
  });
});

describe("designer__*_layout_component", () => {
  it("エラーのある定義は保存しない。正しい定義は保存でき、一覧に使用箇所が出る", async () => {
    const bad = await call("designer__save_layout_component", { component: { ...panel, id: "bad-panel", nodes: [{ id: "t", type: "text", props: { text: "{{undeclared}}" } }] } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("undeclared");

    expect((await call("designer__save_layout_component", { component: panel })).data.saved).toBe(true);
    await call("designer__set_screen_layout", { screenId: "cart", layout: { version: 1, nodes: [{ id: "box", type: "component", componentRef: "keyword-panel", args: { kw: "qty" } }] } });

    const list = (await call("designer__list_layout_components", {})).data;
    expect(list.components.map((c: any) => c.id)).toEqual(["keyword-panel"]);
    expect(list.components[0].usages.screens).toEqual(["cart"]);
    expect((await call("designer__get_screen_layout", { screenId: "cart" })).data.issues.filter((i: any) => i.severity === "error")).toEqual([]);
  });

  it("使用中の独自部品は force なしでは削除しない", async () => {
    const refused = (await call("designer__delete_layout_component", { componentId: "keyword-panel" })).data;
    expect(refused.deleted).toBe(false);
    expect(refused.usages.screens).toEqual(["cart"]);
    const forced = (await call("designer__delete_layout_component", { componentId: "keyword-panel", force: true })).data;
    expect(forced.deleted).toBe(true);
    // 削除後は参照側が「定義が見つかりません」になる
    expect((await call("designer__get_screen_layout", { screenId: "cart" })).data.issues.some((i: any) => i.code === "unknown-component")).toBe(true);
  });

  it("未知のツール名は null を返して次の handler に委ねる", async () => {
    expect(await handleLayoutTool("designer__nothing", {}, ROOT, SESSION)).toBeNull();
  });
});
