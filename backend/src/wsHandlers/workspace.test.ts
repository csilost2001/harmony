import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workspaceHandlers } from "./workspace.js";
import { upsertWorkspace, upsertWorkspaceRoot } from "../recentStore.js";
import {
  initWorkspaceState,
  workspaceContextManager,
  _resetForTest as resetWorkspaceState,
} from "../workspaceState.js";
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
  vi.restoreAllMocks();
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
  function enterLockdown(): void {
    process.env.DESIGNER_DATA_DIR = path.join(TMP_ROOT, "locked");
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
  }

  it("workspace.roots returns empty roots in lockdown without reading recent", async () => {
    await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    const { ctx, getResponse, getError } = makeContext();
    await workspaceHandlers["workspace.roots"](ctx);

    expect(getError()).toBeNull();
    expect(getResponse()).toEqual({ roots: [] });
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it("workspace.root.discover is rejected before rootId lookup in lockdown without reading recent", async () => {
    const root = await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    const { ctx, getResponse, getError } = makeContext({ rootId: root.id });
    await workspaceHandlers["workspace.root.discover"](ctx);

    expect(getResponse()).toBeUndefined();
    expect(getError()).toMatch(/lockdown/);
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it("workspace.open rejects path before filesystem inspect in lockdown", async () => {
    enterLockdown();
    const accessSpy = vi.spyOn(fs, "access");

    const { ctx, getResponse, getError } = makeContext({ path: path.join(TMP_ROOT, "missing-project") });
    await workspaceHandlers["workspace.open"](ctx);

    expect(getResponse()).toBeUndefined();
    expect(getError()).toMatch(/固定モード.*切り替え/);
    expect(getError()).not.toMatch(/フォルダが見つかりません/);
    expect(accessSpy).not.toHaveBeenCalled();
    accessSpy.mockRestore();
  });

  it("workspace.open rejects id before recent lookup in lockdown", async () => {
    const entry = await upsertWorkspace(path.join(TMP_ROOT, "existing-project"), "Existing");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    const { ctx, getResponse, getError } = makeContext({ id: entry.id });
    await workspaceHandlers["workspace.open"](ctx);

    expect(getResponse()).toBeUndefined();
    expect(getError()).toMatch(/固定モード.*切り替え/);
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it("workspace.list/status use lockdown active payload without reading recent", async () => {
    await upsertWorkspaceRoot(path.join(TMP_ROOT, "projects"), "Projects");
    enterLockdown();
    const readSpy = vi.spyOn(fs, "readFile");

    const list = makeContext();
    await workspaceHandlers["workspace.list"](list.ctx);
    expect(list.getResponse()).toEqual({
      workspaces: [],
      lastActiveId: null,
      active: {
        id: "lockdown",
        path: path.resolve(process.env.DESIGNER_DATA_DIR!),
        name: null,
      },
      lockdown: true,
      lockdownPath: path.resolve(process.env.DESIGNER_DATA_DIR!),
    });

    const status = makeContext();
    await workspaceHandlers["workspace.status"](status.ctx);
    expect(status.getResponse()).toEqual({
      active: {
        path: path.resolve(process.env.DESIGNER_DATA_DIR!),
        name: null,
      },
      lockdown: true,
      lockdownPath: path.resolve(process.env.DESIGNER_DATA_DIR!),
    });
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });
});
