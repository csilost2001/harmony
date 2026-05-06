import { describe, it, expect, vi } from "vitest";
import { resolveOnBehalfOfSession, logAuditIfDelegated } from "./onBehalfOfSession.js";

describe("resolveOnBehalfOfSession", () => {
  it("returns caller as both owner and actor when onBehalfOfSession omitted", () => {
    const r = resolveOnBehalfOfSession("caller-X", undefined, () => true);
    expect(r.owner).toBe("caller-X");
    expect(r.actor).toBe("caller-X");
    expect(r.isDelegated).toBe(false);
  });

  it("throws INVALID_ON_BEHALF_OF_SESSION when session not active", () => {
    expect(() =>
      resolveOnBehalfOfSession("caller-X", "human-Y", () => false),
    ).toThrow(/INVALID_ON_BEHALF_OF_SESSION/);
  });

  it("returns owner=onBehalfOf, actor=caller when active", () => {
    const r = resolveOnBehalfOfSession("ai-Y", "human-X", () => true);
    expect(r.owner).toBe("human-X");
    expect(r.actor).toBe("ai-Y");
    expect(r.isDelegated).toBe(true);
  });
});

describe("logAuditIfDelegated", () => {
  it("logs when isDelegated true", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuditIfDelegated("lock__acquire", { owner: "h", actor: "a", isDelegated: true }, "table", "t1");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[audit]"));
    spy.mockRestore();
  });

  it("does not log when isDelegated false", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAuditIfDelegated("lock__acquire", { owner: "x", actor: "x", isDelegated: false }, "table", "t1");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
