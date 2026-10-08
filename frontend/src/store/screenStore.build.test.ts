import { describe, expect, it, vi } from "vitest";

vi.mock("./flowStore", () => ({
  loadProject: vi.fn(async () => ({ screens: [{ id: "orders", name: "受注入力", kind: "form", path: "/orders" }], edges: [], groups: [] })),
}));
vi.mock("./layoutComponentStore", () => ({ loadLayoutComponents: vi.fn(async () => []) }));

import { buildDefaultScreen } from "./screenStore";

describe("buildDefaultScreen", () => {
  it("新しい画面は画面名の見出しだけの業務部品レイアウトを持ち、旧形式の design は持たない", async () => {
    const s = await buildDefaultScreen("orders");
    expect(s.design).toBeUndefined();
    expect(s.layout).toEqual({ version: 1, nodes: [{ id: "pageTitle", type: "heading", props: { text: "受注入力", level: 1 } }] });
    expect(s).toMatchObject({ id: "orders", name: "受注入力", kind: "form", path: "/orders", items: [] });
  });
});
