/**
 * useCodexStatus + classifyCodexError unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { CodexBrowserClient } from "./codexClient.ts";
import type { McpBridgeLike } from "./codexClient.ts";
import { useCodexStatus, classifyCodexError } from "./useCodexStatus.ts";

// ── classifyCodexError ────────────────────────────────────────────────────────

describe("classifyCodexError", () => {
  it("classifies ENOENT-like errors as no-cli", () => {
    expect(classifyCodexError(new Error("spawn codex ENOENT"))).toBe("no-cli");
    expect(classifyCodexError(new Error("codex: command not found"))).toBe("no-cli");
  });

  it("classifies transport closed / ECONNREFUSED as no-server", () => {
    expect(classifyCodexError(new Error("transport closed"))).toBe("no-server");
    expect(classifyCodexError(new Error("connect ECONNREFUSED 127.0.0.1:1234"))).toBe("no-server");
    expect(classifyCodexError(new Error("WebSocket connection closed"))).toBe("no-server");
  });

  it("classifies other errors as 'error'", () => {
    expect(classifyCodexError(new Error("internal server error"))).toBe("error");
    expect(classifyCodexError("not an error object")).toBe("error");
    expect(classifyCodexError(null)).toBe("error");
  });
});

// ── useCodexStatus ────────────────────────────────────────────────────────────

function makeMockClient(opts: {
  readResponse?: unknown;
  readError?: Error;
}) {
  const request = vi.fn();
  const broadcastHandlers = new Map<string, (data: unknown) => void>();
  const onBroadcast = vi.fn((event: string, handler: (data: unknown) => void) => {
    broadcastHandlers.set(event, handler);
    return () => broadcastHandlers.delete(event);
  });
  if (opts.readError) {
    request.mockRejectedValue(opts.readError);
  } else {
    request.mockResolvedValue(opts.readResponse);
  }
  const bridge: McpBridgeLike = { request, onBroadcast };
  const client = new CodexBrowserClient(bridge);
  return { client, request, broadcastHandlers };
}

describe("useCodexStatus", () => {
  it("transitions checking → authenticated on successful account.read", async () => {
    const { client } = makeMockClient({
      readResponse: {
        kind: "authenticated",
        account: { type: "chatgpt", email: "u@x", planType: "plus" },
      },
    });

    const { result } = renderHook(() => useCodexStatus(client));

    expect(result.current.status.kind).toBe("checking");
    await waitFor(() => expect(result.current.status.kind).toBe("authenticated"));
    if (result.current.status.kind === "authenticated") {
      expect(result.current.status.account).toEqual({
        type: "chatgpt", email: "u@x", planType: "plus",
      });
    }
  });

  it("transitions to unauthenticated when account.read returns unauthenticated", async () => {
    const { client } = makeMockClient({
      readResponse: { kind: "unauthenticated", requiresOpenaiAuth: false },
    });
    const { result } = renderHook(() => useCodexStatus(client));
    await waitFor(() => expect(result.current.status.kind).toBe("unauthenticated"));
  });

  it("classifies ENOENT spawn errors to no-cli", async () => {
    const { client } = makeMockClient({
      readError: new Error("spawn codex ENOENT"),
    });
    const { result } = renderHook(() => useCodexStatus(client));
    await waitFor(() => expect(result.current.status.kind).toBe("no-cli"));
  });

  it("classifies transport closed errors to no-server", async () => {
    const { client } = makeMockClient({
      readError: new Error("transport closed unexpectedly"),
    });
    const { result } = renderHook(() => useCodexStatus(client));
    await waitFor(() => expect(result.current.status.kind).toBe("no-server"));
  });

  it("re-fetches on account/login/completed notification", async () => {
    const { client, request, broadcastHandlers } = makeMockClient({
      readResponse: { kind: "unauthenticated", requiresOpenaiAuth: false },
    });
    const { result } = renderHook(() => useCodexStatus(client));
    await waitFor(() => expect(result.current.status.kind).toBe("unauthenticated"));

    // Switch the next read to authenticated
    request.mockResolvedValueOnce({
      kind: "authenticated",
      account: { type: "chatgpt", email: "u@x", planType: "plus" },
    });
    // Trigger broadcast
    act(() => {
      broadcastHandlers.get("codex.notification")?.({
        method: "account/login/completed",
        params: { loginId: "lid-1", success: true, error: null },
      });
    });
    await waitFor(() => expect(result.current.status.kind).toBe("authenticated"));
  });

  it("refresh() re-fetches the status", async () => {
    const { client, request } = makeMockClient({
      readResponse: { kind: "unauthenticated", requiresOpenaiAuth: false },
    });
    const { result } = renderHook(() => useCodexStatus(client));
    await waitFor(() => expect(result.current.status.kind).toBe("unauthenticated"));

    request.mockResolvedValueOnce({
      kind: "authenticated",
      account: { type: "chatgpt", email: "u@x", planType: "plus" },
    });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.status.kind).toBe("authenticated");
  });
});
