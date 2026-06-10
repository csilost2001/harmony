import { afterEach, describe, expect, it, vi } from "vitest";
import { backendOrigin, backendWebSocketUrl } from "./backendEndpoint";

const originalLocation = window.location;

function setLocation(hostname: string, port: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      hostname,
      port,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("backendEndpoint", () => {
  it("uses 5179 by default so Vite dev frontend keeps talking to the backend", () => {
    setLocation("localhost", "5180");

    expect(backendOrigin()).toBe("http://localhost:5179");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5179");
  });

  it("uses the current page port when packaged same-port mode is enabled", () => {
    vi.stubEnv("VITE_HARMONY_SAME_PORT", "1");
    setLocation("localhost", "5180");

    expect(backendOrigin()).toBe("http://localhost:5180");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5180");
  });

  it("uses VITE_DESIGNER_MCP_PORT when explicitly configured", () => {
    vi.stubEnv("VITE_HARMONY_SAME_PORT", "1");
    vi.stubEnv("VITE_DESIGNER_MCP_PORT", "5199");
    setLocation("localhost", "5180");

    expect(backendOrigin()).toBe("http://localhost:5199");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5199");
  });

  it("falls back to 5179 when the current page has no explicit port", () => {
    vi.stubEnv("VITE_HARMONY_SAME_PORT", "1");
    setLocation("localhost", "");

    expect(backendOrigin()).toBe("http://localhost:5179");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5179");
  });
});
