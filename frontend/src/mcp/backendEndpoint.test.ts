import { afterEach, describe, expect, it } from "vitest";
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
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("backendEndpoint", () => {
  it("uses the current page port when VITE_DESIGNER_MCP_PORT is not set", () => {
    setLocation("localhost", "5180");

    expect(backendOrigin()).toBe("http://localhost:5180");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5180");
  });

  it("falls back to 5179 when the current page has no explicit port", () => {
    setLocation("localhost", "");

    expect(backendOrigin()).toBe("http://localhost:5179");
    expect(backendWebSocketUrl()).toBe("ws://localhost:5179");
  });
});
