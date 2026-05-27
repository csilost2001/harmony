/**
 * editSessionService.test.ts (#1345)
 *
 * EditSessionService.save の resource change broadcast 契約を固定する。
 * 通常保存 handler は originating client を exclude する一方、editSession.save は
 * same-SPA consumer と originating editor の双方へ echo する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditSessionService } from "./editSessionService.js";
import { WsBridge } from "../wsBridge.js";
import { workspaceContextManager, _resetForTest as resetWorkspaceStateForTest } from "../workspaceState.js";

type BroadcastCall = {
  wsId: string | null;
  event: string;
  data: unknown;
  excludeClientId?: string;
};

let tmpDir: string;
let otherTmpDir: string;
let broadcasts: BroadcastCall[];
let service: EditSessionService;

beforeEach(async () => {
  resetWorkspaceStateForTest();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-session-service-test-"));
  otherTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-session-service-other-"));
  await fs.writeFile(
    path.join(tmpDir, "harmony.json"),
    JSON.stringify({ schemaVersion: "v3", dataDir: "data" }, null, 2),
    "utf-8",
  );

  workspaceContextManager.connect("client-editor");
  workspaceContextManager.connect("client-consumer");
  workspaceContextManager.connect("client-other-workspace");
  workspaceContextManager.setActivePath("client-editor", tmpDir);
  workspaceContextManager.setActivePath("client-consumer", tmpDir);
  workspaceContextManager.setActivePath("client-other-workspace", otherTmpDir);

  broadcasts = [];
  service = new EditSessionService((opts) => {
    broadcasts.push(opts);
  });
});

afterEach(async () => {
  resetWorkspaceStateForTest();
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(otherTmpDir, { recursive: true, force: true });
});

describe("EditSessionService.save resource change broadcast", () => {
  it("tableChanged は originating editor を除外せず同 workspace consumer にも届く契約", async () => {
    const { editSession } = service.create("client-editor", "table", "orders", "受注");
    const editSessionId = (editSession as { id: string }).id;
    service.attachAsView("client-consumer", editSessionId, "別ページ consumer");
    service.update("client-editor", editSessionId, {
      id: "orders",
      name: "受注",
      columns: [],
    });

    const result = await service.save("client-editor", editSessionId);

    expect(result.ok).toBe(true);
    const tableChanged = broadcasts.find((call) => call.event === "tableChanged");
    expect(tableChanged).toEqual({
      wsId: tmpDir,
      event: "tableChanged",
      data: { tableId: "orders" },
    });
    expect(tableChanged?.excludeClientId).toBeUndefined();

    const deliveredClientIds = workspaceContextManager
      .getClientIdsByPath(tableChanged?.wsId ?? "")
      .filter((clientId) => clientId !== tableChanged?.excludeClientId);

    expect(deliveredClientIds).toContain("client-consumer");
    expect(deliveredClientIds).toContain("client-editor");
    expect(deliveredClientIds).not.toContain("client-other-workspace");
  });

  it("WsBridge adapter 経由でも originating editor と same-workspace consumer に tableChanged を送信する", async () => {
    const bridge = new WsBridge();
    const sentByClient = new Map<string, string[]>([
      ["client-editor", []],
      ["client-consumer", []],
      ["client-other-workspace", []],
    ]);
    const clients = (bridge as unknown as { clients: Map<string, { readyState: number; send: (message: string, cb?: (err?: Error) => void) => void }> }).clients;

    for (const [clientId, sent] of sentByClient.entries()) {
      clients.set(clientId, {
        readyState: 1,
        send: vi.fn((message: string, cb?: (err?: Error) => void) => {
          sent.push(message);
          cb?.();
        }),
      });
    }

    const { editSession } = bridge.editSessionCreate("client-editor", "table", "orders", "受注");
    const editSessionId = (editSession as { id: string }).id;
    bridge.editSessionAttachAsView("client-consumer", editSessionId, "別ページ consumer");
    bridge.editSessionUpdate("client-editor", editSessionId, {
      id: "orders",
      name: "受注",
      columns: [],
    });

    const result = await bridge.editSessionSave("client-editor", editSessionId);

    expect(result.ok).toBe(true);
    const tableChangedMessage = JSON.stringify({
      type: "broadcast",
      event: "tableChanged",
      data: { tableId: "orders" },
    });

    expect(sentByClient.get("client-editor")).toContain(tableChangedMessage);
    expect(sentByClient.get("client-consumer")).toContain(tableChangedMessage);
    expect(sentByClient.get("client-other-workspace")).not.toContain(tableChangedMessage);
  });
});
