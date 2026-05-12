import { describe, expect, it, vi } from "vitest";
import { AccountManager } from "./account.js";
import type { CodexClient } from "./client.js";

function makeClient(handlers: Record<string, (params?: unknown) => Promise<unknown>>): CodexClient {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unmocked method: ${method}`);
    return handler(params);
  });
  return { request } as unknown as CodexClient;
}

describe("AccountManager", () => {
  it("readState returns authenticated when account is present", async () => {
    const client = makeClient({
      "account/read": async () => ({
        account: { type: "chatgpt", email: "u@example.com", planType: "plus" },
        requiresOpenaiAuth: false,
      }),
    });
    const mgr = new AccountManager(client);
    const state = await mgr.readState();
    expect(state.kind).toBe("authenticated");
    if (state.kind === "authenticated") {
      expect(state.account).toMatchObject({ type: "chatgpt", email: "u@example.com" });
    }
  });

  it("readState returns unauthenticated when account is null", async () => {
    const client = makeClient({
      "account/read": async () => ({ account: null, requiresOpenaiAuth: true }),
    });
    const state = await new AccountManager(client).readState();
    expect(state).toEqual({ kind: "unauthenticated", requiresOpenaiAuth: true });
  });

  it("startChatgptLogin returns auth URL and resolves on completed notification", async () => {
    const client = makeClient({
      "account/login/start": async () => ({
        type: "chatgpt",
        loginId: "L1",
        authUrl: "https://chatgpt.com/auth?token=...",
      }),
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    expect(pending.loginId).toBe("L1");
    expect(pending.authUrl).toContain("chatgpt.com");

    mgr.handleLoginCompletedNotification({ loginId: "L1", success: true, error: null });
    await expect(pending.completion).resolves.toBeUndefined();
  });

  it("rejects completion when notification reports failure", async () => {
    const client = makeClient({
      "account/login/start": async () => ({ type: "chatgpt", loginId: "L2", authUrl: "x" }),
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    mgr.handleLoginCompletedNotification({
      loginId: "L2",
      success: false,
      error: "user rejected",
    });
    await expect(pending.completion).rejects.toThrow(/user rejected/);
  });

  it("ignores notifications with unknown loginId", async () => {
    const client = makeClient({
      "account/login/start": async () => ({ type: "chatgpt", loginId: "L3", authUrl: "x" }),
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    mgr.handleLoginCompletedNotification({ loginId: "L_other", success: true, error: null });
    // pending.completion should still be unresolved; resolve manually to avoid hang
    mgr.handleLoginCompletedNotification({ loginId: "L3", success: true, error: null });
    await expect(pending.completion).resolves.toBeUndefined();
  });

  it("cancel rejects completion and calls account/login/cancel", async () => {
    const cancelled = vi.fn();
    const client = makeClient({
      "account/login/start": async () => ({ type: "chatgpt", loginId: "L4", authUrl: "x" }),
      "account/login/cancel": async (params) => {
        cancelled(params);
        return null;
      },
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    await pending.cancel();
    await expect(pending.completion).rejects.toThrow(/cancelled/);
    expect(cancelled).toHaveBeenCalledWith({ loginId: "L4" });
  });

  it("cancelChatgptLogin removes pending login and ignores later failure notification", async () => {
    const cancelled = vi.fn();
    const client = makeClient({
      "account/login/start": async () => ({ type: "chatgpt", loginId: "L4b", authUrl: "x" }),
      "account/login/cancel": async (params) => {
        cancelled(params);
        return null;
      },
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    await mgr.cancelChatgptLogin("L4b");
    mgr.handleLoginCompletedNotification({ loginId: "L4b", success: false, error: "late failure" });

    await expect(pending.completion).rejects.toThrow(/cancelled/);
    expect(cancelled).toHaveBeenCalledWith({ loginId: "L4b" });
  });

  it("readRateLimits proxies to account/rateLimits/read", async () => {
    const snapshot = { used_percent: 12.3, resets_in_seconds: 60 };
    const client = makeClient({
      "account/rateLimits/read": async () => ({
        rateLimits: snapshot,
        rateLimitsByLimitId: { codex: snapshot },
      }),
    });
    const result = await new AccountManager(client).readRateLimits();
    expect(result.rateLimits).toEqual(snapshot);
    expect(result.rateLimitsByLimitId?.codex).toEqual(snapshot);
  });

  it("abortPending rejects all in-flight logins", async () => {
    const client = makeClient({
      "account/login/start": async () => ({ type: "chatgpt", loginId: "L5", authUrl: "x" }),
    });
    const mgr = new AccountManager(client);
    const pending = await mgr.startChatgptLogin();
    mgr.abortPending(new Error("transport closed"));
    await expect(pending.completion).rejects.toThrow(/transport closed/);
  });
});
