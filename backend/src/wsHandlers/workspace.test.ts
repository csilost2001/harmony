import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workspaceHandlers } from "./workspace.js";
import { upsertWorkspace, upsertWorkspaceRoot, readRecent } from "../recentStore.js";
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

  it("復元の open (restore: true) は、接続の作業先だけ決めて、最後に開いたワークスペース (AI の作業先) を変えない。明示的な open は変える", async () => {
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
    const openA = makeOpenContext({ path: path.join(TMP_ROOT, "proj-a"), init: true });
    await workspaceHandlers["workspace.open"](openA.ctx);
    const a = (openA.getResponse() as { active: { id: string; path: string } }).active;
    const openB = makeOpenContext({ path: path.join(TMP_ROOT, "proj-b"), init: true });
    await workspaceHandlers["workspace.open"](openB.ctx);
    const b = (openB.getResponse() as { active: { id: string; path: string } }).active;
    expect(getGlobalDefaultPath()).toBe(path.resolve(b.path));
    const lastActiveBefore = (await readRecent()).lastActiveId;

    // 古いタブが A を復元しても、既定 (B) は動かない。そのタブの作業先は A になる
    workspaceContextManager.connect("old-tab");
    const restore = makeOpenContext({ id: a.id, restore: true });
    restore.ctx.clientId = "old-tab";
    await workspaceHandlers["workspace.open"](restore.ctx);
    expect(restore.getError()).toBeNull();
    expect(workspaceContextManager.getActivePath("old-tab")).toBe(path.resolve(a.path));
    expect(getGlobalDefaultPath()).toBe(path.resolve(b.path));
    expect((await readRecent()).lastActiveId).toBe(lastActiveBefore);

    // 利用者が明示的に開いたときは、既定も動く
    const explicit = makeOpenContext({ id: a.id });
    explicit.ctx.clientId = "old-tab";
    await workspaceHandlers["workspace.open"](explicit.ctx);
    expect(getGlobalDefaultPath()).toBe(path.resolve(a.path));
    expect((await readRecent()).lastActiveId).toBe(a.id);
  });

  it("復元の open は、既定 (最後に開いたワークスペース) が空のときだけ既定を埋める。既定があるときは変えない", async () => {
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
    const openA = makeOpenContext({ path: path.join(TMP_ROOT, "proj-a"), init: true });
    await workspaceHandlers["workspace.open"](openA.ctx);
    const a = (openA.getResponse() as { active: { id: string; path: string } }).active;
    const openB = makeOpenContext({ path: path.join(TMP_ROOT, "proj-b"), init: true });
    await workspaceHandlers["workspace.open"](openB.ctx);
    const b = (openB.getResponse() as { active: { id: string; path: string } }).active;

    // B を閉じて既定を空にする。別のタブは A を見ている
    const close = makeOpenContext({});
    await workspaceHandlers["workspace.close"](close.ctx);
    expect(getGlobalDefaultPath()).toBeNull();

    workspaceContextManager.connect("old-tab");
    const restoreA = makeOpenContext({ id: a.id, restore: true });
    restoreA.ctx.clientId = "old-tab";
    await workspaceHandlers["workspace.open"](restoreA.ctx);
    expect(restoreA.getError()).toBeNull();
    expect(getGlobalDefaultPath()).toBe(path.resolve(a.path));
    expect((await readRecent()).lastActiveId).toBe(a.id);

    // 既定があるあとの復元は、変えない
    const restoreB = makeOpenContext({ id: b.id, restore: true });
    restoreB.ctx.clientId = "old-tab";
    await workspaceHandlers["workspace.open"](restoreB.ctx);
    expect(workspaceContextManager.getActivePath("old-tab")).toBe(path.resolve(b.path));
    expect(getGlobalDefaultPath()).toBe(path.resolve(a.path));
    expect((await readRecent()).lastActiveId).toBe(a.id);
  });

  it("workspace.close は、閉じるのが既定 (最後に開いたワークスペース) と同じときだけ、既定を外す", async () => {
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
    const openA = makeOpenContext({ path: path.join(TMP_ROOT, "proj-a"), init: true });
    await workspaceHandlers["workspace.open"](openA.ctx);
    const a = (openA.getResponse() as { active: { id: string; path: string } }).active;
    const openB = makeOpenContext({ path: path.join(TMP_ROOT, "proj-b"), init: true });
    await workspaceHandlers["workspace.open"](openB.ctx);
    const b = (openB.getResponse() as { active: { id: string; path: string } }).active;

    // 別のタブが A を開いている。そのタブが閉じても、既定 (B) は残る
    workspaceContextManager.connect("tab-a");
    workspaceContextManager.setActivePath("tab-a", a.path);
    const closeA = makeOpenContext({});
    closeA.ctx.clientId = "tab-a";
    await workspaceHandlers["workspace.close"](closeA.ctx);
    expect(getGlobalDefaultPath()).toBe(path.resolve(b.path));
    expect((await readRecent()).lastActiveId).toBe(b.id);

    // 既定と同じ B を閉じたら、既定も外れる
    const closeB = makeOpenContext({});
    await workspaceHandlers["workspace.close"](closeB.ctx);
    expect(getGlobalDefaultPath()).toBeNull();
    expect((await readRecent()).lastActiveId).toBeNull();
  });

  it("旧形式の項目だけが原因の harmony.json も、画面の workspace.open で開ける (ダッシュボードの修復で直す)。ほかの不正は断る", async () => {
    initWorkspaceState();
    workspaceContextManager.connect("test-client");
    const dir = path.join(TMP_ROOT, "proj-legacy");
    const init = makeOpenContext({ path: dir, init: true });
    await workspaceHandlers["workspace.open"](init.ctx);
    const file = path.join(dir, "harmony.json");
    const json = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    await fs.writeFile(file, JSON.stringify({ ...json, tables: [], updatedAt: "2026-01-01T00:00:00Z" }));
    workspaceContextManager.clearActive("test-client");

    const open = makeOpenContext({ path: dir });
    await workspaceHandlers["workspace.open"](open.ctx);
    expect(open.getError()).toBeNull();
    expect(workspaceContextManager.getActivePath("test-client")).toBe(path.resolve(dir));

    // 旧形式でない不正 (未知の項目) は、これまでどおり断る
    await fs.writeFile(file, JSON.stringify({ ...json, unknownKey: 1 }));
    workspaceContextManager.clearActive("test-client");
    const bad = makeOpenContext({ path: dir });
    await workspaceHandlers["workspace.open"](bad.ctx);
    expect(bad.getError()).toMatch(/不正/);
  });
});
