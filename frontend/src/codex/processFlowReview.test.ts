import { describe, expect, it, vi } from "vitest";
import type { ProcessFlow } from "../types/action";
import { CodexBrowserClient, type McpBridgeLike } from "./codexClient";
import { reviewProcessFlowWithCodex } from "./processFlowReview";

function baseFlow(): ProcessFlow {
  return {
    meta: {
      id: "flow-1" as never,
      name: "登録フロー",
      kind: "screen",
      maturity: "draft",
      mode: "upstream",
      createdAt: "2026-05-01T00:00:00.000Z" as never,
      updatedAt: "2026-05-01T00:00:00.000Z" as never,
    },
    actions: [],
  } as ProcessFlow;
}

function clientWithReview(text: string) {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const request = vi.fn(async (method: string) => {
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") {
      queueMicrotask(() => {
        notificationHandler?.({
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", delta: text },
        });
        notificationHandler?.({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } },
        });
      });
      return { turn: { id: "turn-1", status: "inProgress" } };
    }
    throw new Error(`unexpected method: ${method}`);
  });
  const bridge: McpBridgeLike = {
    request,
    onBroadcast: vi.fn((event, handler) => {
      if (event === "codex.notification") notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),
  };
  return { client: new CodexBrowserClient(bridge), request };
}

function clientWithTurnStartFailure() {
  const unsubscribe = vi.fn();
  const request = vi.fn(async (method: string) => {
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") throw new Error("turn failed before start");
    throw new Error(`unexpected method: ${method}`);
  });
  const bridge: McpBridgeLike = {
    request,
    onBroadcast: vi.fn(() => unsubscribe),
  };
  return { client: new CodexBrowserClient(bridge), unsubscribe };
}

function clientWithFailedTurn() {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const unsubscribe = vi.fn(() => { notificationHandler = null; });
  const request = vi.fn(async (method: string) => {
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") {
      queueMicrotask(() => {
        notificationHandler?.({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "review failed" } } },
        });
      });
      return { turn: { id: "turn-1", status: "inProgress" } };
    }
    throw new Error(`unexpected method: ${method}`);
  });
  const bridge: McpBridgeLike = {
    request,
    onBroadcast: vi.fn((event, handler) => {
      if (event === "codex.notification") notificationHandler = handler;
      return unsubscribe;
    }),
  };
  return { client: new CodexBrowserClient(bridge), unsubscribe };
}

describe("reviewProcessFlowWithCodex", () => {
  it("starts a Codex text review turn", async () => {
    const { client, request } = clientWithReview("## Must-fix\nなし");

    const result = await reviewProcessFlowWithCodex({
      client,
      current: baseFlow(),
      focus: "例外系",
    });

    expect(result).toContain("Must-fix");
    expect(request).toHaveBeenCalledWith("codex.thread.start", expect.objectContaining({
      ephemeral: true,
    }));
    expect(request).toHaveBeenCalledWith("codex.turn.start", expect.objectContaining({
      threadId: "thread-1",
      input: expect.arrayContaining([expect.objectContaining({
        text: expect.stringContaining("重点観点: 例外系"),
      })]),
    }));
  });

  it("unsubscribes when turn.start rejects", async () => {
    const { client, unsubscribe } = clientWithTurnStartFailure();

    await expect(reviewProcessFlowWithCodex({
      client,
      current: baseFlow(),
    })).rejects.toThrow(/turn failed before start/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects and unsubscribes when Codex reports a failed turn", async () => {
    const { client, unsubscribe } = clientWithFailedTurn();

    await expect(reviewProcessFlowWithCodex({
      client,
      current: baseFlow(),
    })).rejects.toThrow(/review failed/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
