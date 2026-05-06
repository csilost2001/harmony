/**
 * remoteStorage.test.ts (#689)
 *
 * edit-session-draft モデルの remoteStorage load() ロジックをユニットテスト。
 * - draft 優先ロード
 * - draft なし時の本体 fallback
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// mcpBridge をモック
vi.mock("../mcp/mcpBridge", () => {
  return {
    mcpBridge: {
      hasDraft: vi.fn(),
      readDraft: vi.fn(),
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

const mockBridge = mcpBridge as {
  hasDraft: ReturnType<typeof vi.fn>;
  readDraft: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

const SCREEN_ID = "test-screen-remote-001";

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

    mockBridge.hasDraft.mockResolvedValue({ exists: true });
    mockBridge.readDraft.mockResolvedValue(DRAFT_DATA);

    const result = await registeredStorage!.load();
    expect(result).toEqual(DRAFT_DATA);
    expect(mockBridge.hasDraft).toHaveBeenCalledWith("screen", SCREEN_ID);
    expect(mockBridge.readDraft).toHaveBeenCalledWith("screen", SCREEN_ID);
    expect(mockBridge.request).not.toHaveBeenCalled();
  });

  test("draft がない場合は本体ファイルを返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    mockBridge.hasDraft.mockResolvedValue({ exists: false });
    mockBridge.request.mockResolvedValue(CANONICAL_DATA);

    const result = await registeredStorage!.load();
    expect(result).toEqual(CANONICAL_DATA);
    expect(mockBridge.hasDraft).toHaveBeenCalledWith("screen", SCREEN_ID);
    expect(mockBridge.readDraft).not.toHaveBeenCalled();
    expect(mockBridge.request).toHaveBeenCalledWith("loadScreen", { screenId: SCREEN_ID });
  });

  test("draft チェック失敗 (MCP エラー) 時は本体ファイルを返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    mockBridge.hasDraft.mockRejectedValue(new Error("MCP disconnected"));
    mockBridge.request.mockResolvedValue(CANONICAL_DATA);

    const result = await registeredStorage!.load();
    expect(result).toEqual(CANONICAL_DATA);
    expect(mockBridge.request).toHaveBeenCalledWith("loadScreen", { screenId: SCREEN_ID });
  });

  test("本体データが空の場合は EMPTY_PROJECT を返す", async () => {
    const { registerRemoteStorage } = await import("./remoteStorage");
    registerRemoteStorage(mockEditor, SCREEN_ID);

    mockBridge.hasDraft.mockResolvedValue({ exists: false });
    mockBridge.request.mockResolvedValue(null);

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
