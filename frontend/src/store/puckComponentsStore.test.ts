/**
 * puckComponentsStore.test.ts
 * puckComponentsStore の add / remove / list / update 動作を検証する。
 *
 * #806 子 5
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadCustomPuckComponents,
  addCustomPuckComponent,
  removeCustomPuckComponent,
  updateCustomPuckComponent,
  saveCustomPuckComponents,
  setPuckComponentsBackend,
  type CustomPuckComponentDef,
  type PrimitivePuckComponentDef,
  type CompositePuckComponentDef,
  type PuckComponentsStorageBackend,
} from "./puckComponentsStore";

// ── localStorage モック ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ── テスト用フィクスチャ ───────────────────────────────────────────────────────

function makeComponent(
  overrides?: Partial<PrimitivePuckComponentDef>,
): PrimitivePuckComponentDef {
  return {
    kind: "primitive",
    id: "test-comp-1",
    label: "テストコンポーネント",
    primitive: "card",
    propsSchema: {
      title: { type: "string", default: "タイトル" },
      count: { type: "number" },
    },
    ...overrides,
  };
}

function makeComposite(
  overrides?: Partial<CompositePuckComponentDef>,
): CompositePuckComponentDef {
  return {
    kind: "composite",
    id: "composite-1",
    label: "複合部品テスト",
    tree: {
      content: [{ type: "Card", props: { id: "card-1" } }],
      zones: { "card-1:content": [{ type: "Heading", props: { id: "h-1" } }] },
    },
    dependencies: [],
    ...overrides,
  };
}

// ── backend 必須テスト (#923 シリーズで本体 fallback は廃止) ─────────────────

describe("puckComponentsStore — backend 未設定時はエラー (#924)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    setPuckComponentsBackend(null);
  });

  it("loadCustomPuckComponents は backend 未設定なら明示エラー", async () => {
    await expect(loadCustomPuckComponents()).rejects.toThrow(/backend が初期化されていません/);
  });

  it("saveCustomPuckComponents は backend 未設定なら明示エラー", async () => {
    await expect(saveCustomPuckComponents([])).rejects.toThrow(/backend が初期化されていません/);
  });
});

// ── バックエンドモックテスト ───────────────────────────────────────────────────

describe("puckComponentsStore — with storage backend", () => {
  let store: CustomPuckComponentDef[];

  beforeEach(() => {
    store = [];
    localStorageMock.clear();

    const backend: PuckComponentsStorageBackend = {
      loadPuckComponents: vi.fn(() => Promise.resolve([...store])),
      savePuckComponents: vi.fn((components: unknown[]) => {
        store = [...(components as CustomPuckComponentDef[])];
        return Promise.resolve();
      }),
    };
    setPuckComponentsBackend(backend);
  });

  it("バックエンド経由で add → load が動く", async () => {
    await addCustomPuckComponent(makeComponent());
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(1);
    expect((result[0] as PrimitivePuckComponentDef).primitive).toBe("card");
  });

  it("バックエンド経由で remove が動く", async () => {
    await addCustomPuckComponent(makeComponent({ id: "a" }));
    await addCustomPuckComponent(makeComponent({ id: "b" }));
    await removeCustomPuckComponent("a");
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("バックエンドが空のとき localStorage から移行する", async () => {
    // localStorage に事前データを入れる
    const localDef = makeComponent({ id: "from-local" });
    localStorageMock.setItem("designer-puck-components", JSON.stringify([localDef]));

    // バックエンドは空を返す
    let savedComponents: unknown[] = [];
    const backend: PuckComponentsStorageBackend = {
      loadPuckComponents: vi.fn(() => Promise.resolve([])),
      savePuckComponents: vi.fn((comps: unknown[]) => {
        savedComponents = comps;
        return Promise.resolve();
      }),
    };
    setPuckComponentsBackend(backend);

    const result = await loadCustomPuckComponents();
    // localStorage から移行されたはず
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("from-local");
    // バックエンドにも保存されたはず
    expect(savedComponents).toHaveLength(1);
  });

  it("saveCustomPuckComponents で全量書き込みできる", async () => {
    const defs = [
      makeComponent({ id: "x" }),
      makeComponent({ id: "y" }),
    ];
    await saveCustomPuckComponents(defs);
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(2);
  });

  it("同じ id で add するとエラー", async () => {
    const def = makeComponent();
    await addCustomPuckComponent(def);
    await expect(addCustomPuckComponent(def)).rejects.toThrow(/already exists/);
  });

  it("remove で存在しない id を指定しても残件数は変わらない", async () => {
    await addCustomPuckComponent(makeComponent({ id: "c1" }));
    await removeCustomPuckComponent("non-existent");
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(1);
  });

  it("update で部分更新できる (id は変更不可)", async () => {
    await addCustomPuckComponent(makeComponent());
    await updateCustomPuckComponent("test-comp-1", { label: "更新後ラベル" });
    const result = await loadCustomPuckComponents();
    expect(result[0].label).toBe("更新後ラベル");
    expect(result[0].id).toBe("test-comp-1");
  });

  it("update で存在しない id はエラー", async () => {
    await expect(
      updateCustomPuckComponent("non-existent", { label: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("enum 型プロパティを持つコンポーネントを保存・復元できる", async () => {
    const def = makeComponent({
      id: "enum-comp",
      propsSchema: {
        color: {
          type: "enum",
          enum: [
            { label: "赤", value: "red" },
            { label: "青", value: "blue" },
          ],
          default: "red",
        },
      },
    });
    await addCustomPuckComponent(def);
    const result = await loadCustomPuckComponents();
    const restored = result[0] as PrimitivePuckComponentDef;
    expect(restored.propsSchema.color.type).toBe("enum");
    expect(restored.propsSchema.color.enum).toHaveLength(2);
  });

  // ── 複合部品 (composite) CRUD + kind normalize (#1412 P-4) ────────────────

  it("composite レコードを add → load で復元できる", async () => {
    await addCustomPuckComponent(makeComposite());
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("composite");
    const comp = result[0] as CompositePuckComponentDef;
    expect(comp.tree.content).toHaveLength(1);
    expect(comp.tree.zones?.["card-1:content"]).toHaveLength(1);
  });

  it("primitive と composite を混在保存・load で両方復元できる", async () => {
    await addCustomPuckComponent(makeComponent({ id: "prim" }));
    await addCustomPuckComponent(makeComposite({ id: "comp" }));
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(2);
    expect(result.find((c) => c.id === "prim")?.kind).toBe("primitive");
    expect(result.find((c) => c.id === "comp")?.kind).toBe("composite");
  });

  it("composite を dependencies 付きで保存・復元できる", async () => {
    await addCustomPuckComponent(
      makeComposite({ id: "with-deps", dependencies: ["ext-widget-a"] }),
    );
    const result = await loadCustomPuckComponents();
    expect((result[0] as CompositePuckComponentDef).dependencies).toEqual([
      "ext-widget-a",
    ]);
  });

  it("composite を remove できる", async () => {
    await addCustomPuckComponent(makeComposite({ id: "c-del" }));
    await removeCustomPuckComponent("c-del");
    const result = await loadCustomPuckComponents();
    expect(result).toHaveLength(0);
  });

  it("kind 無しの旧レコードは load 時に kind:'primitive' に normalize される", async () => {
    // kind を持たない旧形式レコードを直接 backend に書き込む。
    const legacyRecord = {
      id: "legacy-prim",
      label: "旧レコード",
      primitive: "card",
      propsSchema: {},
    };
    await saveCustomPuckComponents([legacyRecord as unknown as CustomPuckComponentDef]);
    const result = await loadCustomPuckComponents();
    expect(result[0].kind).toBe("primitive");
    expect((result[0] as PrimitivePuckComponentDef).primitive).toBe("card");
  });

  it("update は kind を変更しない", async () => {
    await addCustomPuckComponent(makeComposite({ id: "c-upd" }));
    await updateCustomPuckComponent("c-upd", { label: "更新後" });
    const result = await loadCustomPuckComponents();
    expect(result[0].kind).toBe("composite");
    expect(result[0].label).toBe("更新後");
  });
});
