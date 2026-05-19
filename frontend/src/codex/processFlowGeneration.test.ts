import { describe, expect, it, vi } from "vitest";
import type { ProcessFlow } from "../types/v3";
import { CodexBrowserClient, type McpBridgeLike } from "./codexClient";
import {
  generateProcessFlowWithCodex,
  mergeGeneratedProcessFlow,
} from "./processFlowGeneration";

function baseFlow(): ProcessFlow {
  return {
    $schema: "../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id: "flow-1" as never,
      name: "既存フロー",
      kind: "screen",
      screenId: "screen-1" as never,
      maturity: "draft",
      mode: "upstream",
      createdAt: "2026-05-01T00:00:00.000Z" as never,
      updatedAt: "2026-05-01T00:00:00.000Z" as never,
    },
    actions: [],
    authoring: {
      markers: [{
        id: "marker-1",
        kind: "todo",
        body: "既存 marker",
        author: "human",
        createdAt: "2026-05-01T00:00:00.000Z",
      }],
    },
  } as ProcessFlow;
}

function clientWithGeneratedText(text: string) {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const request = vi.fn(async (method: string) => {
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") {
      queueMicrotask(() => {
        notificationHandler?.({
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: text },
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
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "model failed" } } },
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

describe("generateProcessFlowWithCodex", () => {
  it("starts a Codex thread/turn and parses the generated ProcessFlow JSON", async () => {
    const generated = {
      meta: {
        id: "flow-1",
        name: "商品検索",
        kind: "screen",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      },
      actions: [{ id: "act-search", name: "検索", trigger: "click", steps: [] }],
    };
    const { client, request } = clientWithGeneratedText(`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``);

    const result = await generateProcessFlowWithCodex({
      client,
      current: baseFlow(),
      requirement: "商品検索処理を作成",
    });

    expect(result.meta.name).toBe("商品検索");
    expect(result.actions).toHaveLength(1);
    expect(request).toHaveBeenCalledWith("codex.thread.start", expect.objectContaining({
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    }));
    expect(request).toHaveBeenCalledWith("codex.turn.start", expect.objectContaining({
      threadId: "thread-1",
      outputSchema: expect.objectContaining({ type: "object" }),
    }));
  });

  it("preserves local identity and authoring data when merging generated output", () => {
    const current = baseFlow();
    const generated = {
      ...current,
      meta: {
        ...current.meta,
        id: "different" as never,
        name: "生成後",
        screenId: undefined,
        createdAt: "2026-05-12T00:00:00.000Z" as never,
      },
      actions: [{ id: "act-1", name: "登録", trigger: "click", steps: [] }],
      authoring: undefined,
    } as ProcessFlow;

    const merged = mergeGeneratedProcessFlow(current, generated);

    expect(merged.meta.id).toBe(current.meta.id);
    expect(merged.meta.createdAt).toBe(current.meta.createdAt);
    expect(merged.meta.screenId).toBe(current.meta.screenId);
    expect(merged.meta.name).toBe("生成後");
    expect(merged.authoring).toBe(current.authoring);
  });

  it("unsubscribes when turn.start rejects", async () => {
    const { client, unsubscribe } = clientWithTurnStartFailure();

    await expect(generateProcessFlowWithCodex({
      client,
      current: baseFlow(),
      requirement: "生成",
    })).rejects.toThrow(/turn failed before start/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects and unsubscribes when Codex reports a failed turn", async () => {
    const { client, unsubscribe } = clientWithFailedTurn();

    await expect(generateProcessFlowWithCodex({
      client,
      current: baseFlow(),
      requirement: "生成",
    })).rejects.toThrow(/model failed/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
