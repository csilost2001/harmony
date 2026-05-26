import { describe, it, expect } from "vitest";
import { tempWorkspacePath } from "./realWorkspace.ts";

describe("tempWorkspacePath worker isolation (#1356)", () => {
  it("includes the worker index prefix so workers > 1 do not collide on the same key", () => {
    const p = tempWorkspacePath("sample-key");
    expect(p).toMatch(/[\\/]\.tmp[\\/]e2e-workspaces[\\/]w\d+-sample-key$/);
  });

  it("defaults to w0 when TEST_WORKER_INDEX is unset (sequential / Vitest)", () => {
    const before = process.env.TEST_WORKER_INDEX;
    delete process.env.TEST_WORKER_INDEX;
    try {
      const p = tempWorkspacePath("k");
      expect(p.endsWith("w0-k")).toBe(true);
    } finally {
      if (before !== undefined) process.env.TEST_WORKER_INDEX = before;
    }
  });
});
