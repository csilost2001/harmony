/**
 * Tests for entityIdSuggestion utility (RFC #1284 / メタ #1292 / ISSUE #1297)
 */

import { describe, expect, it, vi } from "vitest";
import {
  slugifyToEntityId,
  suggestUniqueIdSuffix,
  generateFallbackEntityId,
  requestAiSuggestedEntityId,
} from "./entityIdSuggestion";
import { isValidEntityId } from "./entityIdValidation";

describe("slugifyToEntityId", () => {
  it("英字 + 記号 mix を kebab-case に正規化する", () => {
    expect(slugifyToEntityId("Today Sales")).toBe("today-sales");
    expect(slugifyToEntityId("Customer_Master")).toBe("customer-master");
    expect(slugifyToEntityId("Order#1")).toBe("order-1");
  });

  it("先頭が数字の場合は fallback prefix を付ける", () => {
    expect(slugifyToEntityId("2024-sales", "screen")).toBe("screen-2024-sales");
  });

  it("日本語のみは空文字 → fallback id (kebab-case prefix-8桁) を返す", () => {
    const result = slugifyToEntityId("本日売上", "scr");
    expect(result.startsWith("scr-")).toBe(true);
    expect(isValidEntityId(result)).toBe(true);
  });

  it("連続記号を 1 つの hyphen に圧縮 + 前後 hyphen を削除する", () => {
    expect(slugifyToEntityId("--foo___bar--")).toBe("foo-bar");
  });

  it("64 字を超える場合 truncate して末尾 hyphen を削除する", () => {
    const long = "a".repeat(70);
    const result = slugifyToEntityId(long);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(isValidEntityId(result)).toBe(true);
  });

  it("空文字 / 非 string は fallback id を返す", () => {
    expect(slugifyToEntityId("").startsWith("entity-")).toBe(true);
    expect(slugifyToEntityId(undefined as unknown as string).startsWith("entity-")).toBe(true);
  });
});

describe("suggestUniqueIdSuffix", () => {
  it("衝突しない場合は baseId をそのまま返す", () => {
    expect(suggestUniqueIdSuffix("today-sales", [])).toBe("today-sales");
    expect(suggestUniqueIdSuffix("today-sales", ["other-id"])).toBe("today-sales");
  });

  it("衝突する場合は -2 から順に suffix を付ける", () => {
    expect(suggestUniqueIdSuffix("today-sales", ["today-sales"])).toBe("today-sales-2");
    expect(suggestUniqueIdSuffix("today-sales", ["today-sales", "today-sales-2"])).toBe("today-sales-3");
    expect(suggestUniqueIdSuffix("today-sales", ["today-sales", "today-sales-2", "today-sales-3"])).toBe("today-sales-4");
  });

  it("baseId + suffix が 64 字超なら baseId を truncate する", () => {
    const longBase = "a".repeat(64);
    const result = suggestUniqueIdSuffix(longBase, [longBase]);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result.endsWith("-2")).toBe(true);
    expect(isValidEntityId(result)).toBe(true);
  });

  it("空 existingIds で baseId をそのまま返す", () => {
    expect(suggestUniqueIdSuffix("foo", [])).toBe("foo");
  });
});

describe("generateFallbackEntityId", () => {
  it("`<prefix>-<8桁>` 形式を返す", () => {
    const id = generateFallbackEntityId("scr");
    expect(id).toMatch(/^scr-[a-f0-9]{8}$/);
    expect(isValidEntityId(id)).toBe(true);
  });

  it("prefix を kebab-case 正規化する", () => {
    const id = generateFallbackEntityId("My Prefix");
    expect(id.startsWith("myprefix-")).toBe(true);
  });

  it("空 / 不正 prefix は entity- に fallback", () => {
    expect(generateFallbackEntityId("").startsWith("entity-")).toBe(true);
    expect(generateFallbackEntityId("___").startsWith("entity-")).toBe(true);
  });
});

describe("requestAiSuggestedEntityId", () => {
  it("空 name は throw", async () => {
    await expect(
      requestAiSuggestedEntityId({ name: "", entityLabel: "画面" }),
    ).rejects.toThrow("提案元の名前が空です");
  });

  it("Codex 応答から kebab-case id を抽出して返す", async () => {
    const mockClient = createMockCodexClient({
      threadId: "test-thread-1",
      response: "today-sales",
    });

    const result = await requestAiSuggestedEntityId({
      name: "本日売上",
      entityLabel: "画面",
      client: mockClient as unknown as Parameters<typeof requestAiSuggestedEntityId>[0]["client"],
    });

    expect(result).toBe("today-sales");
  });

  it("既存 id と衝突する場合 suffix を自動付与", async () => {
    const mockClient = createMockCodexClient({
      threadId: "test-thread-2",
      response: "today-sales",
    });

    const result = await requestAiSuggestedEntityId({
      name: "本日売上",
      entityLabel: "画面",
      existingIds: ["today-sales"],
      client: mockClient as unknown as Parameters<typeof requestAiSuggestedEntityId>[0]["client"],
    });

    expect(result).toBe("today-sales-2");
  });

  it("Codex 応答が EntityId 形式に合わない場合 throw", async () => {
    const mockClient = createMockCodexClient({
      threadId: "test-thread-3",
      response: "INVALID UPPER CASE",
    });

    await expect(
      requestAiSuggestedEntityId({
        name: "test",
        entityLabel: "画面",
        client: mockClient as unknown as Parameters<typeof requestAiSuggestedEntityId>[0]["client"],
      }),
    ).rejects.toThrow(/有効な ID 候補を抽出できませんでした/);
  });

  it("Codex 応答に extra 装飾があっても抽出できる", async () => {
    const mockClient = createMockCodexClient({
      threadId: "test-thread-4",
      response: "```\ntoday-sales\n```",
    });

    const result = await requestAiSuggestedEntityId({
      name: "本日売上",
      entityLabel: "画面",
      client: mockClient as unknown as Parameters<typeof requestAiSuggestedEntityId>[0]["client"],
    });

    expect(result).toBe("today-sales");
  });
});

// ── mock helper ────────────────────────────────────────────────────────────────

interface MockCodexOpts {
  threadId: string;
  response: string;
  /** turn/completed を failed として通知するか */
  failTurn?: boolean;
}

function createMockCodexClient(opts: MockCodexOpts) {
  let notificationHandler: ((n: { method: string; params: unknown }) => void) | null = null;

  const thread = {
    start: vi.fn(async () => ({ thread: { id: opts.threadId } })),
    resume: vi.fn(),
  };

  const turn = {
    start: vi.fn(async () => {
      // 非同期に notification を発火 (turn.start 後すぐ完了通知)
      setTimeout(() => {
        if (!notificationHandler) return;
        notificationHandler({
          method: "item/completed",
          params: {
            threadId: opts.threadId,
            item: { type: "agentMessage", text: opts.response },
          },
        });
        notificationHandler({
          method: "turn/completed",
          params: {
            threadId: opts.threadId,
            turn: opts.failTurn
              ? { status: "failed", error: { message: "mock failure" } }
              : { status: "completed", error: null },
          },
        });
      }, 0);
      return {};
    }),
    steer: vi.fn(),
    interrupt: vi.fn(),
  };

  return {
    thread,
    turn,
    subscribeNotification: (h: (n: { method: string; params: unknown }) => void) => {
      notificationHandler = h;
      return () => { notificationHandler = null; };
    },
  };
}
