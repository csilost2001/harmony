/**
 * screenItemsStore — fragments[] passthrough 契約テスト (#1281)
 *
 * loadScreenItems / saveScreenItems が Screen.fragments[] を正しく passthrough することを検証。
 * screenStore の backend injection を使って実際の I/O を排除する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setScreenStorageBackend,
  type ScreenStorageBackend,
} from "./screenStore";
import { setFlowStorageBackend, type FlowStorageBackend } from "./flowStore";
import { loadScreenItems, saveScreenItems, clearItemsFromCache } from "./screenItemsStore";
import type { ScreenId, Timestamp } from "../types/v3";

const SCREEN_ID = "test-frags-001" as ScreenId;
const TIMESTAMP = "2026-05-24T00:00:00.000Z" as Timestamp;

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

function baseScreen(extra: Record<string, unknown> = {}) {
  return {
    $schema: "../schemas/v3/screen.v3.schema.json",
    id: SCREEN_ID,
    name: "テスト画面",
    kind: "form",
    path: "/test",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    items: [],
    design: { editorKind: "grapesjs", designFileRef: `${SCREEN_ID}.design.json` },
    ...extra,
  };
}

describe("screenItemsStore — fragments[] passthrough (#1281)", () => {
  let backend: ReturnType<typeof makeMockBackend>;

  beforeEach(() => {
    backend = makeMockBackend();
    setScreenStorageBackend(backend);
    clearItemsFromCache(SCREEN_ID);
    // buildDefaultScreen が flowStore.loadProject / loadRawProject を呼ぶため passive mock
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
    clearItemsFromCache(SCREEN_ID);
  });

  it("9. loadScreenItems が fragments[] を保持 (entity に fragments があれば document.fragments に含まれる)", async () => {
    backend._store.set(SCREEN_ID, baseScreen({
      fragments: [
        { fragmentRef: "generic-definitions/ui-fragment/messageArea", instanceId: "top" },
        { fragmentRef: "generic-definitions/ui-fragment/uploadRow" },
      ],
    }));

    const doc = await loadScreenItems(SCREEN_ID);
    expect(doc.fragments).toHaveLength(2);
    expect(doc.fragments![0].fragmentRef).toBe("generic-definitions/ui-fragment/messageArea");
    expect(doc.fragments![0].instanceId).toBe("top");
    expect(doc.fragments![1].fragmentRef).toBe("generic-definitions/ui-fragment/uploadRow");
    expect(doc.fragments![1].instanceId).toBeUndefined();
  });

  it("10. saveScreenItems が空 fragments[] を undefined として entity 書き戻し", async () => {
    backend._store.set(SCREEN_ID, baseScreen());

    const doc = await loadScreenItems(SCREEN_ID);
    // 空配列を渡した場合、entity には fragments を書き込まない (undefined 化)
    await saveScreenItems({ ...doc, fragments: [] });

    const saved = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    expect(saved.fragments).toBeUndefined();
  });

  it("11. saveScreenItems が fragments[] を保持して書き戻し", async () => {
    backend._store.set(SCREEN_ID, baseScreen());

    const doc = await loadScreenItems(SCREEN_ID);
    const frags = [
      { fragmentRef: "generic-definitions/ui-fragment/messageArea", instanceId: "banner" },
    ];
    await saveScreenItems({ ...doc, fragments: frags });

    const saved = backend._store.get(SCREEN_ID) as Record<string, unknown>;
    const savedFrags = saved.fragments as typeof frags;
    expect(Array.isArray(savedFrags)).toBe(true);
    expect(savedFrags).toHaveLength(1);
    expect(savedFrags[0].fragmentRef).toBe("generic-definitions/ui-fragment/messageArea");
    expect(savedFrags[0].instanceId).toBe("banner");
  });
});
