/**
 * CodexBrowserClient unit tests.
 *
 * mcpBridge is injected as a mock — no real WebSocket connection is made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexBrowserClient } from "./codexClient.ts";
import type { McpBridgeLike } from "./codexClient.ts";

// ── Factory: fresh mock bridge + client per test ──────────────────────────────

function makeMocks() {
  const request = vi.fn().mockResolvedValue(undefined);
  const onBroadcast = vi.fn().mockReturnValue(() => {/* unsubscribe */});
  const bridge: McpBridgeLike = { request, onBroadcast };
  const client = new CodexBrowserClient(bridge);
  return { request, onBroadcast, bridge, client };
}

// ── account.read ──────────────────────────────────────────────────────────────

describe("account.read", () => {
  it("calls codex.account.read with no params", async () => {
    const { request, client } = makeMocks();
    const state = { kind: "unauthenticated", requiresOpenaiAuth: false };
    request.mockResolvedValueOnce(state);

    const result = await client.account.read();

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("codex.account.read");
    expect(result).toEqual(state);
  });
});

// ── account.startChatgptLogin ─────────────────────────────────────────────────

describe("account.startChatgptLogin", () => {
  it("calls codex.account.login.start with no params and returns loginId + authUrl", async () => {
    const { request, client } = makeMocks();
    const payload = { loginId: "lid-1", authUrl: "https://chatgpt.com/auth" };
    request.mockResolvedValueOnce(payload);

    const result = await client.account.startChatgptLogin();

    expect(request).toHaveBeenCalledWith("codex.account.login.start");
    expect(result).toEqual(payload);
  });
});

// ── account.cancelChatgptLogin ────────────────────────────────────────────────

describe("account.cancelChatgptLogin", () => {
  it("calls codex.account.login.cancel with { loginId }", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce(undefined);

    await client.account.cancelChatgptLogin("lid-1");

    expect(request).toHaveBeenCalledWith("codex.account.login.cancel", {
      loginId: "lid-1",
    });
  });
});

// ── account.logout ────────────────────────────────────────────────────────────

describe("account.logout", () => {
  it("calls codex.account.logout with no params", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce(undefined);

    await client.account.logout();

    expect(request).toHaveBeenCalledWith("codex.account.logout");
  });
});

// ── account.rateLimits ────────────────────────────────────────────────────────

describe("account.rateLimits", () => {
  it("calls codex.account.rateLimits.read with no params", async () => {
    const { request, client } = makeMocks();
    const payload = {
      rateLimits: { limitId: "codex", limitName: "Codex", primary: null, secondary: null, credits: null, planType: "plus", rateLimitReachedType: null },
      rateLimitsByLimitId: null,
    };
    request.mockResolvedValueOnce(payload);

    const result = await client.account.rateLimits();

    expect(request).toHaveBeenCalledWith("codex.account.rateLimits.read");
    expect(result).toEqual(payload);
  });
});

// ── turn.start / steer / interrupt ───────────────────────────────────────────

describe("turn", () => {
  it("turn.start calls codex.turn.start with params", async () => {
    const { request, client } = makeMocks();
    const params = { message: "hello" };
    request.mockResolvedValueOnce({ turnId: "t1" });

    const result = await client.turn.start(params);

    expect(request).toHaveBeenCalledWith("codex.turn.start", params);
    expect(result).toEqual({ turnId: "t1" });
  });

  it("turn.steer calls codex.turn.steer with params", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce(undefined);

    await client.turn.steer({ newInput: "revised" });

    expect(request).toHaveBeenCalledWith("codex.turn.steer", { newInput: "revised" });
  });

  it("turn.interrupt calls codex.turn.interrupt with params", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce(undefined);

    await client.turn.interrupt({ reason: "user_requested" });

    expect(request).toHaveBeenCalledWith("codex.turn.interrupt", { reason: "user_requested" });
  });
});

// ── thread.start / resume ─────────────────────────────────────────────────────

describe("thread", () => {
  it("thread.start calls codex.thread.start with params", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce({ threadId: "th1" });

    const result = await client.thread.start({ workspaceId: "ws1" });

    expect(request).toHaveBeenCalledWith("codex.thread.start", { workspaceId: "ws1" });
    expect(result).toEqual({ threadId: "th1" });
  });

  it("thread.resume calls codex.thread.resume with params", async () => {
    const { request, client } = makeMocks();
    request.mockResolvedValueOnce({ resumed: true });

    const result = await client.thread.resume({ threadId: "th1" });

    expect(request).toHaveBeenCalledWith("codex.thread.resume", { threadId: "th1" });
    expect(result).toEqual({ resumed: true });
  });
});

// ── model.list ────────────────────────────────────────────────────────────────

describe("model.list", () => {
  it("calls codex.model.list with no params", async () => {
    const { request, client } = makeMocks();
    const payload = { data: [{ id: "o4-mini", displayName: "o4-mini" }], nextCursor: null };
    request.mockResolvedValueOnce(payload);

    const result = await client.model.list();

    expect(request).toHaveBeenCalledWith("codex.model.list");
    expect(result).toEqual(payload);
  });
});

// ── subscribeNotification ─────────────────────────────────────────────────────

describe("subscribeNotification", () => {
  it("calls onBroadcast with 'codex.notification' and forwards notification to handler", () => {
    const { onBroadcast, client } = makeMocks();

    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    const notifHandler = vi.fn();
    client.subscribeNotification(notifHandler);

    expect(onBroadcast).toHaveBeenCalledOnce();
    expect(onBroadcast).toHaveBeenCalledWith("codex.notification", expect.any(Function));

    const notification = { method: "turn/delta", params: { text: "hello" } };
    capturedBroadcastHandler(notification);

    expect(notifHandler).toHaveBeenCalledOnce();
    expect(notifHandler).toHaveBeenCalledWith(notification);
  });

  it("returns unsubscribe function that cleans up the broadcast subscription", () => {
    const { onBroadcast, client } = makeMocks();
    const unsub = vi.fn();
    onBroadcast.mockReturnValueOnce(unsub);

    const unsubscribe = client.subscribeNotification(vi.fn());
    unsubscribe();

    expect(unsub).toHaveBeenCalledOnce();
  });
});

// ── subscribeServerRequest ────────────────────────────────────────────────────

describe("subscribeServerRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("registers onBroadcast for 'codex.serverRequest' on first subscribe", () => {
    const { onBroadcast, client } = makeMocks();

    client.subscribeServerRequest(vi.fn());

    expect(onBroadcast).toHaveBeenCalledOnce();
    expect(onBroadcast).toHaveBeenCalledWith(
      "codex.serverRequest",
      expect.any(Function),
    );
  });

  it("handler called → respond with result", async () => {
    const { request, onBroadcast, client } = makeMocks();
    request.mockResolvedValue(undefined);

    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    const handler = vi.fn().mockResolvedValue({ approved: true });
    client.subscribeServerRequest(handler);

    const req = { id: "req-1", method: "exec/apply", params: { cmd: "ls" } };
    capturedBroadcastHandler(req);

    // flush microtasks
    await vi.runAllTimersAsync();

    expect(handler).toHaveBeenCalledWith(req);
    expect(request).toHaveBeenCalledWith("codex.serverRequest.respond", {
      requestId: "req-1",
      result: { approved: true },
    });
  });

  it("handler throws → respond with error", async () => {
    const { request, onBroadcast, client } = makeMocks();
    request.mockResolvedValue(undefined);

    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    const err = new Error("Permission denied");
    client.subscribeServerRequest(vi.fn().mockRejectedValue(err));

    capturedBroadcastHandler({ id: "req-2", method: "exec/apply", params: {} });
    await vi.runAllTimersAsync();

    expect(request).toHaveBeenCalledWith("codex.serverRequest.respond", {
      requestId: "req-2",
      error: { code: -32000, message: "Permission denied" },
    });
  });

  it("handler throws Error with custom code → uses that code", async () => {
    const { request, onBroadcast, client } = makeMocks();
    request.mockResolvedValue(undefined);

    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    const err = Object.assign(new Error("Custom"), { code: -32001 });
    client.subscribeServerRequest(vi.fn().mockRejectedValue(err));

    capturedBroadcastHandler({ id: "req-3", method: "patch/apply", params: {} });
    await vi.runAllTimersAsync();

    expect(request).toHaveBeenCalledWith("codex.serverRequest.respond", {
      requestId: "req-3",
      error: { code: -32001, message: "Custom" },
    });
  });

  it("null handler → console.warn only, no respond call", async () => {
    const { request, onBroadcast, client } = makeMocks();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Register first so onBroadcast fires, then set null
    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    client.subscribeServerRequest(vi.fn()); // initial registration
    client.subscribeServerRequest(null);    // clear

    capturedBroadcastHandler({ id: "req-4", method: "exec/apply", params: {} });
    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("multiple subscribe calls → onBroadcast called only once (lazy singleton)", () => {
    const { onBroadcast, client } = makeMocks();

    client.subscribeServerRequest(vi.fn());
    client.subscribeServerRequest(vi.fn());
    client.subscribeServerRequest(vi.fn());

    expect(onBroadcast).toHaveBeenCalledOnce();
  });

  it("handler replaced by second subscribe → only latest handler is invoked", async () => {
    const { request, onBroadcast, client } = makeMocks();
    request.mockResolvedValue(undefined);

    let capturedBroadcastHandler!: (data: unknown) => void;
    onBroadcast.mockImplementationOnce((_event: string, h: (data: unknown) => void) => {
      capturedBroadcastHandler = h;
      return () => {};
    });

    const firstHandler = vi.fn().mockResolvedValue("first");
    const secondHandler = vi.fn().mockResolvedValue("second");

    client.subscribeServerRequest(firstHandler);
    client.subscribeServerRequest(secondHandler); // replaces firstHandler

    capturedBroadcastHandler({ id: "req-5", method: "exec/apply", params: {} });
    await vi.runAllTimersAsync();

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("codex.serverRequest.respond", {
      requestId: "req-5",
      result: "second",
    });
  });
});
