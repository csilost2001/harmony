import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoad, mockSave } = vi.hoisted(() => ({ mockLoad: vi.fn(), mockSave: vi.fn() }));

vi.mock("./flowStore", () => ({
  loadProject: vi.fn(async () => ({ screens: [{ id: "dup-screen", name: "注文 (コピー)", kind: "form", path: "/orders-copy", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] })),
}));
vi.mock("./layoutComponentStore", () => ({ loadLayoutComponents: vi.fn(async () => []) }));

import { setScreenStorageBackend } from "./screenStore";
import { duplicateScreenContent } from "./duplicateScreen";

const srcEntity = () => ({
  id: "src-screen", uuid: "11111111-1111-4111-8111-111111111111", name: "注文", kind: "form", path: "/orders",
  description: "注文入力", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  items: [{ id: "qty", label: "数量", type: "integer" }],
  layout: { version: 1, nodes: [{ id: "f", type: "field", itemRef: "qty" }] },
});

describe("duplicateScreenContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad.mockImplementation(async (id: string) => (id === "src-screen" ? srcEntity() : null));
    setScreenStorageBackend({ loadScreenEntity: mockLoad, saveScreenEntity: mockSave });
  });

  it("画面項目とレイアウトを複製先に保存する。uuid・名前・パスは複製先のもの", async () => {
    await duplicateScreenContent("src-screen", "dup-screen");
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [id, saved] = mockSave.mock.calls[0];
    expect(id).toBe("dup-screen");
    expect(saved).toMatchObject({
      id: "dup-screen", name: "注文 (コピー)", path: "/orders-copy", description: "注文入力",
      items: [{ id: "qty" }], layout: { nodes: [{ id: "f", itemRef: "qty" }] },
    });
    expect(saved.uuid).not.toBe(srcEntity().uuid);
  });

  it("複製は元と独立している (コピー側を変えても元は変わらない)", async () => {
    const src = srcEntity();
    mockLoad.mockImplementation(async (id: string) => (id === "src-screen" ? src : null));
    await duplicateScreenContent("src-screen", "dup-screen");
    const saved = mockSave.mock.calls[0][1];
    saved.items[0].label = "変更";
    saved.layout.nodes[0].itemRef = "other";
    expect(src.items[0].label).toBe("数量");
    expect(src.layout.nodes[0].itemRef).toBe("qty");
  });

  it("旧形式のデザインだけの画面は、見出しだけの空のレイアウトで複製される", async () => {
    mockLoad.mockImplementation(async (id: string) => (id === "src-screen" ? { ...srcEntity(), layout: undefined, design: { designFileRef: "src-screen.design.json" } } : null));
    await duplicateScreenContent("src-screen", "dup-screen");
    const saved = mockSave.mock.calls[0][1];
    expect(saved.layout.nodes).toHaveLength(1);
    expect(saved.layout.nodes[0]).toMatchObject({ type: "heading", props: { text: "注文 (コピー)" } });
    expect(saved.design).toBeUndefined();
  });
});
