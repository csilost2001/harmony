/**
 * screenStore.ts の load/save round-trip 契約テスト。
 *
 * #815 PR #822 で screen entity 破壊 (description / auth フィールドが saveScreenEntity 経由で
 * 消失する) regression を疑った経緯から、frontend 側 round-trip で entity の全 field が保持
 * されることを保証する regression test を追加。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadScreenEntity,
  saveScreenEntity,
  setScreenStorageBackend,
  type ScreenStorageBackend,
} from "./screenStore";
import { setFlowStorageBackend, type FlowStorageBackend } from "./flowStore";
import type { Screen, ScreenId, Timestamp, Uuid } from "../types/v3";

/**
 * In-memory mock backend — file system / mcpBridge を介さず frontend 側の round-trip を検証する。
 */
function makeMockBackend(): ScreenStorageBackend & { _store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    _store: store,
    async loadScreenEntity(screenId: string) {
      return store.get(screenId) ?? null;
    },
    async saveScreenEntity(screenId: string, data: unknown) {
      store.set(screenId, data);
    },
  };
}

const SCREEN_ID = "test-screen-001" as ScreenId;
const TIMESTAMP = "2026-05-05T00:00:00.000Z" as Timestamp;

describe("screenStore — load/save round-trip 契約", () => {
  beforeEach(() => {
    setScreenStorageBackend(null);
    // buildDefaultScreen が flowStore.loadProject / loadRawProject を呼ぶため
    // backend 必須化 (#924) に伴い passive mock を渡す。
    const flowBackend: FlowStorageBackend = {
      loadProject: vi.fn().mockResolvedValue(null),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteScreenData: vi.fn().mockResolvedValue(undefined),
    };
    setFlowStorageBackend(flowBackend);
  });

  afterEach(() => {
    setScreenStorageBackend(null);
    setFlowStorageBackend(null);
  });

  it("description / auth / groupId / maturity を含む entity が round-trip で保持される (#815)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    // backend に既存 entity を仕込む (description / auth / groupId / maturity 全て持つ)
    backend._store.set(SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "テスト画面",
      description: "重要な説明文 — 消えてはいけない",
      kind: "list",
      path: "/test",
      auth: "required",
      groupId: "1c90d535-ffd5-4991-a5d2-28c918c1f5f3",
      maturity: "draft",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [{ id: "filter1", label: "フィルタ", type: "string" }],
      design: { designFileRef: `${SCREEN_ID}.design.json`, editorKind: "grapesjs" },
    });

    const loaded = await loadScreenEntity(SCREEN_ID);
    // load で description / auth / groupId / maturity が保持されること
    expect(loaded.description).toBe("重要な説明文 — 消えてはいけない");
    expect((loaded as unknown as { auth?: string }).auth).toBe("required");
    expect(loaded.groupId).toBe("1c90d535-ffd5-4991-a5d2-28c918c1f5f3");
    expect(loaded.maturity).toBe("draft");
    expect(loaded.items).toHaveLength(1);

    // save → backend に渡るデータも保持
    await saveScreenEntity(loaded);
    const savedRaw = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    expect(savedRaw.description).toBe("重要な説明文 — 消えてはいけない");
    expect(savedRaw.auth).toBe("required");
    expect(savedRaw.groupId).toBe("1c90d535-ffd5-4991-a5d2-28c918c1f5f3");
    expect(savedRaw.maturity).toBe("draft");
    expect(Array.isArray(savedRaw.items)).toBe(true);
    expect((savedRaw.items as unknown[]).length).toBe(1);
  });

  it("description / auth が undefined の場合は出力に含まれない (defined-only)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    backend._store.set(SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "シンプル画面",
      kind: "form",
      path: "/simple",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: { designFileRef: `${SCREEN_ID}.design.json`, editorKind: "grapesjs" },
    });

    const loaded = await loadScreenEntity(SCREEN_ID);
    expect(loaded.description).toBeUndefined();
    expect((loaded as unknown as { auth?: string }).auth).toBeUndefined();

    // save しても description / auth は undefined のまま (誤って空文字列等が混入しないこと)
    await saveScreenEntity(loaded);
    const savedRaw = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    expect(savedRaw.description).toBeUndefined();
    expect(savedRaw.auth).toBeUndefined();
  });

  it("save が defaultScreen を base に raw を上書きしても description / auth は raw 由来で保持される", async () => {
    // loadScreenEntity の `{...defaultScreen, ...raw}` spread で raw が default を上書きする
    // ことを直接検証する (description / auth は defaultScreen に存在しないため raw からのみ来る)。
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    backend._store.set(SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "上書きテスト",
      description: "raw 由来の説明",
      kind: "list",
      path: "/raw",
      auth: "optional",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: { designFileRef: `${SCREEN_ID}.design.json`, editorKind: "grapesjs" },
    });

    const loaded = await loadScreenEntity(SCREEN_ID);
    expect(loaded.description).toBe("raw 由来の説明");
    expect((loaded as unknown as { auth?: string }).auth).toBe("optional");
  });

  it("既存 items[] の round-trip 保持 (saveScreenEntity が items を消さない)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    const items = [
      { id: "item1", label: "項目1", type: "string" },
      { id: "item2", label: "項目2", type: "number" },
      { id: "item3", label: "項目3", type: "boolean" },
    ];
    backend._store.set(SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "items テスト",
      kind: "form",
      path: "/items",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items,
      design: { designFileRef: `${SCREEN_ID}.design.json`, editorKind: "grapesjs" },
    } as unknown as Screen);

    const loaded = await loadScreenEntity(SCREEN_ID);
    expect(loaded.items).toEqual(items);

    await saveScreenEntity(loaded);
    const savedRaw = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    expect(savedRaw.items).toEqual(items);
  });

  it("旧形式の design (GrapesJS / Puck の参照) は読込・保存でそのまま保持され、補完も削除もされない", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);
    for (const design of [
      { editorKind: "grapesjs", cssFramework: "bootstrap", designFileRef: `${SCREEN_ID}.design.json` },
      { editorKind: "puck", cssFramework: "tailwind", puckDataRef: "puck-data.json" },
    ]) {
      backend._store.set(SCREEN_ID, {
        $schema: "../schemas/v3/screen.v3.schema.json", id: SCREEN_ID, uuid: "11111111-1111-4111-8111-111111111111" as Uuid,
        name: "旧画面", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, kind: "form", path: "/old", items: [], design,
      });
      const loaded = await loadScreenEntity(SCREEN_ID);
      expect(loaded.design).toEqual(design);
      await saveScreenEntity(loaded);
      expect((backend._store.get(SCREEN_ID) as { design?: unknown }).design).toEqual(design);
    }
  });

  it("layout の無い保存済みの画面を読んでも、既定の layout を補わない (旧形式の画面は開始画面で扱う)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);
    backend._store.set(SCREEN_ID, {
      id: SCREEN_ID, uuid: "11111111-1111-4111-8111-111111111111", name: "旧画面", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, kind: "form", path: "/old", items: [],
      design: { designFileRef: `${SCREEN_ID}.design.json` },
    });
    expect((await loadScreenEntity(SCREEN_ID)).layout).toBeUndefined();
  });

  it("保存済みの layout は読込・保存で保持される", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);
    const layout = { version: 1, nodes: [{ id: "f", type: "field", itemRef: "qty" }] };
    backend._store.set(SCREEN_ID, { id: SCREEN_ID, uuid: "11111111-1111-4111-8111-111111111111", name: "画面", createdAt: TIMESTAMP, updatedAt: TIMESTAMP, kind: "form", path: "/x", items: [{ id: "qty", label: "数量", type: "integer" }], layout });
    const loaded = await loadScreenEntity(SCREEN_ID);
    expect(loaded.layout).toEqual(layout);
    await saveScreenEntity(loaded);
    expect((backend._store.get(SCREEN_ID) as { layout?: unknown }).layout).toEqual(layout);
  });
});
