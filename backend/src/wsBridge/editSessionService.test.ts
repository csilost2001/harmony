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

  it("page-layout-design は PageLayout design storage に保存し pageLayoutChanged を broadcast する (#1448)", async () => {
    const { editSession } = service.create("client-editor", "page-layout-design", "main-layout", "レイアウト");
    const editSessionId = (editSession as { id: string }).id;
    service.update("client-editor", editSessionId, {
      pages: [{ frames: [{ component: { type: "wrapper", components: "<main data-region-name=\"main\"></main>" } }] }],
    });

    const result = await service.save("client-editor", editSessionId);
    expect(result.ok).toBe(true);

    const designPath = path.join(tmpDir, "data", "page-layouts", "main-layout.design.json");
    const htmlPath = path.join(tmpDir, "data", "page-layouts", "main-layout.components.html");
    const design = JSON.parse(await fs.readFile(designPath, "utf-8"));
    expect(design.pages[0].frames[0].component.componentsRef).toBe("main-layout.components.html");
    expect(await fs.readFile(htmlPath, "utf-8")).toBe("<main data-region-name=\"main\"></main>");
    await expect(fs.access(path.join(tmpDir, "data", "screens", "page-layout:main-layout.design.json"))).rejects.toThrow();

    const changed = broadcasts.find((call) => call.event === "pageLayoutChanged");
    expect(changed).toEqual({
      wsId: tmpDir,
      event: "pageLayoutChanged",
      data: { pageLayoutId: "main-layout" },
    });
  });

  it("#1368 Codex Round 3 Must-fix: long composite generic-definition resourceId (>64 chars) も WS handler が accept する", async () => {
    // assertSafeName は max 64 chars だが、`${kind}__${name}` 形式は最大 64 + 2 + 64 = 130 chars
    // schema-valid な長い name で 64 chars を超える事例を捕捉する (Round 3 で観測):
    //   kind = "data-contract" (13 chars), name = 52-char schema-valid name → 13+2+52 = 67 chars
    const { editSessionHandlers } = await import("../wsHandlers/editSession.js");
    const createHandler = editSessionHandlers["editSession.create"];
    const longName = "A_very_long_but_schema_valid_generic_def_name_OrderForm";
    expect(longName.length).toBe(55);
    const longResourceId = `data-contract__${longName}`;
    expect(longResourceId.length).toBeGreaterThan(64); // assertSafeName max 64 を超える

    let respondedResult: unknown = undefined;
    let respondedError: string | undefined;
    const captures: Array<{ rid: string }> = [];
    const stubBridge = {
      editSessionCreate: (_clientId: string, _rt: string, rid: string) => {
        captures.push({ rid });
        return { editSession: { id: "stub-long-es", resourceId: rid } };
      },
    };

    await createHandler({
      params: {
        resourceType: "generic-definition",
        resourceId: longResourceId,
        displayLabel: "tester",
      },
      clientId: "client-test",
      root: () => tmpDir,
      wsId: () => tmpDir,
      respond: (r) => { respondedResult = r; },
      respondError: (e) => { respondedError = e; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridge: stubBridge as any,
    });

    expect(respondedError).toBeUndefined();
    expect(respondedResult).toEqual({ editSession: { id: "stub-long-es", resourceId: longResourceId } });
    expect(captures[0].rid).toBe(longResourceId);
  });

  it("#1368 Codex Round 3 Must-fix: WS handler が generic-definition resourceId の decoded kind / name を別個に検証する (invalid は reject)", async () => {
    const { editSessionHandlers } = await import("../wsHandlers/editSession.js");
    const createHandler = editSessionHandlers["editSession.create"];

    // ケース 1: `__` separator 無し → reject
    let errFromMissingSep: string | undefined;
    await createHandler({
      params: { resourceType: "generic-definition", resourceId: "no-separator-here" },
      clientId: "c1", root: () => tmpDir, wsId: () => tmpDir,
      respond: () => undefined,
      respondError: (e) => { errFromMissingSep = e; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridge: {} as any,
    });
    expect(errFromMissingSep).toMatch(/generic-definition resourceId.*'\${kind}__\${name}'/);

    // ケース 2: 不正な decoded kind (`_` を含む = kind regex 違反) → reject
    let errFromBadKind: string | undefined;
    await createHandler({
      params: { resourceType: "generic-definition", resourceId: "data_contract__Order" },
      clientId: "c2", root: () => tmpDir, wsId: () => tmpDir,
      respond: () => undefined,
      respondError: (e) => { errFromBadKind = e; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridge: {} as any,
    });
    expect(errFromBadKind).toMatch(/decoded kind/);
  });

  it("#1368 Codex Round 2 Must-fix: WS handler editSession.create が resourceType=\"generic-definition\" を accept する (VALID_RESOURCE_TYPES allowlist)", async () => {
    // backend/src/wsHandlers/editSession.ts の VALID_RESOURCE_TYPES に "generic-definition"
    // が含まれていないと、frontend GenericDefinitionEditor の `editSession.create` が
    // assertResourceType で reject される (Round 2 で観測 — 実 browser 経路で動作不能だった)。
    //
    // editSessionHandlers["editSession.create"] を直接呼出し、stub bridge で
    // editSessionCreate を caputure する。
    const { editSessionHandlers } = await import("../wsHandlers/editSession.js");
    const createHandler = editSessionHandlers["editSession.create"];
    expect(createHandler).toBeDefined();

    let respondedResult: unknown = undefined;
    let respondedError: string | undefined;
    const captures: Array<{ clientId: string; rt: string; rid: string }> = [];
    const stubBridge = {
      editSessionCreate: (clientId: string, rt: string, rid: string, _label?: string) => {
        captures.push({ clientId, rt, rid });
        return { editSession: { id: "stub-es-id", resourceType: rt, resourceId: rid } };
      },
    };

    await createHandler({
      params: {
        resourceType: "generic-definition",
        resourceId: "data-contract__OrderForm",
        displayLabel: "tester",
      },
      clientId: "client-test",
      root: () => tmpDir,
      wsId: () => tmpDir,
      respond: (r) => { respondedResult = r; },
      respondError: (e) => { respondedError = e; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridge: stubBridge as any,
    });

    expect(respondedError).toBeUndefined();
    expect(respondedResult).toEqual({
      editSession: { id: "stub-es-id", resourceType: "generic-definition", resourceId: "data-contract__OrderForm" },
    });
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ rt: "generic-definition", rid: "data-contract__OrderForm" });
  });

  it("#1368 Codex Round 1 Must-fix: 不正な decoded kind / name は store.save 前に reject される", async () => {
    // 不正な kind ( `_` を含む = kind regex `[a-z][a-z0-9:-]{0,63}` 違反)
    // resourceId 全体としては assertSafeName `[A-Za-z0-9_-]{1,64}` を通る (= editSession.create で reject されない)
    // → 本 PR の pre-validation で reject されることを検証
    const invalidResourceId = "data_contract__Order"; // `_` が kind 部に紛れている
    const { editSession } = service.create("client-editor", "generic-definition", invalidResourceId, "編集者A");
    const editSessionId = (editSession as { id: string }).id;
    service.update("client-editor", editSessionId, { kind: "data_contract", name: "Order" });

    await expect(service.save("client-editor", editSessionId)).rejects.toThrow(/decoded generic-definition kind/);

    // store.save 前に reject されているため saveHistory には追加されていない
    const gdChanged = broadcasts.find((call) => call.event === "genericDefinitionChanged");
    expect(gdChanged).toBeUndefined();
    const saved = broadcasts.find((call) => call.event === "editSession.saved");
    expect(saved).toBeUndefined();
  });

  it("#1368 Codex Round 1 Must-fix: `__` separator 無しの resourceId は store.save 前に reject される", async () => {
    const invalidResourceId = "no-separator-here";
    const { editSession } = service.create("client-editor", "generic-definition", invalidResourceId, "編集者A");
    const editSessionId = (editSession as { id: string }).id;
    service.update("client-editor", editSessionId, { kind: "x", name: "Y" });

    await expect(service.save("client-editor", editSessionId)).rejects.toThrow(/'__' separator not found/);
  });

  it("#1368: generic-definition は resourceId を `${kind}__${name}` から分解して file 書込 + genericDefinitionChanged broadcast", async () => {
    // frontend は editSessionRawId = `${kind}/${name}` を `/` → `__` 置換した resourceId を渡す。
    // backend は `__` を delimiter として分割し、kind / name を復元して writeGenericDefinition で保存する。
    const kind = "data-contract";
    const name = "OrderForm";
    const resourceId = `${kind}__${name}`;
    const payload = {
      $schema: "../../../../schemas/v3/generic-definition.v3.schema.json",
      name,
      kind,
      purpose: "受注フォームのデータ契約",
      responsibilities: ["商品コード入力", "数量入力"],
      targets: ["frontend"],
    };

    const { editSession } = service.create("client-editor", "generic-definition", resourceId, "編集者A");
    const editSessionId = (editSession as { id: string }).id;
    service.update("client-editor", editSessionId, payload);

    const result = await service.save("client-editor", editSessionId);
    expect(result.ok).toBe(true);

    // broadcast event 確認
    const gdChanged = broadcasts.find((call) => call.event === "genericDefinitionChanged");
    expect(gdChanged).toEqual({
      wsId: tmpDir,
      event: "genericDefinitionChanged",
      data: { kind, name },
    });
    expect(gdChanged?.excludeClientId).toBeUndefined();

    // 実 file 書込確認 (workspace 直下 data/generic-definitions/<kind>/<name>.json)
    const filePath = path.join(tmpDir, "data", "generic-definitions", kind, `${name}.json`);
    const written = JSON.parse(await fs.readFile(filePath, "utf-8")) as { kind: string; name: string };
    expect(written.kind).toBe(kind);
    expect(written.name).toBe(name);
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
