import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditSession } from "./useEditSession";

const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();

vi.mock("../mcp/mcpBridge", () => {
  const bridge = {
    getLock: vi.fn(),
    hasDraft: vi.fn(),
    acquireLock: vi.fn(),
    releaseLock: vi.fn(),
    forceReleaseLock: vi.fn(),
    createDraft: vi.fn(),
    commitDraft: vi.fn(),
    discardDraft: vi.fn(),
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

const SESSION_ID = "session-abc";
const OPTS = {
  resourceType: "table" as const,
  resourceId: "tbl-001",
  sessionId: SESSION_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  broadcastHandlers.clear();
  (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: null });
  (mcpBridge.hasDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: false });
  (mcpBridge.acquireLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });
  (mcpBridge.releaseLock as ReturnType<typeof vi.fn>).mockResolvedValue({ released: true });
  (mcpBridge.forceReleaseLock as ReturnType<typeof vi.fn>).mockResolvedValue({ released: true, previousOwner: "other-session" });
  (mcpBridge.createDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ created: true });
  (mcpBridge.commitDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ committed: true });
  (mcpBridge.discardDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ discarded: true });
});

afterEach(() => {
  broadcastHandlers.clear();
});

describe("useEditSession", () => {
  it("初期状態: ロックなし → readonly", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));

    expect(result.current.loading).toBe(true);

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.loading).toBe(false);
    expect(result.current.mode.kind).toBe("readonly");
  });

  it("初期状態: 他セッションがロック中 → locked-by-other", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: "other-session" } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.mode.kind).toBe("locked-by-other");
    if (result.current.mode.kind === "locked-by-other") {
      expect(result.current.mode.ownerSessionId).toBe("other-session");
    }
  });

  it("初期状態: 自分がロック中 → editing", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.mode.kind).toBe("editing");
  });

  it("startEditing: readonly → editing", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.actions.startEditing();
    });

    expect(mcpBridge.acquireLock).toHaveBeenCalledWith("table", "tbl-001", SESSION_ID);
    expect(mcpBridge.createDraft).toHaveBeenCalledWith("table", "tbl-001");
    expect(result.current.mode.kind).toBe("editing");
  });

  it("save: editing → readonly", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.actions.save();
    });

    expect(mcpBridge.commitDraft).toHaveBeenCalledWith("table", "tbl-001");
    expect(mcpBridge.releaseLock).toHaveBeenCalledWith("table", "tbl-001", SESSION_ID);
    expect(result.current.mode.kind).toBe("readonly");
  });

  it("discard: editing → readonly", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      await result.current.actions.discard();
    });

    expect(mcpBridge.discardDraft).toHaveBeenCalledWith("table", "tbl-001");
    expect(mcpBridge.releaseLock).toHaveBeenCalledWith("table", "tbl-001", SESSION_ID);
    expect(result.current.mode.kind).toBe("readonly");
  });

  it("broadcast lock.changed acquired: mode → locked-by-other", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "acquired",
        ownerSessionId: "other-session",
        by: "other-session",
      });
    });

    expect(result.current.mode.kind).toBe("locked-by-other");
  });

  it("broadcast lock.changed acquired: 自分がオーナー → editing", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "acquired",
        ownerSessionId: SESSION_ID,
        by: SESSION_ID,
      });
    });

    expect(result.current.mode.kind).toBe("editing");
  });

  it("broadcast lock.changed force-released: 自分がオーナー → force-released-pending", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "force-released",
        ownerSessionId: SESSION_ID,
        by: "other-session",
        previousOwner: SESSION_ID,
      });
    });

    expect(result.current.mode.kind).toBe("force-released-pending");
  });

  it("handleForcedOut discard: draft を破棄して readonly", async () => {
    (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "force-released",
        ownerSessionId: SESSION_ID,
        by: "other-session",
        previousOwner: SESSION_ID,
      });
    });

    await act(async () => {
      await result.current.actions.handleForcedOut("discard");
    });

    expect(mcpBridge.discardDraft).toHaveBeenCalledWith("table", "tbl-001");
    expect(result.current.mode.kind).toBe("readonly");
  });

  it("broadcast lock.changed force-released: 自分が解除者 → after-force-unlock", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "force-released",
        ownerSessionId: "other-session",
        by: SESSION_ID,
        previousOwner: "other-session",
      });
    });

    expect(result.current.mode.kind).toBe("after-force-unlock");
    if (result.current.mode.kind === "after-force-unlock") {
      expect(result.current.mode.previousOwner).toBe("other-session");
    }
  });

  it("handleAfterForceUnlock adopt: lock 取得して editing へ", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "force-released",
        ownerSessionId: "other-session",
        by: SESSION_ID,
        previousOwner: "other-session",
      });
    });

    await act(async () => {
      await result.current.actions.handleAfterForceUnlock("adopt");
    });

    expect(mcpBridge.acquireLock).toHaveBeenCalledWith("table", "tbl-001", SESSION_ID);
    expect(result.current.mode.kind).toBe("editing");
  });

  it("handleAfterForceUnlock discard: draft 削除して readonly へ", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "table",
        resourceId: "tbl-001",
        op: "force-released",
        ownerSessionId: "other-session",
        by: SESSION_ID,
        previousOwner: "other-session",
      });
    });

    await act(async () => {
      await result.current.actions.handleAfterForceUnlock("discard");
    });

    expect(mcpBridge.discardDraft).toHaveBeenCalledWith("table", "tbl-001");
    expect(result.current.mode.kind).toBe("readonly");
  });

  it("broadcast の resourceType / resourceId が異なる場合は無視", async () => {
    const { result } = renderHook(() => useEditSession(OPTS));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      fireBroadcast("lock.changed", {
        resourceType: "screen",
        resourceId: "other-resource",
        op: "acquired",
        ownerSessionId: "other-session",
        by: "other-session",
      });
    });

    expect(result.current.mode.kind).toBe("readonly");
  });

  describe("isDirtyForTab", () => {
    it("readonly モードでは false", async () => {
      const { result } = renderHook(() => useEditSession(OPTS));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      expect(result.current.mode.kind).toBe("readonly");
      expect(result.current.isDirtyForTab).toBe(false);
    });

    it("editing モードでは true", async () => {
      (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

      const { result } = renderHook(() => useEditSession(OPTS));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      expect(result.current.mode.kind).toBe("editing");
      expect(result.current.isDirtyForTab).toBe(true);
    });

    it("force-released-pending モードでは true", async () => {
      (mcpBridge.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: SESSION_ID } });

      const { result } = renderHook(() => useEditSession(OPTS));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      act(() => {
        fireBroadcast("lock.changed", {
          resourceType: "table",
          resourceId: "tbl-001",
          op: "force-released",
          ownerSessionId: SESSION_ID,
          by: "other-session",
          previousOwner: SESSION_ID,
        });
      });

      expect(result.current.mode.kind).toBe("force-released-pending");
      expect(result.current.isDirtyForTab).toBe(true);
    });
  });
});
