import { describe, expect, it, vi } from "vitest";
import { CodexBrowserClient, type McpBridgeLike } from "./codexClient";
import { generateScreenDesignWithCodex } from "./screenDesignGeneration";

function clientWithGeneratedText(text: string) {
  let notificationHandler: ((data: unknown) => void) | null = null;
  const request = vi.fn(async (method: string) => {
    if (method === "codex.thread.start") return { thread: { id: "thread-1" } };
    if (method === "codex.turn.start") {
      queueMicrotask(() => {
        notificationHandler?.({
          method: "item/completed",
          params: { threadId: "thread-1", item: { type: "agentMessage", text } },
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

describe("generateScreenDesignWithCodex", () => {
  it("generates GrapesJS projectData with the GrapesJS output schema", async () => {
    const payload = { pages: [{ component: "<main>顧客検索</main>" }], styles: [] };
    const { client, request } = clientWithGeneratedText(JSON.stringify(payload));

    const result = await generateScreenDesignWithCodex({
      client,
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      screenName: "顧客検索",
      current: { pages: [] },
      requirement: "検索条件と結果一覧を作る",
    });

    expect(result).toEqual(payload);
    expect(request).toHaveBeenCalledWith("codex.turn.start", expect.objectContaining({
      threadId: "thread-1",
      outputSchema: expect.objectContaining({ required: ["pages"] }),
    }));
  });

  it("generates Puck Data with the Puck output schema", async () => {
    const payload = { root: { props: {} }, content: [{ type: "Heading", props: { id: "title", text: "顧客検索" } }] };
    const { client, request } = clientWithGeneratedText(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``);

    const result = await generateScreenDesignWithCodex({
      client,
      editorKind: "puck",
      cssFramework: "tailwind",
      current: { root: { props: {} }, content: [] },
      requirement: "検索画面を作る",
    });

    expect(result).toEqual(payload);
    expect(request).toHaveBeenCalledWith("codex.turn.start", expect.objectContaining({
      outputSchema: expect.objectContaining({ required: ["root", "content"] }),
    }));
  });

  it("mentions every built-in Puck primitive in the prompt", async () => {
    const payload = { root: { props: {} }, content: [] };
    const { client, request } = clientWithGeneratedText(JSON.stringify(payload));

    await generateScreenDesignWithCodex({
      client,
      editorKind: "puck",
      cssFramework: "tailwind",
      current: payload,
      requirement: "画面を作る",
    });

    const turnStart = request.mock.calls.find(([method]) => method === "codex.turn.start")?.[1] as {
      input: Array<{ text: string }>;
    };
    const prompt = turnStart.input[0].text;
    expect(prompt).toContain("Link");
    expect(prompt).toContain("Image");
    expect(prompt).toContain("Icon");
    expect(prompt).toContain("InputGroup");
  });

  it("unsubscribes when turn.start rejects", async () => {
    const { client, unsubscribe } = clientWithTurnStartFailure();

    await expect(generateScreenDesignWithCodex({
      client,
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      current: { pages: [] },
      requirement: "画面を作る",
    })).rejects.toThrow(/turn failed before start/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects and unsubscribes when Codex reports a failed turn", async () => {
    const { client, unsubscribe } = clientWithFailedTurn();

    await expect(generateScreenDesignWithCodex({
      client,
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      current: { pages: [] },
      requirement: "画面を作る",
    })).rejects.toThrow(/model failed/);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
