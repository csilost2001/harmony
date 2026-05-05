/**
 * screenStore.ts の load/save round-trip 契約テスト。
 *
 * #815 PR #822 で screen entity 破壊 (description / auth フィールドが saveScreenEntity 経由で
 * 消失する) regression を疑った経緯から、frontend 側 round-trip で entity の全 field が保持
 * されることを保証する regression test を追加。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadScreenEntity,
  saveScreenEntity,
  setScreenStorageBackend,
  type ScreenStorageBackend,
} from "./screenStore";
import type { Screen, ScreenId, Timestamp } from "../types/v3";

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

  it("Puck 画面の saveScreenEntity が designFileRef を混入させない (Sh-4 / Codex 指摘)", async () => {
    // 旧実装では saveScreenEntity が無条件で `designFileRef: ${id}.design.json` を追加しており、
    // Puck 画面 (puckDataRef のみあるべき) に designFileRef が混入する regression があった。
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    const PUCK_SCREEN_ID = "puck-screen-001" as ScreenId;
    backend._store.set(PUCK_SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: PUCK_SCREEN_ID,
      name: "Puck 画面",
      kind: "form",
      path: "/puck",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: { editorKind: "puck", puckDataRef: "puck-data.json" },
    });

    const loaded = await loadScreenEntity(PUCK_SCREEN_ID);
    await saveScreenEntity(loaded);

    const savedRaw = backend._store.get(PUCK_SCREEN_ID) as { design?: Record<string, unknown> };
    expect(savedRaw.design?.editorKind).toBe("puck");
    expect(savedRaw.design?.puckDataRef).toBe("puck-data.json");
    expect(savedRaw.design?.designFileRef).toBeUndefined();
  });

  it("GrapesJS 画面の saveScreenEntity は puckDataRef を持たない", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    const GJS_SCREEN_ID = "gjs-screen-001" as ScreenId;
    backend._store.set(GJS_SCREEN_ID, {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: GJS_SCREEN_ID,
      name: "GrapesJS 画面",
      kind: "form",
      path: "/gjs",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: { editorKind: "grapesjs", designFileRef: `${GJS_SCREEN_ID}.design.json` },
    });

    const loaded = await loadScreenEntity(GJS_SCREEN_ID);
    await saveScreenEntity(loaded);

    const savedRaw = backend._store.get(GJS_SCREEN_ID) as { design?: Record<string, unknown> };
    expect(savedRaw.design?.editorKind).toBe("grapesjs");
    expect(savedRaw.design?.designFileRef).toBe(`${GJS_SCREEN_ID}.design.json`);
    expect(savedRaw.design?.puckDataRef).toBeUndefined();
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
    } as Screen);

    const loaded = await loadScreenEntity(SCREEN_ID);
    expect(loaded.items).toEqual(items);

    await saveScreenEntity(loaded);
    const savedRaw = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    expect(savedRaw.items).toEqual(items);
  });

  it("saveScreenEntity で editorKind/cssFramework を指定すると design に保存される (#825)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    const screen: Screen = {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "editor 選択テスト",
      kind: "list",
      path: "/test",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: {
        editorKind: "puck",
        cssFramework: "tailwind",
        puckDataRef: "puck-data.json",
      },
    };

    await saveScreenEntity(screen);

    const savedRaw = backend._store.get(SCREEN_ID) as { design?: Record<string, unknown> };
    expect(savedRaw.design?.editorKind).toBe("puck");
    expect(savedRaw.design?.cssFramework).toBe("tailwind");
    expect(savedRaw.design?.puckDataRef).toBe("puck-data.json");
    expect(savedRaw.design?.designFileRef).toBeUndefined();
  });

  it("saveScreenEntity で editorKind=grapesjs/cssFramework=bootstrap が保存される (#825)", async () => {
    const backend = makeMockBackend();
    setScreenStorageBackend(backend);

    const screen: Screen = {
      $schema: "../schemas/v3/screen.v3.schema.json",
      id: SCREEN_ID,
      name: "GrapesJS Bootstrap テスト",
      kind: "form",
      path: "/form",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      items: [],
      design: {
        editorKind: "grapesjs",
        cssFramework: "bootstrap",
        designFileRef: `${SCREEN_ID}.design.json`,
      },
    };

    await saveScreenEntity(screen);

    const savedRaw = backend._store.get(SCREEN_ID) as { design?: Record<string, unknown> };
    expect(savedRaw.design?.editorKind).toBe("grapesjs");
    expect(savedRaw.design?.cssFramework).toBe("bootstrap");
    expect(savedRaw.design?.designFileRef).toBe(`${SCREEN_ID}.design.json`);
    expect(savedRaw.design?.puckDataRef).toBeUndefined();
  });
});
