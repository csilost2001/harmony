import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workspaceHandlers } from "./workspace.js";
import { upsertWorkspace, upsertWorkspaceRoot } from "../recentStore.js";
import {
  initWorkspaceState,
  workspaceContextManager,
  getGlobalDefaultPath,
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
  await fs.rm(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

describe("新しい接続の既定のワークスペースは、最後に開いたワークスペースに合わせる", () => {
  function makeOpenContext(params: unknown): ReturnType<typeof makeContext> {
    const made = makeContext(params);
    made.ctx.bridge = { broadcast: () => {}, deleteEditSessionStoreForWorkspace: () => {} } as unknown as RpcContext["bridge"];
    return made;
  }

  it("開く・閉じる・外すで、既定が最後に開いたワークスペースと一致する (すでに開いている接続の作業先は変えない)", async () => {
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
    const dirA = path.join(TMP_ROOT, "proj-a");
    const dirB = path.join(TMP_ROOT, "proj-b");

    const openA = makeOpenContext({ path: dirA, init: true });
    await workspaceHandlers["workspace.open"](openA.ctx);
    expect(openA.getError()).toBeNull();
    const a = (openA.getResponse() as { active: { id: string; path: string } }).active;
    expect(getGlobalDefaultPath()).toBe(path.resolve(a.path));

    const openB = makeOpenContext({ path: dirB, init: true });
    await workspaceHandlers["workspace.open"](openB.ctx);
    const b = (openB.getResponse() as { active: { id: string; path: string } }).active;
    expect(getGlobalDefaultPath()).toBe(path.resolve(b.path));

    // 別のタブ (すでに開いている接続) の作業先は変わらない
    workspaceContextManager.connect("other-tab");
    expect(workspaceContextManager.getActivePath("other-tab")).toBe(path.resolve(b.path));
    workspaceContextManager.setActivePath("other-tab", a.path);

    // 最後に開いたワークスペースを recent から外すと、既定も外れる。接続の作業先は変えない
    const removeB = makeContext({ id: b.id });
    await workspaceHandlers["workspace.remove"](removeB.ctx);
    expect(removeB.getResponse()).toEqual({ removed: true });
    expect(getGlobalDefaultPath()).toBeNull();
    expect(workspaceContextManager.getActivePath("other-tab")).toBe(path.resolve(a.path));

    // 最後に開いたものではないワークスペースを外しても、既定はそのまま
    const openA2 = makeOpenContext({ path: dirA });
    await workspaceHandlers["workspace.open"](openA2.ctx);
    expect(getGlobalDefaultPath()).toBe(path.resolve(a.path));
    const openC = makeOpenContext({ path: path.join(TMP_ROOT, "proj-c"), init: true });
    await workspaceHandlers["workspace.open"](openC.ctx);
    const c = (openC.getResponse() as { active: { id: string; path: string } }).active;
    const removeA = makeContext({ id: a.id });
    await workspaceHandlers["workspace.remove"](removeA.ctx);
    expect(getGlobalDefaultPath()).toBe(path.resolve(c.path));

    // 閉じると既定も外れる
    const close = makeOpenContext({});
    await workspaceHandlers["workspace.close"](close.ctx);
    expect(getGlobalDefaultPath()).toBeNull();
  });
});
