import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 並べて表示の右ペイン (iframe) は、左のアプリと sessionStorage を共有する。接続の ID が同じだと、別の接続が同じ利用者として混ざるので、
 * 右ペイン (URL に ?pane=1) は、別の ID を持つ。
 */
describe("mcpBridge の接続 ID", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });
  afterEach(() => { window.history.replaceState({}, "", "/"); });

  it("右ペインは、左のアプリと別の ID を持ち、それぞれ sessionStorage に残る", async () => {
    const { mcpBridge: left } = await import("./mcpBridge");
    const leftId = left.getSessionId();
    window.history.replaceState({}, "", "/w/ws1/?pane=1");
    vi.resetModules();
    const { mcpBridge: right } = await import("./mcpBridge");
    const rightId = right.getSessionId();
    expect(rightId).not.toBe(leftId);
    expect(sessionStorage.getItem("harmony-client-id")).toBe(leftId);
    expect(sessionStorage.getItem("harmony-client-id-pane")).toBe(rightId);
  });

  it("右ペインを開き直しても (再読み込み)、右ペインの ID は変わらない", async () => {
    window.history.replaceState({}, "", "/w/ws1/?pane=1");
    const { mcpBridge: a } = await import("./mcpBridge");
    const first = a.getSessionId();
    vi.resetModules();
    const { mcpBridge: b } = await import("./mcpBridge");
    expect(b.getSessionId()).toBe(first);
  });
});
