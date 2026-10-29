import { describe, expect, it, vi, afterAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { renameEntityId, _clearUndoStoreForTest } from "../renameEntity.js";
import { harmonyFile, ensureDataDir, writeTable } from "../projectStorage.js";
import { refactorHandlers, runEntityRename, runEntityUndo } from "./refactor.js";
import type { WsBridge } from "../wsBridge.js";

const TMP_ROOT = path.join(os.tmpdir(), `refactor-handler-test-${process.pid}-${Date.now()}`);
let workspaceCounter = 0;

async function makeWorkspace(): Promise<string> {
  const root = path.join(TMP_ROOT, `ws-${++workspaceCounter}`);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(harmonyFile(root), JSON.stringify({
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: { id: "test", name: "test", createdAt: "x", updatedAt: "x" },
    extensionsApplied: [],
    entities: {},
  }), "utf-8");
  await ensureDataDir(root, "harmony");
  return root;
}

beforeEach(() => {
  _clearUndoStoreForTest();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
});

describe("undoEntityRename RPC — Phase K workspace ownership", () => {
  it("active workspace が変わっても operation 所有 workspace で undo/migration/broadcast する", async () => {
    const operationRoot = await makeWorkspace();
    const currentRoot = await makeWorkspace();
    await writeTable("before", { id: "before", name: "before", columns: [] }, operationRoot);
    const { operation } = await renameEntityId("table", "before", "after", operationRoot, {
      migrateEditSessions: async () => [
        { editSessionId: "es-forward", oldResourceId: "before", newResourceId: "after" },
      ],
    });

    const bridge = {
      editSessionMigrateResourceId: vi.fn().mockResolvedValue({ migrated: [], warnings: [] }),
      broadcast: vi.fn(),
    } as unknown as WsBridge;
    const responses: unknown[] = [];
    const errors: string[] = [];

    await refactorHandlers.undoEntityRename({
      params: { operationId: operation.operationId },
      clientId: "client-a",
      root: () => currentRoot,
      wsId: () => currentRoot,
      respond: (result) => responses.push(result),
      respondError: (error) => errors.push(error),
      bridge,
    });

    expect(errors).toEqual([]);
    expect(responses).toHaveLength(1);
    expect(vi.mocked(bridge.editSessionMigrateResourceId)).toHaveBeenCalledWith(
      operationRoot, "table", "after", "table", "before", ["es-forward"],
    );
    for (const call of vi.mocked(bridge.broadcast).mock.calls) {
      expect(call[0].wsId).toBe(operationRoot);
    }
    await fs.access(path.join(operationRoot, "harmony", "tables", "before.json"));
  });
});

describe("listRecentUndoOperations RPC — Phase L frontend restoration", () => {
  it("reload 後に current workspace の TTL 内 operation metadata を問い合わせられる", async () => {
    const root = await makeWorkspace();
    await writeTable("before", { id: "before", name: "before", columns: [] }, root);
    const { operation } = await renameEntityId("table", "before", "after", root);
    const responses: unknown[] = [];
    const errors: string[] = [];

    expect(refactorHandlers.listRecentUndoOperations).toBeTypeOf("function");
    await refactorHandlers.listRecentUndoOperations!({
      params: {},
      clientId: "client-a",
      root: () => root,
      wsId: () => root,
      respond: (result) => responses.push(result),
      respondError: (error) => errors.push(error),
      bridge: {} as WsBridge,
    });

    expect(errors).toEqual([]);
    expect(responses).toEqual([expect.arrayContaining([
      expect.objectContaining({
        operationId: operation.operationId,
        entityType: "table",
        oldId: "before",
        newId: "after",
        remainingTtlMs: expect.any(Number),
      }),
    ])]);
  });
});

describe("runEntityRename / runEntityUndo (MCP と共通) — 編集セッションの移行と通知先", () => {
  it("改名で編集セッションの対象 ID を新 ID へ移し、undo で元の ID へ戻す。undo の通知は operation の持ち主のワークスペースへ", async () => {
    const operationRoot = await makeWorkspace();
    const currentRoot = await makeWorkspace();
    await writeTable("before", { id: "before", name: "before", columns: [] }, operationRoot);
    const migrate = vi.fn().mockResolvedValue({ migrated: [{ editSessionId: "es-1", oldResourceId: "before", newResourceId: "after", resourceType: "table" }], warnings: [] });
    const bridge = {
      editSessionListByResource: vi.fn().mockReturnValue([]),
      editSessionMigrateResourceId: migrate,
      broadcast: vi.fn(),
    } as unknown as WsBridge;

    const renamed = await runEntityRename(bridge, operationRoot, "table", "before", "after", operationRoot, "mcp-session");
    renamed.broadcastReload();
    expect(migrate).toHaveBeenCalledWith(operationRoot, "table", "before", "table", "after", undefined);

    migrate.mockClear();
    vi.mocked(bridge.broadcast).mockClear();
    // 別のワークスペースが開いている状態で undo する (MCP の現在のワークスペース = currentRoot)
    const undone = await runEntityUndo(bridge, renamed.result.operation.operationId, currentRoot, "mcp-session");
    undone.broadcastReload();
    expect(migrate).toHaveBeenCalledWith(operationRoot, "table", "after", "table", "before", ["es-1"]);
    expect(vi.mocked(bridge.broadcast).mock.calls.length).toBeGreaterThan(0);
    for (const call of vi.mocked(bridge.broadcast).mock.calls) expect(call[0].wsId).toBe(operationRoot);
    await fs.access(path.join(operationRoot, "harmony", "tables", "before.json"));
  });
});

describe("runEntityRename / runEntityUndo — 運用の記録 (承認・コメント) の id の追従", () => {
  it("改名すると、承認とレビューコメントの対象の id も新しい id になり、取り消すと戻る", async () => {
    const { approvalsStore, commentsStore } = await import("../ops/stores.js");
    const root = await makeWorkspace();
    await writeTable("before", { id: "before", name: "before", columns: [] }, root);
    const bridge = { editSessionListByResource: vi.fn().mockReturnValue([]), editSessionMigrateResourceId: vi.fn().mockResolvedValue({ migrated: [], warnings: [] }), broadcast: vi.fn() } as unknown as WsBridge;
    await approvalsStore.update(root, () => ({ version: 1, items: [{ kind: "table", id: "before", state: "review", history: [] }] }) as never);
    await commentsStore.update(root, () => ({ version: 1, threads: [{ id: "t-1", status: "open", target: { kind: "table", id: "before" }, messages: [{ id: "m-1", by: "花子", at: "2026-10-01T00:00:00.000Z", text: "確認" }] }] }) as never);
    const renamed = await runEntityRename(bridge, root, "table", "before", "after", root, "s");
    expect((await approvalsStore.read(root)).value.items[0].id).toBe("after");
    expect((await commentsStore.read(root)).value.threads[0].target.id).toBe("after");
    await runEntityUndo(bridge, renamed.result.operation.operationId, root, "s");
    expect((await approvalsStore.read(root)).value.items[0].id).toBe("before");
    expect((await commentsStore.read(root)).value.threads[0].target.id).toBe("before");
  });
});
