import { describe, expect, it } from "vitest";
import { loadCodexConfig } from "./config.js";

describe("loadCodexConfig", () => {
  it("defaults to spawn transport (codex app-server)", () => {
    const cfg = loadCodexConfig({});
    expect(cfg.transport).toBe("spawn");
    expect(cfg.spawn.command).toBe("codex");
    expect(cfg.spawn.args).toEqual(["app-server"]);
    expect(cfg.websocket).toBeNull();
  });

  it("uses websocket transport when HARMONY_CODEX_TRANSPORT=websocket and URL set", () => {
    const cfg = loadCodexConfig({
      HARMONY_CODEX_TRANSPORT: "websocket",
      HARMONY_CODEX_WS_URL: "ws://127.0.0.1:4500",
      HARMONY_CODEX_WS_AUTH_TOKEN: "secret",
    });
    expect(cfg.transport).toBe("websocket");
    expect(cfg.websocket).toEqual({
      url: "ws://127.0.0.1:4500",
      authToken: "secret",
    });
  });

  it("treats HARMONY_CODEX_TRANSPORT=ws as websocket alias", () => {
    const cfg = loadCodexConfig({
      HARMONY_CODEX_TRANSPORT: "ws",
      HARMONY_CODEX_WS_URL: "ws://localhost:1/",
    });
    expect(cfg.transport).toBe("websocket");
  });

  it("respects HARMONY_CODEX_SPAWN_COMMAND and ARGS overrides", () => {
    const cfg = loadCodexConfig({
      HARMONY_CODEX_SPAWN_COMMAND: "/usr/bin/codex",
      HARMONY_CODEX_SPAWN_ARGS: "app-server --listen stdio://",
    });
    expect(cfg.spawn.command).toBe("/usr/bin/codex");
    expect(cfg.spawn.args).toEqual(["app-server", "--listen", "stdio://"]);
  });

  it("returns websocket=null when transport=spawn even if WS_URL is set", () => {
    const cfg = loadCodexConfig({
      HARMONY_CODEX_TRANSPORT: "spawn",
      HARMONY_CODEX_WS_URL: "ws://127.0.0.1:4500",
    });
    expect(cfg.transport).toBe("spawn");
    expect(cfg.websocket).toEqual({ url: "ws://127.0.0.1:4500" });
  });
});
