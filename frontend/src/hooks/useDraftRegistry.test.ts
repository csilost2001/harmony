import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDraftRegistry } from "./useDraftRegistry";

const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();

vi.mock("../mcp/mcpBridge", () => {
  const bridge = {
    request: vi.fn(),
    onBroadcast: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!broadcastHandlers.has(event)) {
        broadcastHandlers.set(event, new Set());
      }
      broadcastHandlers.get(event)!.add(handler);
      return () => broadcastHandlers.get(event)?.delete(handler);
    }),
  };
  return { mcpBridge: bridge };
});

function fireBroadcast(event: string, data: unknown) {
  broadcastHandlers.get(event)?.forEach((h) => h(data));
}

import { mcpBridge } from "../mcp/mcpBridge";

beforeEach(() => {
  vi.clearAllMocks();
  broadcastHandlers.clear();
  (mcpBridge.request as ReturnType<typeof vi.fn>).mockResolvedValue({
    drafts: [
      { type: "table", id: "tbl-001", mtimeMs: 1000 },
      { type: "process-flow", id: "pf-001", mtimeMs: 2000 },
    ],
  });
});

afterEach(() => {
  broadcastHandlers.clear();
});

describe("useDraftRegistry", () => {
  it("mount 時に draft.list を fetch して Map を構築する", async () => {
    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mcpBridge.request).toHaveBeenCalledWith("draft.list");
    expect(result.current.hasDraft("table", "tbl-001")).toBe(true);
    expect(result.current.hasDraft("process-flow", "pf-001")).toBe(true);
    expect(result.current.hasDraft("table", "not-exist")).toBe(false);
  });

  it("broadcast op=created で Map にエントリを追加する", async () => {
    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasDraft("view", "view-001")).toBe(false);

    act(() => {
      fireBroadcast("draft.changed", { type: "view", id: "view-001", op: "created" });
    });

    expect(result.current.hasDraft("view", "view-001")).toBe(true);
  });

  it("broadcast op=updated で Map にエントリを追加する", async () => {
    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      fireBroadcast("draft.changed", { type: "sequence", id: "seq-001", op: "updated" });
    });

    expect(result.current.hasDraft("sequence", "seq-001")).toBe(true);
  });

  it("broadcast op=committed で Map からエントリを削除する", async () => {
    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasDraft("table", "tbl-001")).toBe(true);

    act(() => {
      fireBroadcast("draft.changed", { type: "table", id: "tbl-001", op: "committed" });
    });

    expect(result.current.hasDraft("table", "tbl-001")).toBe(false);
  });

  it("broadcast op=discarded で Map からエントリを削除する", async () => {
    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasDraft("process-flow", "pf-001")).toBe(true);

    act(() => {
      fireBroadcast("draft.changed", { type: "process-flow", id: "pf-001", op: "discarded" });
    });

    expect(result.current.hasDraft("process-flow", "pf-001")).toBe(false);
  });

  it("unmount 時に onBroadcast の unsubscribe が呼ばれる", async () => {
    const { unmount } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    const handlersBefore = broadcastHandlers.get("draft.changed")?.size ?? 0;
    expect(handlersBefore).toBeGreaterThan(0);

    unmount();

    const handlersAfter = broadcastHandlers.get("draft.changed")?.size ?? 0;
    expect(handlersAfter).toBe(handlersBefore - 1);
  });

  it("MCP 未接続時は空 Map で初期化される", async () => {
    (mcpBridge.request as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not connected"));

    const { result } = renderHook(() => useDraftRegistry());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasDraft("table", "any-id")).toBe(false);
    expect(result.current.drafts.size).toBe(0);
  });
});
