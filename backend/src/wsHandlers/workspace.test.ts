import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workspaceHandlers } from "./workspace.js";
import { upsertWorkspaceRoot } from "../recentStore.js";
import { initWorkspaceState, _resetForTest as resetWorkspaceState } from "../workspaceState.js";
import type { RpcContext } from "./types.js";

const TMP_ROOT = path.join(os.tmpdir(), `workspace-handler-test-${process.pid}-${Date.now()}`);
const ORIGINAL_RECENT_FILE = process.env.DESIGNER_RECENT_FILE;
const ORIGINAL_DATA_DIR = process.env.DESIGNER_DATA_DIR;

function makeContext(params: unknown = {}): {
  ctx: RpcContext;
  getResponse: () => unknown;
  getError: () => string | null;
} {
  let response: unknown;
  let error: string | null = null;
  const ctx = {
    params,
    clientId: "test-client",
    root: () => TMP_ROOT,
    wsId: () => null,
    respond: (result: unknown) => { response = result; },
    respondError: (message: string) => { error = message; },
    bridge: {} as RpcContext["bridge"],
  };
  return { ctx, getResponse: () => response, getError: () => error };
}

beforeEach(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  process.env.DESIGNER_RECENT_FILE = path.join(TMP_ROOT, "recent-workspaces.json");
  delete process.env.DESIGNER_DATA_DIR;
  resetWorkspaceState();
});

afterEach(async () => {
  resetWorkspaceState();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  if (ORIGINAL_RECENT_FILE === undefined) {
    delete process.env.DESIGNER_RECENT_FILE;
  } else {
    process.env.DESIGNER_RECENT_FILE = ORIGINAL_RECENT_FILE;
  }
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DESIGNER_DATA_DIR;
  } else {
    process.env.DESIGNER_DATA_DIR = ORIGINAL_DATA_DIR;
  }
});

describe("workspace root RPC lockdown behavior", () => {
  it("workspace.roots returns empty roots in lockdown even when roots are registered", async () => {
    await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    process.env.DESIGNER_DATA_DIR = path.join(TMP_ROOT, "locked");
    initWorkspaceState();

    const { ctx, getResponse, getError } = makeContext();
    await workspaceHandlers["workspace.roots"](ctx);

    expect(getError()).toBeNull();
    expect(getResponse()).toEqual({ roots: [] });
  });

  it("workspace.root.discover is rejected before rootId lookup in lockdown", async () => {
    const root = await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    process.env.DESIGNER_DATA_DIR = path.join(TMP_ROOT, "locked");
    initWorkspaceState();

    const { ctx, getResponse, getError } = makeContext({ rootId: root.id });
    await workspaceHandlers["workspace.root.discover"](ctx);

    expect(getResponse()).toBeUndefined();
    expect(getError()).toMatch(/lockdown/);
  });
});
