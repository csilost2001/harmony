import { describe, expect, it, vi } from "vitest";
import type { ProcessFlow } from "../types/v3";
import { CodexBrowserClient, type McpBridgeLike } from "./codexClient";
import {
  requestProcessFlowPartial,
  AiUnavailableError,
} from "./processFlowPartialRequest";

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
        body: "既存マーカー",
        author: "human",
        createdAt: "2026-05-01T00:00:00.000Z",
      }],
    },
  } as ProcessFlow;
}

function authenticatedClientWithText(text: string) {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const request = vi.fn(async (method: string) => {
    if (method === "codex.account.read") return { kind: "authenticated", account: { id: "user1" } };
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

function unauthenticatedClient() {
  const request = vi.fn(async (method: string) => {
    if (method === "codex.account.read") return { kind: "unauthenticated", requiresOpenaiAuth: true };
    throw new Error(`unexpected method: ${method}`);
  });
  const bridge: McpBridgeLike = {
    request,
    onBroadcast: vi.fn(() => () => {}),
  };
  return { client: new CodexBrowserClient(bridge) };
}

function unreachableClient() {
  const request = vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  });
  const bridge: McpBridgeLike = {
    request,
    onBroadcast: vi.fn(() => () => {}),
  };
  return { client: new CodexBrowserClient(bridge) };
}

function failedTurnClient() {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const unsubscribe = vi.fn(() => { notificationHandler = null; });
  const request = vi.fn(async (method: string) => {
    if (method === "codex.account.read") return { kind: "authenticated", account: { id: "user1" } };
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") {
      queueMicrotask(() => {
        notificationHandler?.({
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed", error: { message: "model error" } } },
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

describe("requestProcessFlowPartial", () => {
  it("throws AiUnavailableError when Codex is unauthenticated", async () => {
    const { client } = unauthenticatedClient();
    await expect(requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "入力検証を追加",
    })).rejects.toThrow(AiUnavailableError);
  });

  it("throws AiUnavailableError when Codex is unreachable", async () => {
    const { client } = unreachableClient();
    await expect(requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "入力検証を追加",
    })).rejects.toThrow(AiUnavailableError);
  });

  it("throws an error when prompt is empty", async () => {
    const { client } = authenticatedClientWithText("{}");
    await expect(requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "  ",
    })).rejects.toThrow("依頼内容が空です");
  });

  it("returns a proposed ProcessFlow preserving identity fields", async () => {
    const generated = {
      meta: {
        id: "different-id",
        name: "修正済フロー",
        kind: "screen",
        screenId: "other-screen",
        createdAt: "2026-05-13T00:00:00.000Z",
        maturity: "draft",
      },
      actions: [{ id: "act-1", name: "新規アクション", trigger: "click", steps: [] }],
    };
    const { client, request } = authenticatedClientWithText(JSON.stringify(generated));

    const result = await requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "新規アクションを追加",
    });

    expect(result.proposed.meta.id).toBe("flow-1");
    expect(result.proposed.meta.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(result.proposed.meta.screenId).toBe("screen-1");
    expect(result.proposed.meta.name).toBe("修正済フロー");
    expect(result.proposed.actions).toHaveLength(1);

    expect(request).toHaveBeenCalledWith("codex.thread.start", expect.objectContaining({
      ephemeral: true,
    }));
    expect(request).toHaveBeenCalledWith("codex.turn.start", expect.objectContaining({
      threadId: "thread-1",
      outputSchema: expect.objectContaining({ type: "object" }),
    }));
  });

  it("includes contextString in the prompt when provided", async () => {
    const generated = {
      meta: { id: "flow-1", name: "フロー", kind: "screen", maturity: "draft" },
      actions: [],
    };
    const { client, request } = authenticatedClientWithText(JSON.stringify(generated));

    await requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "## ステップ: S1\n```json\n{}\n```",
      prompt: "S1 を詳細化",
    });

    const turnStartCall = request.mock.calls.find((c) => c[0] === "codex.turn.start");
    const inputText = (turnStartCall?.[1] as { input: Array<{ text: string }> })?.input?.[0]?.text;
    expect(inputText).toContain("選択されたコンテキスト:");
    expect(inputText).toContain("## ステップ: S1");
  });

  it("rejects and unsubscribes when Codex reports a failed turn", async () => {
    const { client, unsubscribe } = failedTurnClient();

    await expect(requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "テスト依頼",
    })).rejects.toThrow(/model error/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("parses JSON wrapped in fenced code blocks", async () => {
    const generated = {
      meta: { id: "flow-1", name: "フロー", kind: "screen", maturity: "draft" },
      actions: [],
    };
    const { client } = authenticatedClientWithText(`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``);

    const result = await requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "変換テスト",
    });
    expect(result.proposed.meta.name).toBe("フロー");
  });

  it("preserves existing authoring.markers even when AI returns empty markers (S-1 regression)", async () => {
    // 独立レビュー指摘 S-1: AI が `authoring: { markers: [] }` を返してきた場合でも
    // 既存のユーザ/システム生成マーカーを silently 失わないことを保証する
    const generated = {
      meta: { id: "flow-1", name: "フロー", kind: "screen", maturity: "draft" },
      actions: [],
      authoring: { markers: [] },
    };
    const { client } = authenticatedClientWithText(JSON.stringify(generated));

    const result = await requestProcessFlowPartial({
      client,
      current: baseFlow(),
      contextString: "",
      prompt: "marker 保存テスト",
    });

    expect(result.proposed.authoring?.markers).toHaveLength(1);
    expect(result.proposed.authoring?.markers?.[0]?.id).toBe("marker-1");
    expect(result.proposed.authoring?.markers?.[0]?.body).toBe("既存マーカー");
  });
});
