import { describe, it, expect, vi } from "vitest";
import type { Component } from "grapesjs";
import { explicitItemId } from "./screenItemsSync";

function cmp(attrs: Record<string, string>): Component {
  return { getAttributes: () => attrs } as unknown as Component;
}

describe("explicitItemId", () => {
  it("data-item-id を最優先で採用する", () => {
    expect(explicitItemId(cmp({ "data-item-id": "addProductCode", name: "other", id: "ix1" }))).toBe("addProductCode");
  });

  it("data-item-id が UUID の場合は name を採用する", () => {
    expect(explicitItemId(cmp({ "data-item-id": "3f2b8c1e-1d2a-4b3c-8d4e-5f6a7b8c9d0e", name: "quantity" }))).toBe("quantity");
  });

  it("GrapesJS の内部 id だけを持つ要素は項目として扱わない", () => {
    expect(explicitItemId(cmp({ id: "imyus6" }))).toBe("");
  });
});

describe("attachScreenItemsSync のガード", () => {
  it("閲覧中・ロード中・破棄中は原本を書き換えない", async () => {
    const { attachScreenItemsSync } = await import("./screenItemsSync");
    const handlers: Record<string, Array<(c: Component) => void>> = {};
    const editor = {
      on: (ev: string, fn: (c: Component) => void) => { (handlers[ev] ??= []).push(fn); },
      off: () => undefined,
    } as unknown as Parameters<typeof attachScreenItemsSync>[0];
    const store = await import("../store/screenItemsStore");
    const save = vi.spyOn(store, "saveScreenItems").mockResolvedValue();
    vi.spyOn(store, "loadScreenItems").mockResolvedValue({ screenId: "s" as never, updatedAt: "" as never, items: [{ id: "qty" } as never] });
    const input = { get: (k: string) => (k === "tagName" ? "input" : undefined), getAttributes: () => ({ name: "qty", type: "text" }), components: () => [] } as unknown as Component;

    const loading = { current: false };
    const readonly = { current: true };
    attachScreenItemsSync(editor, "s", loading, readonly);
    handlers["component:remove"].forEach((h) => h(input));
    readonly.current = false;
    handlers["destroy"].forEach((h) => h(input));
    handlers["component:remove"].forEach((h) => h(input));
    await new Promise((r) => setTimeout(r, 10));
    expect(save).not.toHaveBeenCalled();
  });
});

describe("attachScreenItemsSync (編集中の操作)", () => {
  it("編集中にブロックを削除すると対応する画面項目も削除される", async () => {
    vi.restoreAllMocks();
    const { attachScreenItemsSync } = await import("./screenItemsSync");
    const handlers: Record<string, Array<(c: Component) => void>> = {};
    const editor = { on: (ev: string, fn: (c: Component) => void) => { (handlers[ev] ??= []).push(fn); }, off: () => undefined } as unknown as Parameters<typeof attachScreenItemsSync>[0];
    const store = await import("../store/screenItemsStore");
    const save = vi.spyOn(store, "saveScreenItems").mockResolvedValue();
    vi.spyOn(store, "loadScreenItems").mockResolvedValue({ screenId: "s2" as never, updatedAt: "" as never, items: [{ id: "qty" } as never, { id: "other" } as never] });
    const input = { get: (k: string) => (k === "tagName" ? "input" : undefined), getAttributes: () => ({ name: "qty", type: "text" }), components: () => [] } as unknown as Component;
    attachScreenItemsSync(editor, "s2", { current: false }, { current: false });
    handlers["component:remove"].forEach((h) => h(input));
    await new Promise((r) => setTimeout(r, 10));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ items: [{ id: "other" }] }));
  });
});
