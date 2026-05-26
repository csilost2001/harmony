/**
 * handlers/processFlow.ts のユニットテスト (#1141)
 *
 * 検証観点:
 * 1. designer__add_process_flow が v3 構造 (meta/context/actions/authoring 4 並列) で書き込む
 * 2. 生成される ID (processFlow / action / step) が RFC 4122 v4 UUID 形式
 * 3. meta.flowType discriminator が使用される (旧 type / kind フィールドは新規 entity に出現しない、#1263 Phase X1)
 * 4. harmony.json の entities.processFlows[] に upsert される (flowType / no / actionCount)
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
// #1294 I-2 / RFC #1284: processFlow id は kebab-case EntityId に変更 (旧 UUID v4 から)
// 採番形式は backend が `flow-<8桁短縮>` を生成する暫定形式 (I-5 で UI から人間入力 + AI 提案に置き換え)
const ENTITY_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FLOW_ID_PATTERN = /^flow-[0-9a-f]{8}$/;
// 「ID: <captured>」message capture 用の broader regex (kebab-case と UUID の両方に対応)
const ID_CAPTURE_RE = /ID: ([a-z0-9][a-z0-9-]*)/;
// handler は sessionId を引数に取るが、本テストでは wsBridge.tryCommand 経路 (browser-first) を
// 通らない fallback path のみ検証するため、固定の dummy sessionId を渡す。
const SESSION_ID = "test-session";

async function makeWorkspace(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  // #1294 I-2: meta.id を kebab-case EntityId に、uuid を required で追加
  const harmony = {
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: "test-ws",
      uuid: "11111111-1111-4111-8111-111111111111",
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
      { name: "テスト処理フロー", flowType: "common" },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    expect(res!.content[0].text).toMatch(/処理フロー「テスト処理フロー」/);

    // 物理ファイルを確認
    const message = res!.content[0].text as string;
    const idMatch = message.match(ID_CAPTURE_RE);
    expect(idMatch).not.toBeNull();
    const pfId = idMatch![1];
    // #1294 I-2 / RFC #1284: id は kebab-case EntityId (`flow-XXXXXXXX`)、uuid は別 field
    expect(pfId).toMatch(FLOW_ID_PATTERN);

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
    expect(meta.id).toMatch(ENTITY_ID_PATTERN);
    // #1294 I-2 / RFC #1284: meta.uuid (UUID v4、不変) が新規採番される
    expect(meta.uuid).toMatch(UUID_V4_PATTERN);
    expect(meta.name).toBe("テスト処理フロー");
    expect(meta.flowType).toBe("common"); // #8 / #1141 / #1263 Phase X1: discriminator は `flowType`
    expect(meta).not.toHaveProperty("kind"); // #1263 Phase X1: 旧 meta.kind は出現しない
    expect(meta).not.toHaveProperty("type");
    expect(meta.maturity).toBe("draft");
    expect(typeof meta.createdAt).toBe("string");
    expect(typeof meta.updatedAt).toBe("string");
  });

  it("ProcessFlowId が kebab-case EntityId (`flow-XXXXXXXX`) 形式である (#1294 I-2 / RFC #1284、旧 UUID 全廃)", async () => {
    const res = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "id-format-check", flowType: "batch" },
      root,
      SESSION_ID,
    );
    const idMatch = (res!.content[0].text as string).match(ID_CAPTURE_RE);
    expect(idMatch).not.toBeNull();
    expect(idMatch![1]).toMatch(FLOW_ID_PATTERN);
    // 旧 prefix が含まれないこと
    expect(idMatch![1]).not.toMatch(/^ag-/);
  });

  it("name または flowType 欠落で InvalidParams が throw される (#1263 Phase X1)", async () => {
    await expect(
      handleProcessFlowTool("designer__add_process_flow", { name: "no-flow-type" }, root, SESSION_ID),
    ).rejects.toThrow(/name, flowType は必須/);
    await expect(
      handleProcessFlowTool("designer__add_process_flow", { flowType: "screen" }, root, SESSION_ID),
    ).rejects.toThrow(/name, flowType は必須/);
  });

  it("harmony.json の entities.processFlows[] に upsert される (no / flowType / actionCount, #1263 Phase X1)", async () => {
    // #1332 Codex 9 巡目 M2: screenId は top-level Screen EntityId として検証されるため、
    // kebab-case EntityId を渡す (旧 UUID fixture は reject される)。
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "entity-upsert-check", flowType: "screen", screenId: "linked-screen-fixture", description: "test desc" },
      root,
      SESSION_ID,
    );
    const project = await readProject(root) as Record<string, unknown>;
    const entities = project.entities as Record<string, unknown>;
    expect(entities).toHaveProperty("processFlows");
    const list = entities.processFlows as Array<Record<string, unknown>>;
    const entry = list.find((e) => e.name === "entity-upsert-check");
    expect(entry).toBeDefined();
    expect(entry!.flowType).toBe("screen");
    expect(entry).not.toHaveProperty("kind"); // #1263 Phase X1: 旧 kind は出現しない
    expect(entry!.actionCount).toBe(0);
    expect(entry!.screenId).toBe("linked-screen-fixture");
    expect(typeof entry!.no).toBe("number");
    expect(entry!.no).toBeGreaterThanOrEqual(1);
    expect(entry!.maturity).toBe("draft");
  });

  // #1332 Codex 9 巡目 M2: screenId が UUID 形式なら reject される (EntityId strict 化)
  it("designer__add_process_flow: screenId が UUID 形式なら reject される (#1332 M2)", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__add_process_flow",
        { name: "uuid-screen-reject", flowType: "screen", screenId: "11111111-1111-4111-8111-111111111110" },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Invalid screenId.*kebab-case EntityId/);
  });
});

// ── 2. designer__add_action / designer__add_step が LocalId + kind で書く ──────
// #1332 Codex 9 巡目 M3: schema (Action.id / Step.id: LocalId) 規範に合わせて、
// 採番形式を UUID v4 → kebab-case LocalId に修正 (act-001 / step-01)。
// tool description (tools.ts:944-955) も既に LocalId を案内していたが、実装が UUID
// を生成して assertUuid 要求しており整合していなかった。本テストで LocalId 期待に反転。

const LOCAL_ID_ACT_PATTERN = /^act-\d{3,}$/;
const LOCAL_ID_STEP_PATTERN = /^step-\d{2,}$/;

describe("designer__add_action + designer__add_step — #1141 F-4 + #1332 M3 LocalId", () => {
  const root = path.join(TMP_ROOT, "ws-add-action-step");
  let pfId: string;

  beforeAll(async () => {
    await makeWorkspace(root);
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "for-action-step", flowType: "common" },
      root,
      SESSION_ID,
    );
    const idMatch = (addRes!.content[0].text as string).match(ID_CAPTURE_RE);
    pfId = idMatch![1];
  });

  it("designer__add_action: actionId が LocalId (act-001 形式)、description / maturity / trigger / steps が設定される", async () => {
    const res = await handleProcessFlowTool(
      "designer__add_action",
      { processFlowId: pfId, name: "登録ボタン", trigger: "click", description: "登録ボタン押下" },
      root,
      SESSION_ID,
    );
    const idMatch = (res!.content[0].text as string).match(/ID: ([a-z][a-z0-9-]*)/);
    expect(idMatch![1]).toMatch(LOCAL_ID_ACT_PATTERN);

    const doc = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const actions = doc.actions as Array<Record<string, unknown>>;
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe("act-001");
    expect(actions[0].id).toMatch(LOCAL_ID_ACT_PATTERN);
    expect(actions[0].id).not.toMatch(UUID_V4_PATTERN); // #1332 M3: UUID v4 は撤廃
    expect(actions[0].name).toBe("登録ボタン");
    expect(actions[0].trigger).toBe("click");
    expect(actions[0].description).toBe("登録ボタン押下");
    expect(actions[0].maturity).toBe("draft");
    expect(actions[0].steps).toEqual([]);
  });

  it("designer__add_step: stepId が LocalId (step-01 形式) + discriminator は `kind` (旧 `type` 不在)", async () => {
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
    const idMatch = (res!.content[0].text as string).match(/ID: ([a-z][a-z0-9-]*)/);
    expect(idMatch![1]).toMatch(LOCAL_ID_STEP_PATTERN);

    const reloaded = await readProcessFlow(pfId, root) as Record<string, unknown>;
    const reloadedActions = reloaded.actions as Array<Record<string, unknown>>;
    const steps = reloadedActions[0].steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("step-01");
    expect(steps[0].id).toMatch(LOCAL_ID_STEP_PATTERN);
    expect(steps[0].id).not.toMatch(UUID_V4_PATTERN); // #1332 M3: UUID v4 は撤廃
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

  // #1332 Codex 9 巡目 M3: actionId が LocalId 違反 (空 / path traversal / null) なら reject
  it("designer__add_step: actionId が LocalId 違反なら reject される (#1332 M3)", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__add_step",
        { processFlowId: pfId, actionId: "../evil", kind: "compute", description: "x" },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Invalid actionId.*LocalId/);
  });

  // #1332 Codex 9 巡目 M3: 連続採番 (act-001 → act-002 → act-003) が衝突せず増えていく
  it("designer__add_action: 連続採番が act-002 / act-003 と inkrementiert される (#1332 M3)", async () => {
    const res2 = await handleProcessFlowTool(
      "designer__add_action",
      { processFlowId: pfId, name: "second", trigger: "click" },
      root,
      SESSION_ID,
    );
    const id2Match = (res2!.content[0].text as string).match(/ID: ([a-z][a-z0-9-]*)/);
    expect(id2Match![1]).toBe("act-002");
    const res3 = await handleProcessFlowTool(
      "designer__add_action",
      { processFlowId: pfId, name: "third", trigger: "click" },
      root,
      SESSION_ID,
    );
    const id3Match = (res3!.content[0].text as string).match(/ID: ([a-z][a-z0-9-]*)/);
    expect(id3Match![1]).toBe("act-003");
  });
});

// ── 3. AJV validation warning marker (draft-state policy) ────────────────────

describe("writeProcessFlow AJV validation — #1141 F-2", () => {
  const root = path.join(TMP_ROOT, "ws-validation");
  beforeAll(async () => { await makeWorkspace(root); });

  it("schema 違反の ProcessFlow を writeProcessFlow すると authoring.markers に validator marker が記録される (書き込みは許可)", async () => {
    // schema 違反データ: meta.id が UUID 形式違反 (旧 `ag-xxx` 形式)、flowType 欠落
    const bad = {
      meta: {
        id: "ag-bad-id-not-uuid",
        name: "違反テスト",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        // flowType が欠落 (meta.required: ['flowType'], #1263 Phase X1)
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
    // I-7 Round 2 F-1 (#1299): EntityId は alpha-leading UUID を reject するため、
    // kebab-case fixture id に変更。
    const good = {
      meta: {
        id: "valid-flow-fixture",
        name: "valid-flow",
        flowType: "common",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      actions: [],
    };
    await writeProcessFlow("valid-flow-fixture", good, root);
    const reloaded = await readProcessFlow("valid-flow-fixture", root) as Record<string, unknown>;
    // authoring が無いか markers が空
    const authoring = reloaded.authoring as Record<string, unknown> | undefined;
    if (authoring && authoring.markers) {
      const markers = authoring.markers as Array<Record<string, unknown>>;
      const validatorMarkers = markers.filter((m) => m.kind === "validator");
      expect(validatorMarkers).toHaveLength(0);
    }
  });
});

// ── 4. designer__list_process_flows が meta.{name,flowType} を読む (v3 path, #1263 Phase X1) ──

describe("designer__list_process_flows — #1141 F-4 v3 meta path", () => {
  const root = path.join(TMP_ROOT, "ws-list");
  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    await makeWorkspace(root);
  });

  it("v3 entity (meta.{name,flowType}) を一覧に表示する (#1263 Phase X1)", async () => {
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "list-test-1", flowType: "common" },
      root,
      SESSION_ID,
    );
    await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "list-test-2", flowType: "batch" },
      root,
      SESSION_ID,
    );
    const res = await handleProcessFlowTool("designer__list_process_flows", {}, root, SESSION_ID);
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/list-test-1.*common/);
    expect(text).toMatch(/list-test-2.*batch/);
    // 旧 (type) / 旧 (kind) でなく v3 (flowType) の値が表示されている
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
          processFlowIds: ["existing-flow-fixture"],
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
          processFlowIds: ["existing-flow-fixture"],
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
      { name: "pack-test-flow", flowType: "common" },
      root,
      SESSION_ID,
    );
    const addText = addRes!.content[0].text as string;
    const idMatch = addText.match(ID_CAPTURE_RE);
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

  // #1332 Codex 9 巡目 M2: processFlowIds[] 要素が UUID なら reject される
  it("processFlowIds が UUID 形式の要素を含むなら reject される (#1332 M2)", async () => {
    await expect(
      handleProcessFlowTool(
        "designer__solution_pack",
        {
          processFlowIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
          publisherPrefix: "test",
          version: "1.0.0",
          outputPath: "output/uuid-reject.zip",
        },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/Invalid processFlowIds.*kebab-case EntityId/);
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
    // I-7 Round 2 F-1 (#1299): EntityId は alpha-leading UUID を reject するため、
    // kebab-case fixture id に変更。
    const zipDir = path.join(root, "harmony", "input");
    await fs.mkdir(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, "pack.zip");

    const flowDoc = {
      id: "unpack-test-fixture",
      meta: { id: "unpack-test-fixture", name: "unpack-test", flowType: "common" },
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
    expect(text).toMatch(/OK: unpack-test-fixture/);
  });
});

// ── 6. designer__solution_unpack — ZIP 由来 id の assertUuid 検証 (#1229 review-iter-1 I-001) ──

describe("designer__solution_unpack — #1229 I-001 ZIP 由来 id の UUID 検証", () => {
  const root = path.join(TMP_ROOT, "ws-unpack-id");
  beforeAll(async () => { await makeWorkspace(root); });

  async function makeZipWithId(id: string, entryName?: string): Promise<string> {
    const zipDir = path.join(root, "harmony", "input-id");
    await fs.mkdir(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, `${Date.now()}.zip`);
    const flowDoc = { id, meta: { id, name: "t", flowType: "common" }, context: {}, actions: [], authoring: { markers: [] } };
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ publisher: "test", version: "1.0.0", processFlowIds: [id], createdAt: new Date().toISOString() }), "utf8"));
    // entryName は必ず process-flows/ 配下に設定 (フィルタ通過のため)
    const name = entryName ?? `process-flows/${id}.json`;
    zip.addFile(name, Buffer.from(JSON.stringify(flowDoc), "utf8"));
    zip.writeZip(zipPath);
    return zipPath;
  }

  it("ZIP 内 JSON の id が UUID 形式でない場合は SKIP (invalid id) となる", async () => {
    // entryName は process-flows/ で始める必要がある (フィルタ対象)
    // JSON body の id に不正値を埋め込む
    const zipPath = await makeZipWithId("../evil", "process-flows/evil.json");
    const relPath = path.relative(path.join(root, "harmony"), zipPath);
    const res = await handleProcessFlowTool(
      "designer__solution_unpack",
      { inputPath: relPath },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/SKIP \(invalid id\)/);
    expect(text).not.toMatch(/OK:/);
  });

  it("ZIP 内 JSON の id が空文字の場合は SKIP (no id) となる", async () => {
    const zipDir = path.join(root, "harmony", "input-id");
    await fs.mkdir(zipDir, { recursive: true });
    const zipPath = path.join(zipDir, `empty-id-${Date.now()}.zip`);
    const flowDoc = { id: "", meta: { id: "", name: "t", flowType: "common" }, context: {}, actions: [], authoring: { markers: [] } };
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ publisher: "test", version: "1.0.0", processFlowIds: [], createdAt: new Date().toISOString() }), "utf8"));
    zip.addFile("process-flows/empty.json", Buffer.from(JSON.stringify(flowDoc), "utf8"));
    zip.writeZip(zipPath);
    const relPath = path.relative(path.join(root, "harmony"), zipPath);
    const res = await handleProcessFlowTool(
      "designer__solution_unpack",
      { inputPath: relPath },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/SKIP \(no id\)/);
    expect(text).not.toMatch(/OK:/);
  });

  it("ZIP 内 JSON の id が正規 EntityId (kebab-case) の場合は OK となる", async () => {
    // I-7 Round 2 F-1 (#1299): EntityId は kebab-case のみ。alpha-leading UUID は
    // assertEntityId で reject されるため、kebab-case fixture id を使う。
    const validId = "ccc-unpack-test";
    const zipPath = await makeZipWithId(validId);
    const relPath = path.relative(path.join(root, "harmony"), zipPath);
    const res = await handleProcessFlowTool(
      "designer__solution_unpack",
      { inputPath: relPath },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/OK: ccc-unpack-test/);
  });

  it("ZIP 内 JSON の id が alpha-leading UUID の場合は SKIP (invalid id) となる (#1299 F-1)", async () => {
    // I-7 Round 2 F-1 (#1299 Codex review M-1): assertEntityId が alpha-leading UUID
    // (例: 'f81dd9e0-...') を reject するようになったため、ZIP 由来 id でも同様に
    // skip される。Phase A の compat shim 撤廃を ZIP 経路でも保証する regression test。
    const alphaLeadingUuid = "f81dd9e0-794c-4539-a2a5-9cbcc0a75899";
    const zipPath = await makeZipWithId(alphaLeadingUuid, "process-flows/alpha.json");
    const relPath = path.relative(path.join(root, "harmony"), zipPath);
    const res = await handleProcessFlowTool(
      "designer__solution_unpack",
      { inputPath: relPath },
      root,
      SESSION_ID,
    );
    expect(res).not.toBeNull();
    const text = res!.content[0].text as string;
    expect(text).toMatch(/SKIP \(invalid id\)/);
    expect(text).not.toMatch(/OK:/);
  });
});

// ── 8. designer__update_process_flow meta.id 整合性 (#1294 I-2 review Should-fix #2) ─

describe("designer__update_process_flow — meta.id 整合性 check (#1294 I-2)", () => {
  const root = path.join(TMP_ROOT, "ws-update-pf-metaid");
  beforeAll(async () => { await makeWorkspace(root); });

  it("processFlowId と definition.meta.id が不一致なら InvalidParams で reject", async () => {
    // 先に処理フローを 1 件作成して update 対象とする
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "meta-id-mismatch-test", flowType: "common" },
      root,
      SESSION_ID,
    );
    const message = addRes!.content[0].text as string;
    const idMatch = message.match(ID_CAPTURE_RE);
    const pfId = idMatch![1];

    // 異なる meta.id を持つ definition で update を試みる
    await expect(
      handleProcessFlowTool(
        "designer__update_process_flow",
        {
          processFlowId: pfId,
          definition: {
            meta: {
              id: "different-id",
              name: "renamed",
              flowType: "common",
              maturity: "draft",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
            context: {},
            actions: [],
            authoring: {},
          },
        },
        root,
        SESSION_ID,
      ),
    ).rejects.toThrow(/processFlowId.*definition\.meta\.id.*不一致/);
  });

  it("processFlowId と definition.meta.id が一致すれば update 成功", async () => {
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "meta-id-match-test", flowType: "common" },
      root,
      SESSION_ID,
    );
    const message = addRes!.content[0].text as string;
    const idMatch = message.match(ID_CAPTURE_RE);
    const pfId = idMatch![1];

    await expect(
      handleProcessFlowTool(
        "designer__update_process_flow",
        {
          processFlowId: pfId,
          definition: {
            meta: {
              id: pfId,
              name: "renamed-but-id-same",
              flowType: "common",
              maturity: "draft",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
            context: {},
            actions: [],
            authoring: {},
          },
        },
        root,
        SESSION_ID,
      ),
    ).resolves.toBeDefined();
  });

  it("definition.meta が未定義 / meta.id が無い場合は check skip (後方互換)", async () => {
    const addRes = await handleProcessFlowTool(
      "designer__add_process_flow",
      { name: "no-meta-id-test", flowType: "common" },
      root,
      SESSION_ID,
    );
    const message = addRes!.content[0].text as string;
    const idMatch = message.match(ID_CAPTURE_RE);
    const pfId = idMatch![1];

    // meta はあるが meta.id 無し
    await expect(
      handleProcessFlowTool(
        "designer__update_process_flow",
        {
          processFlowId: pfId,
          definition: {
            meta: {
              name: "no-meta-id",
              flowType: "common",
              maturity: "draft",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
            context: {},
            actions: [],
            authoring: {},
          },
        },
        root,
        SESSION_ID,
      ),
    ).resolves.toBeDefined();
  });
});
