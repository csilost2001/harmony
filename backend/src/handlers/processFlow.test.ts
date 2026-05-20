/**
 * handlers/processFlow.ts のユニットテスト (#1141)
 *
 * 検証観点:
 * 1. designer__add_process_flow が v3 構造 (meta/context/actions/authoring 4 並列) で書き込む
 * 2. 生成される ID (processFlow / action / step) が RFC 4122 v4 UUID 形式
 * 3. meta.kind discriminator が使用される (旧 type フィールドは新規 entity に出現しない)
 * 4. harmony.json の entities.processFlows[] に upsert される (kind / no / actionCount)
 * 5. designer__add_action が v3 ActionDefinition 構造で UUID 付き action を追加する
 * 6. designer__add_step が v3 step (kind discriminator + UUID) を追加する
 * 7. AJV 検証で違反があれば authoring.markers に validator marker (Marker.kind='validator' +
 *    validatorCode + validatorPath) が記録され、書き込み自体は許可される
 *    (draft-state policy: 違反でも保存可)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { handleProcessFlowTool } from "./processFlow.js";
import {
  harmonyFile,
  ensureDataDir,
  readProcessFlow,
  readProject,
  writeProcessFlow,
} from "../projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `processFlow-handler-test-${process.pid}-${Date.now()}`);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// handler は sessionId を引数に取るが、本テストでは wsBridge.tryCommand 経路 (browser-first) を
// 通らない fallback path のみ検証するため、固定の dummy sessionId を渡す。
const SESSION_ID = "test-session";

async function makeWorkspace(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const harmony = {
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "test-ws",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    extensionsApplied: [],
    entities: {},
  };
  await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");
  await ensureDataDir(root, "harmony");
}

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

// ── 1. designer__add_process_flow が v3 構造で書き込む ─────────────────────────

describe("designer__add_process_flow — #1141 F-4 + S-9", () => {
  const root = path.join(TMP_ROOT, "ws-add-pf");
  beforeAll(async () => { await makeWorkspace(root); });

  it("v3 構造 (meta/context/actions/authoring 4 並列) で書き込まれる", async () => {
    const res = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "テスト処理フロー", kind: "common" },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    expect(res!.content[0].text).toMatch(/処理フロー「テスト処理フロー」/);

    // 物理ファイルを確認
    const message = res!.content[0].text as string;
    const idMatch = message.match(/ID: ([0-9a-f-]+)/);
    expect(idMatch).not.toBeNull();
    const pfId = idMatch![1];
    expect(pfId).toMatch(UUID_V4_PATTERN);

    const doc = await readProcessFlow(pfId, root) as Record<string, unknown>;
    expect(doc).not.toBeNull();
    // 4 並列構造の検証
    expect(doc).toHaveProperty("meta");
    expect(doc).toHaveProperty("context");
    expect(doc).toHaveProperty("actions");
    expect(doc).toHaveProperty("authoring");
    expect(Array.isArray(doc.actions)).toBe(true);
    expect(doc.actions).toEqual([]);
    // 旧 v1/v2 の root flat フィールドが**書き込まれない**こと
    expect(doc).not.toHaveProperty("type");
    expect(doc).not.toHaveProperty("createdAt");
    expect(doc).not.toHaveProperty("updatedAt");
    // (上記は meta 配下に移動済み)
    const meta = doc.meta as Record<string, unknown>;
    expect(meta.id).toBe(pfId);
    expect(meta.id).toMatch(UUID_V4_PATTERN);
    expect(meta.name).toBe("テスト処理フロー");
    expect(meta.kind).toBe("common"); // #8 / #1141: discriminator は `kind`
    expect(meta).not.toHaveProperty("type");
    expect(meta.maturity).toBe("draft");
    expect(typeof meta.createdAt).toBe("string");
    expect(typeof meta.updatedAt).toBe("string");
  });

  it("ProcessFlowId が RFC 4122 v4 UUID 形式である (旧 ag-${Date.now()} 全廃)", async () => {
    const res = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "uuid-format-check", kind: "batch" },
      root,
      SESSION_ID,
    );
    const idMatch = (res!.content[0].text as string).match(/ID: ([0-9a-f-]+)/);
    expect(idMatch).not.toBeNull();
    expect(idMatch![1]).toMatch(UUID_V4_PATTERN);
    // 旧 prefix が含まれないこと
    expect(idMatch![1]).not.toMatch(/^ag-/);
  });

  it("name または kind 欠落で InvalidParams が throw される", async () => {
    await expect(
      handleProcessFlowTool("designer__add_process_flow", { name: "no-kind" }, root, SESSION_ID),
    ).rejects.toThrow(/name, kind は必須/);
    await expect(
      handleProcessFlowTool("designer__add_process_flow", { kind: "screen" }, root, SESSION_ID),
    ).rejects.toThrow(/name, kind は必須/);
  });

  it("harmony.json の entities.processFlows[] に upsert される (no / kind / actionCount)", async () => {
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "entity-upsert-check", kind: "screen", screenId: "11111111-1111-4111-8111-111111111110", description: "test desc" },
      root,
      SESSION_ID,
    );
    const project = await readProject(root) as Record<string, unknown>;
    const entities = project.entities as Record<string, unknown>;
    expect(entities).toHaveProperty("processFlows");
    const list = entities.processFlows as Array<Record<string, unknown>>;
    const entry = list.find((e) => e.name === "entity-upsert-check");
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe("screen");
    expect(entry!.actionCount).toBe(0);
    expect(entry!.screenId).toBe("11111111-1111-4111-8111-111111111110");
    expect(typeof entry!.no).toBe("number");
    expect(entry!.no).toBeGreaterThanOrEqual(1);
    expect(entry!.maturity).toBe("draft");
  });
});

// ── 2. designer__add_action / designer__add_step が UUID + kind で書く ──────────

describe("designer__add_action + designer__add_step — #1141 F-4 + S-9", () => {
  const root = path.join(TMP_ROOT, "ws-add-action-step");
  let pfId: string;

  beforeAll(async () => {
    await makeWorkspace(root);
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "for-action-step", kind: "common" },
      root,
      SESSION_ID,
    );
    const idMatch = (addRes!.content[0].text as string).match(/ID: ([0-9a-f-]+)/);
    pfId = idMatch![1];
  });

  it("designer__add_action: actionId が UUID v4、description / maturity / trigger / steps が設定される", async () => {
    const res = await handleProcessFlowTool(
      "designer__add_action",
      { processFlowId: pfId, name: "登録ボタン", trigger: "click", description: "登録ボタン押下" },
      root,
      SESSION_ID,
    );
    const idMatch = (res!.content[0].text as string).match(/ID: ([0-9a-f-]+)/);
    expect(idMatch![1]).toMatch(UUID_V4_PATTERN);

    const doc = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const actions = doc.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toMatch(UUID_V4_PATTERN);
    expect(actions[0].name).toBe("登録ボタン");
    expect(actions[0].trigger).toBe("click");
    expect(actions[0].description).toBe("登録ボタン押下");
    expect(actions[0].maturity).toBe("draft");
    expect(actions[0].steps).toEqual([]);
  });

  it("designer__add_step: stepId が UUID v4 + discriminator は `kind` (旧 `type` 不在)", async () => {
    const doc = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const actions = doc.actions as Array<Record<string, unknown>>;
    const actionId = actions[0].id as string;

    const res = await handleProcessFlowTool(
      "designer__add_step",
      {
        processFlowId: pfId,
        actionId,
        kind: "compute",
        description: "compute step",
        detail: { expression: "@x + 1", outputBinding: { name: "y" } },
      },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const idMatch = (res!.content[0].text as string).match(/ID: ([0-9a-f-]+)/);
    expect(idMatch![1]).toMatch(UUID_V4_PATTERN);

    const reloaded = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const reloadedActions = reloaded.actions as Array<Record<string, unknown>>;
    const steps = reloadedActions[0].steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toMatch(UUID_V4_PATTERN);
    expect(steps[0].kind).toBe("compute"); // v3 discriminator
    expect(steps[0]).not.toHaveProperty("type"); // 旧 legacy field 不在
    expect(steps[0].description).toBe("compute step");
    expect(steps[0].expression).toBe("@x + 1");
  });

  it("designer__add_step: kind 欠落で InvalidParams が throw される", async () => {
    const doc = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const actions = doc.actions as Array<Record<string, unknown>>;
    const actionId = actions[0].id as string;

    await expect(
      handleProcessFlowTool(
        "designer__add_step",
        { processFlowId: pfId, actionId, description: "no-kind" },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/processFlowId, actionId, kind は必須/);
  });
});

// ── 3. AJV validation warning marker (draft-state policy) ────────────────────

describe("writeProcessFlow AJV validation — #1141 F-2", () => {
  const root = path.join(TMP_ROOT, "ws-validation");
  beforeAll(async () => { await makeWorkspace(root); });

  it("schema 違反の ProcessFlow を writeProcessFlow すると authoring.markers に validator marker が記録される (書き込みは許可)", async () => {
    // schema 違反データ: meta.id が UUID 形式違反 (旧 `ag-xxx` 形式)、kind 欠落
    const bad = {
      meta: {
        id: "ag-bad-id-not-uuid",
        name: "違反テスト",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        // kind が欠落 (meta.required: ['kind'])
      },
      context: {},
      actions: [],
      authoring: {},
    };
    // throw しないこと (draft-state policy)
    await writeProcessFlow("ag-bad-id-not-uuid", bad, root);
    const reloaded = await readProcessFlow("ag-bad-id-not-uuid", root) as Record<string, unknown>;
    expect(reloaded).not.toBeNull();
    // validator marker が authoring.markers に記録されている
    const authoring = reloaded.authoring as Record<string, unknown>;
    expect(authoring).toHaveProperty("markers");
    const markers = authoring.markers as Array<Record<string, unknown>>;
    expect(markers.length).toBeGreaterThan(0);
    // common.v3 Marker 規範: kind='validator' + validatorCode + validatorPath 必須
    const validatorMarkers = markers.filter((m) => m.kind === "validator");
    expect(validatorMarkers.length).toBeGreaterThan(0);
    for (const m of validatorMarkers) {
      expect(typeof m.validatorCode).toBe("string");
      expect(typeof m.validatorPath).toBe("string");
      expect(typeof m.id).toBe("string");
      expect(m.id).toMatch(UUID_V4_PATTERN); // marker.id は Uuid
      expect(m.author).toBe("ai");
      expect(typeof m.body).toBe("string");
      expect(typeof m.createdAt).toBe("string");
    }
  });

  it("同 validatorCode + validatorPath の marker は重複追加されない", async () => {
    const bad = {
      meta: {
        id: "dup-marker-test",
        name: "dup",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      context: {},
      actions: [],
      authoring: {},
    };
    await writeProcessFlow("dup-marker-test", bad, root);
    const after1 = await readProcessFlow("dup-marker-test", root) as Record<string, unknown>;
    const markers1 = ((after1.authoring as Record<string, unknown>).markers as Array<unknown>).length;
    // 2 回目書込: 同じ違反なので marker は増えない
    await writeProcessFlow("dup-marker-test", after1, root);
    const after2 = await readProcessFlow("dup-marker-test", root) as Record<string, unknown>;
    const markers2 = ((after2.authoring as Record<string, unknown>).markers as Array<unknown>).length;
    expect(markers2).toBe(markers1);
  });

  it("schema valid な ProcessFlow は marker を追加しない", async () => {
    // 最小限の valid な v3 ProcessFlow
    const good = {
      meta: {
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        name: "valid-flow",
        kind: "common",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      actions: [],
    };
    await writeProcessFlow("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", good, root);
    const reloaded = await readProcessFlow("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", root) as Record<string, unknown>;
    // authoring が無いか markers が空
    const authoring = reloaded.authoring as Record<string, unknown> | undefined;
    if (authoring && authoring.markers) {
      const markers = authoring.markers as Array<Record<string, unknown>>;
      const validatorMarkers = markers.filter((m) => m.kind === "validator");
      expect(validatorMarkers).toHaveLength(0);
    }
  });
});

// ── 4. designer__list_process_flows が meta.{name,kind} を読む (v3 path) ────────

describe("designer__list_process_flows — #1141 F-4 v3 meta path", () => {
  const root = path.join(TMP_ROOT, "ws-list");
  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    await makeWorkspace(root);
  });

  it("v3 entity (meta.{name,kind}) を一覧に表示する", async () => {
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "list-test-1", kind: "common" },
      root,
      SESSION_ID,
    );
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "list-test-2", kind: "batch" },
      root,
      SESSION_ID,
    );
    const res = await handleProcessFlowTool("designer__list_process_flows", {}, root, SESSION_ID);
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/list-test-1.*common/);
    expect(text).toMatch(/list-test-2.*batch/);
    // 旧 (type) でなく v3 (kind) の値が表示されている
    expect(text).not.toMatch(/\(undefined\)/);
  });
});

// ── 5. designer__solution_pack / solution_unpack の path traversal 拒否 (#1229 F-1) ──

import fsSync from "node:fs";
import AdmZip from "adm-zip";

describe("designer__solution_pack — #1229 F-1 path traversal 拒否", () => {
  const root = path.join(TMP_ROOT, "ws-pack-path");
  beforeAll(async () => { await makeWorkspace(root); });

  it("outputPath が workspace 外 (../ traversal) の場合は Error を throw する", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__solution_pack",
        {
          processFlowIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
          publisherPrefix: "test",
          version: "1.0.0",
          outputPath: "../../evil.zip",
        },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Path traversal detected/);
  });

  it("outputPath が絶対パスで workspace 外の場合は Error を throw する", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__solution_pack",
        {
          processFlowIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
          publisherPrefix: "test",
          version: "1.0.0",
          outputPath: "/tmp/evil.zip",
        },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Path traversal detected/);
  });

  it("outputPath が workspace 内の相対パスなら正常に実行される", async () => {
    // 処理フローを事前に作成
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "pack-test-flow", kind: "common" },
      root,
      SESSION_ID,
    );
    const addText = addRes!.content[0].text as string;
    const idMatch = addText.match(/ID: ([0-9a-f-]+)/);
    const pfId = idMatch![1];

    const res = await handleProcessFlowTool(
      "designer__solution_pack",
      {
        processFlowIds: [pfId],
        publisherPrefix: "test",
        version: "1.0.0",
        outputPath: "output/test.zip",
      },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/1 件をパックしました/);
    // zip ファイルが workspace 内 (dataDir 配下) に作成されたことを確認
    // _dataRoot = root/harmony なので outputPath 相対はそこに展開される
    expect(fsSync.existsSync(path.join(root, "harmony", "output", "test.zip"))).toBe(true);
  });
});

describe("designer__solution_unpack — #1229 F-1 path traversal 拒否", () => {
  const root = path.join(TMP_ROOT, "ws-unpack-path");
  beforeAll(async () => { await makeWorkspace(root); });

  it("inputPath が workspace 外 (../ traversal) の場合は Error を throw する", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__solution_unpack",
        { inputPath: "../../outside.zip" },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Path traversal detected/);
  });

  it("inputPath が絶対パスで workspace 外の場合は Error を throw する", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__solution_unpack",
        { inputPath: "/tmp/outside.zip" },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Path traversal detected/);
  });

  it("inputPath が workspace 内の正常パスなら展開される", async () => {
    // _dataRoot = root/harmony なので inputPath 相対はそこから解決される
    const zipDir = path.join(root, "harmony", "input");
    await fs.mkdir(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, "pack.zip");

    const flowDoc = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      meta: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "unpack-test", kind: "common" },
      context: {},
      actions: [],
      authoring: { markers: [] },
    };
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ publisher: "test", version: "1.0.0", processFlowIds: [flowDoc.id], createdAt: new Date().toISOString() }), "utf8"));
    zip.addFile(`process-flows/${flowDoc.id}.json`, Buffer.from(JSON.stringify(flowDoc), "utf8"));
    zip.writeZip(zipPath);

    const res = await handleProcessFlowTool(
      "designer__solution_unpack",
      { inputPath: "input/pack.zip" },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/展開完了/);
    expect(text).toMatch(/OK: bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
  });
});
