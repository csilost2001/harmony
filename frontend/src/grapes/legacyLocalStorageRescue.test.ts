/**
 * legacyLocalStorageRescue.test.ts (#689)
 *
 * localStorage 救済ロジックのユニットテスト。
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { checkLegacyLocalStorage, executeRescue, clearLegacyLocalStorage } from "./legacyLocalStorageRescue";

// mcpBridge をモック
vi.mock("../mcp/mcpBridge", () => {
  return {
    mcpBridge: {
      request: vi.fn(),
      createDraft: vi.fn(),
      updateDraft: vi.fn(),
    },
  };
});

// flowStore.screenStorageKey をモック
vi.mock("../store/flowStore", () => {
  return {
    screenStorageKey: (screenId: string) => `gjs-screen-${screenId}`,
  };
});

import { mcpBridge } from "../mcp/mcpBridge";

const mockBridge = mcpBridge as {
  request: ReturnType<typeof vi.fn>;
  createDraft: ReturnType<typeof vi.fn>;
  updateDraft: ReturnType<typeof vi.fn>;
};

const SCREEN_ID = "test-screen-001";
const LOCAL_KEY = `gjs-screen-${SCREEN_ID}`;
const DRAFT_MARKER_KEY = `gjs-screen-${SCREEN_ID}-draft`;

const CANONICAL_DATA = {
  assets: [],
  styles: [],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
};

const LEGACY_DATA = {
  assets: [],
  styles: [{ selectors: [".old"], style: { color: "red" } }],
  pages: [{ frames: [{ component: { type: "wrapper" } }] }],
};

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorageMock.clear();
});

describe("checkLegacyLocalStorage", () => {
  test("localStorage に旧キーがない場合は hasLegacy: false を返す", async () => {
    const result = await checkLegacyLocalStorage(SCREEN_ID);
    expect(result.hasLegacy).toBe(false);
  });

  test("旧キーがあり本体と差分なしの場合は hasLegacy: false (自動削除)", async () => {
    localStorageMock.setItem(LOCAL_KEY, JSON.stringify(CANONICAL_DATA));
    mockBridge.request.mockResolvedValue(CANONICAL_DATA);

    const result = await checkLegacyLocalStorage(SCREEN_ID);
    expect(result.hasLegacy).toBe(false);
    // 差分なしで削除される
    expect(localStorageMock.getItem(LOCAL_KEY)).toBeNull();
  });

  test("旧キーがあり本体と差分ありの場合は hasLegacy: true とデータを返す", async () => {
    localStorageMock.setItem(LOCAL_KEY, JSON.stringify(LEGACY_DATA));
    mockBridge.request.mockResolvedValue(CANONICAL_DATA);

    const result = await checkLegacyLocalStorage(SCREEN_ID);
    expect(result.hasLegacy).toBe(true);
    expect(result.data).toEqual(LEGACY_DATA);
  });

  test("MCP エラー時も旧データがあれば hasLegacy: true を返す", async () => {
    localStorageMock.setItem(LOCAL_KEY, JSON.stringify(LEGACY_DATA));
    mockBridge.request.mockRejectedValue(new Error("MCP disconnected"));

    const result = await checkLegacyLocalStorage(SCREEN_ID);
    expect(result.hasLegacy).toBe(true);
  });

  test("破損した JSON は黙って削除し hasLegacy: false を返す", async () => {
    localStorageMock.setItem(LOCAL_KEY, "{ invalid json");

    const result = await checkLegacyLocalStorage(SCREEN_ID);
    expect(result.hasLegacy).toBe(false);
    expect(localStorageMock.getItem(LOCAL_KEY)).toBeNull();
  });
});

describe("executeRescue", () => {
  test("adopt: createDraft + updateDraft を呼び localStorage を削除する", async () => {
    localStorageMock.setItem(LOCAL_KEY, JSON.stringify(LEGACY_DATA));
    localStorageMock.setItem(DRAFT_MARKER_KEY, "1");
    mockBridge.createDraft.mockResolvedValue(undefined);
    mockBridge.updateDraft.mockResolvedValue(undefined);

    await executeRescue(SCREEN_ID, "adopt", LEGACY_DATA);

    expect(mockBridge.createDraft).toHaveBeenCalledWith("screen", SCREEN_ID);
    expect(mockBridge.updateDraft).toHaveBeenCalledWith("screen", SCREEN_ID, LEGACY_DATA);
    expect(localStorageMock.getItem(LOCAL_KEY)).toBeNull();
    expect(localStorageMock.getItem(DRAFT_MARKER_KEY)).toBeNull();
  });

  test("discard: MCP を呼ばずに localStorage のみ削除する", async () => {
    localStorageMock.setItem(LOCAL_KEY, JSON.stringify(LEGACY_DATA));
    localStorageMock.setItem(DRAFT_MARKER_KEY, "1");

    await executeRescue(SCREEN_ID, "discard");

    expect(mockBridge.createDraft).not.toHaveBeenCalled();
    expect(mockBridge.updateDraft).not.toHaveBeenCalled();
    expect(localStorageMock.getItem(LOCAL_KEY)).toBeNull();
    expect(localStorageMock.getItem(DRAFT_MARKER_KEY)).toBeNull();
  });
});

describe("clearLegacyLocalStorage", () => {
  test("旧キーと draft マーカーを削除する", () => {
    localStorageMock.setItem(LOCAL_KEY, "data");
    localStorageMock.setItem(DRAFT_MARKER_KEY, "1");

    clearLegacyLocalStorage(SCREEN_ID);

    expect(localStorageMock.getItem(LOCAL_KEY)).toBeNull();
    expect(localStorageMock.getItem(DRAFT_MARKER_KEY)).toBeNull();
  });
});
