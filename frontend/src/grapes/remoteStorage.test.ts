/**
 * remoteStorage.test.ts (#689)
 *
 * edit-session-draft モデルの remoteStorage load() ロジックをユニットテスト。
 * - EditSession draft 優先ロード (editSession.list + editSession.fetchPayload)
 * - draft なし時の本体 fallback
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// mcpBridge をモック
vi.mock("../mcp/mcpBridge", () => {
  return {
    mcpBridge: {
      request: vi.fn(),
    },
  };
});

// recordError をモック (副作用なし)
vi.mock("../utils/errorLog", () => {
  return {
    recordError: vi.fn(),
  };
});

import { mcpBridge } from "../mcp/mcpBridge";
import type { Editor as GEditor } from "grapesjs";

const mockBridge = mcpBridge as unknown as {
  request: ReturnType<typeof vi.fn>;
};

const SCREEN_ID = "test-screen-remote-001";
const EDIT_SESSION_ID = "es-remote-001";

const DRAFT_DATA = {
  assets: [],
  styles: [{ selectors: [".draft"], style: { color: "blue" } }],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
};

const CANONICAL_DATA = {
  assets: [],
  styles: [],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
};

// StorageManager をモック
let registeredStorage: {
  load: () => Promise<Record<string, unknown>>;
  store: (data: Record<string, unknown>) => Promise<void>;
} | null = null;

const mockEditor = {
  StorageManager: {
    add: vi.fn((_type: string, storage: typeof registeredStorage) => {
      registeredStorage = storage;
    }),
  },
} as unknown as GEditor;

beforeEach(() => {
  vi.clearAllMocks();
  registeredStorage = null;
});

describe("registerRemoteStorage — load()", () => {
  test("draft が存在する場合は draft を優先して返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    // editSession.list → session あり → editSession.fetchPayload → DRAFT_DATA
    mockBridge.request.mockImplementation(async (method: string) => {
      if (method === "editSession.list") {
        return { sessions: [{ id: EDIT_SESSION_ID }] };
      }
      if (method === "editSession.fetchPayload") {
        return { payload: DRAFT_DATA, sequence: 1 };
      }
      return null;
    });

    const result = await registeredStorage!.load();
    expect(result).toEqual(DRAFT_DATA);
    expect(mockBridge.request).toHaveBeenCalledWith("editSession.list", { resourceType: "screen", resourceId: SCREEN_ID });
    expect(mockBridge.request).toHaveBeenCalledWith("editSession.fetchPayload", { editSessionId: EDIT_SESSION_ID });
  });

  test("draft がない場合は本体ファイルを返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    // editSession.list → session なし → loadScreen → CANONICAL_DATA
    mockBridge.request.mockImplementation(async (method: string) => {
      if (method === "editSession.list") {
        return { sessions: [] };
      }
      if (method === "loadScreen") {
        return CANONICAL_DATA;
      }
      return null;
    });

    const result = await registeredStorage!.load();
    expect(result).toEqual(CANONICAL_DATA);
    expect(mockBridge.request).toHaveBeenCalledWith("editSession.list", { resourceType: "screen", resourceId: SCREEN_ID });
    expect(mockBridge.request).toHaveBeenCalledWith("loadScreen", { screenId: SCREEN_ID });
  });

  test("draft チェック失敗 (MCP エラー) 時は本体ファイルを返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    let callCount = 0;
    mockBridge.request.mockImplementation(async (method: string) => {
      if (method === "editSession.list") {
        throw new Error("MCP disconnected");
      }
      if (method === "loadScreen") {
        callCount++;
        return CANONICAL_DATA;
      }
      return null;
    });

    const result = await registeredStorage!.load();
    expect(result).toEqual(CANONICAL_DATA);
    expect(callCount).toBe(1);
  });

  test("本体データが空の場合は EMPTY_PROJECT を返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    mockBridge.request.mockImplementation(async (method: string) => {
      if (method === "editSession.list") {
        return { sessions: [] };
      }
      if (method === "loadScreen") {
        return null;
      }
      return null;
    });

    const result = await registeredStorage!.load();
    // EMPTY_PROJECT 構造を持つことを確認
    expect(Array.isArray((result as { pages?: unknown[] }).pages)).toBe(true);
    expect((result as { pages?: unknown[] }).pages!.length).toBeGreaterThan(0);
  });

  test("store() は no-op (autosave: false のため)", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    // store() が呼ばれても例外をスローしないことを確認
    await expect(registeredStorage!.store({ assets: [], pages: [] })).resolves.toBeUndefined();
  });
});

describe("legacy exports", () => {
  test("hasScreenDraft は常に false を返す (廃止済み)", async () => {
    const { hasScreenDraft } = await import("./remoteStorage");
    expect(hasScreenDraft(SCREEN_ID)).toBe(false);
  });

  test("clearScreenDraft は no-op (廃止済み)", async () => {
    const { clearScreenDraft } = await import("./remoteStorage");
    // 例外をスローしないことのみ確認
    expect(() => clearScreenDraft(SCREEN_ID)).not.toThrow();
  });
});
