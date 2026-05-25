import { describe, expect, it, vi, afterAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { renameEntityId, _clearUndoStoreForTest } from "../renameEntity.js";
import { harmonyFile, ensureDataDir, writeTable } from "../projectStorage.js";
import { refactorHandlers } from "./refactor.js";
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
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
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
