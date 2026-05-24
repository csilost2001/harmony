/**
 * renameEntity preview / rename / undo の単体テスト (#1298 I-6, RFC #1284)。
 *
 * 実 fs (os.tmpdir() 配下に workspace を fixture 生成) を使う。理由:
 *   - atomic write / rollback の byte-identical 性は in-memory mock では検証できない
 *   - design.json 等 sub file の物理 file rename も含めて検証する必要がある
 *
 * test cases (設計コメント §「tests」の 8 項目):
 *   1. happy path (table, ref 0 件) — 主ファイル rename + uuid 不変
 *   2. ref 更新 (table rename → processFlow 内 tableId 3 件)
 *   3. uniqueness 衝突 (newId 既存) → throw + 副作用ゼロ
 *   4. lock 衝突 (他 session edit lock 保持) → throw
 *   5. failure inject (writeProcessFlow を fail させる) → snapshot から restore (byte-identical)
 *   6. undo (rename → undo) → 完全な元状態
 *   7. preview-only (state 変更なし、totalRefs / fileRenames 正)
 *   8. 7 entity type 各々で smoke test (代表 1 case ずつ)
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  previewEntityRename,
  renameEntityId,
  undoEntityRename,
  _clearUndoStoreForTest,
  _setStrictUnlinkOverrideForTest,
  type EditSessionLike,
  type RenameEntityType,
} from "./renameEntity.js";
import {
  harmonyFile,
  ensureDataDir,
  writeTable,
  writeProcessFlow,
  writeSequence,
  writeView,
  writeViewDefinition,
  writePageLayout,
  writeScreenEntity,
} from "./projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `rename-entity-test-${process.pid}-${Date.now()}`);
let workspaceCounter = 0;

async function makeWorkspace(): Promise<string> {
  const root = path.join(TMP_ROOT, `ws-${++workspaceCounter}`);
  await fs.mkdir(root, { recursive: true });
  const harmony = {
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: "test-ws",
      name: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    extensionsApplied: [],
    entities: {},
  };
  await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");
  await ensureDataDir(root, "harmony");
  return root;
}

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

beforeEach(() => {
  _clearUndoStoreForTest();
  vi.restoreAllMocks();
});

// ── helpers: fixture build ────────────────────────────────────────────────

async function seedTable(root: string, id: string, extra?: Record<string, unknown>): Promise<void> {
  await writeTable(id, { id, name: id, columns: [], ...extra }, root);
}

async function seedProcessFlow(
  root: string, id: string, body: Record<string, unknown>,
): Promise<void> {
  await writeProcessFlow(id, { id, name: id, ...body }, root);
}

async function readJsonFile<T = unknown>(absPath: string): Promise<T> {
  const content = await fs.readFile(absPath, "utf-8");
  return JSON.parse(content) as T;
}

function dataPath(root: string, ...segments: string[]): string {
  return path.join(root, "harmony", ...segments);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. happy path: table 1 つを rename, ref 0 件, uuid 不変
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — happy path (table, ref 0 件)", () => {
  it("主ファイルが新 id に移動し uuid が不変であること", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "old-table");

    const beforeFile = await readJsonFile<{ uuid: string }>(dataPath(root, "tables", "old-table.json"));
    expect(beforeFile.uuid).toBeTruthy();

    const { operation, preview } = await renameEntityId("table", "old-table", "new-table", root);

    // 主ファイル移動 + 旧ファイル削除
    await fs.access(dataPath(root, "tables", "new-table.json"));
    await expect(fs.access(dataPath(root, "tables", "old-table.json"))).rejects.toThrow();

    const afterFile = await readJsonFile<{ id: string; uuid: string }>(
      dataPath(root, "tables", "new-table.json"),
    );
    expect(afterFile.id).toBe("new-table");
    expect(afterFile.uuid).toBe(beforeFile.uuid); // uuid 不変
    expect(operation.uuid).toBe(beforeFile.uuid);

    expect(preview.fileRenames).toHaveLength(1);
    expect(preview.totalRefs).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. ref 更新: table rename → processFlow 内 tableId 3 件
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — ref 更新 (table → processFlow.tableId 3 件)", () => {
  it("3 箇所の tableId が新 id に置換されること", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "orders");

    await seedProcessFlow(root, "flow-1", {
      steps: [
        { id: "s1", kind: "db", tableId: "orders" },
        { id: "s2", kind: "db", tableId: "orders" },
        { id: "s3", kind: "db", tableId: "other-table" },
      ],
      meta: { description: "uses tableId via tableColumnRef", refs: [
        { tableColumnRef: { tableId: "orders", columnId: "id" } },
      ]},
    });

    const { preview } = await renameEntityId("table", "orders", "purchase-orders", root);
    expect(preview.totalRefs).toBe(3); // scalar 2 + composite 1

    const after = await readJsonFile<{
      steps: Array<{ tableId: string }>;
      meta: { refs: Array<{ tableColumnRef: { tableId: string; columnId: string } }> };
    }>(dataPath(root, "process-flows", "flow-1.json"));
    expect(after.steps[0].tableId).toBe("purchase-orders");
    expect(after.steps[1].tableId).toBe("purchase-orders");
    expect(after.steps[2].tableId).toBe("other-table"); // 無関係
    expect(after.meta.refs[0].tableColumnRef.tableId).toBe("purchase-orders");
    expect(after.meta.refs[0].tableColumnRef.columnId).toBe("id");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. uniqueness 衝突: newId が既存 → throw + 副作用ゼロ
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — uniqueness 衝突", () => {
  it("newId が既存と衝突する場合 throw し、ファイルに副作用が出ないこと", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "alpha");
    await seedTable(root, "beta");

    const alphaBefore = await fs.readFile(dataPath(root, "tables", "alpha.json"), "utf-8");
    const betaBefore = await fs.readFile(dataPath(root, "tables", "beta.json"), "utf-8");

    await expect(renameEntityId("table", "alpha", "beta", root)).rejects.toThrow(/既に同 workspace/);

    // 両ファイル byte-identical
    expect(await fs.readFile(dataPath(root, "tables", "alpha.json"), "utf-8")).toBe(alphaBefore);
    expect(await fs.readFile(dataPath(root, "tables", "beta.json"), "utf-8")).toBe(betaBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. lock 衝突: 他 session edit lock 保持 → throw
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — lock 衝突", () => {
  it("他 session が Edit lock を保持している場合 throw すること", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "locked-table");

    const editSessions: EditSessionLike[] = [{
      state: "Active",
      participants: new Map([
        ["other-sess", { sessionId: "other-sess", role: "Edit" }],
      ]),
    }];

    await expect(
      renameEntityId("table", "locked-table", "renamed-table", root, {
        sessionId: "self-sess",
        editSessions,
      }),
    ).rejects.toThrow(/他 session が編集中/);
    // 旧ファイル維持
    await fs.access(dataPath(root, "tables", "locked-table.json"));
  });

  it("自セッションが Edit lock を持っていても rename は通る (excluded)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "self-lock-table");

    const editSessions: EditSessionLike[] = [{
      state: "Active",
      participants: new Map([
        ["self-sess", { sessionId: "self-sess", role: "Edit" }],
      ]),
    }];

    const { operation } = await renameEntityId("table", "self-lock-table", "renamed", root, {
      sessionId: "self-sess",
      editSessions,
    });
    expect(operation.newId).toBe("renamed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. failure inject: writeProcessFlow を fail → snapshot から restore (byte-identical)
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — failure inject + rollback", () => {
  it("ref 側 write 中に失敗 → 全 file が rename 前の content に復元されること", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "tbl-x");
    await seedProcessFlow(root, "pf-a", { steps: [{ tableId: "tbl-x" }] });
    await seedProcessFlow(root, "pf-b", { steps: [{ tableId: "tbl-x" }] });

    const beforeTbl = await fs.readFile(dataPath(root, "tables", "tbl-x.json"), "utf-8");
    const beforePfA = await fs.readFile(dataPath(root, "process-flows", "pf-a.json"), "utf-8");
    const beforePfB = await fs.readFile(dataPath(root, "process-flows", "pf-b.json"), "utf-8");

    // 主ファイル write を fail させる (rewrittenPrimary を渡された時点)
    const projectStorage = await import("./projectStorage.js");
    const spy = vi.spyOn(projectStorage, "writeTable").mockImplementationOnce(async () => {
      throw new Error("inject: writeTable fail");
    });

    await expect(renameEntityId("table", "tbl-x", "tbl-y", root)).rejects.toThrow(/inject/);
    spy.mockRestore();

    // table ファイルが元の path に元の content で残ること
    expect(await fs.readFile(dataPath(root, "tables", "tbl-x.json"), "utf-8")).toBe(beforeTbl);
    await expect(fs.access(dataPath(root, "tables", "tbl-y.json"))).rejects.toThrow();

    // ref 側 (process flow) も元に戻ること (byte-identical)
    expect(await fs.readFile(dataPath(root, "process-flows", "pf-a.json"), "utf-8")).toBe(beforePfA);
    expect(await fs.readFile(dataPath(root, "process-flows", "pf-b.json"), "utf-8")).toBe(beforePfB);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. undo: rename → undo → 完全な元状態
// ─────────────────────────────────────────────────────────────────────────

describe("undoEntityRename", () => {
  it("rename 後の undo で全 file が元の content に復元されること", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "before-id");
    await seedProcessFlow(root, "pf-1", { steps: [{ tableId: "before-id" }] });

    const beforeTbl = await fs.readFile(dataPath(root, "tables", "before-id.json"), "utf-8");
    const beforePf = await fs.readFile(dataPath(root, "process-flows", "pf-1.json"), "utf-8");

    const { operation } = await renameEntityId("table", "before-id", "after-id", root);

    // 確認: rename 完了
    await fs.access(dataPath(root, "tables", "after-id.json"));

    const undoResult = await undoEntityRename(operation.operationId, root);
    expect(undoResult.restoredFiles).toBeGreaterThan(0);

    // 元 path + content
    expect(await fs.readFile(dataPath(root, "tables", "before-id.json"), "utf-8")).toBe(beforeTbl);
    expect(await fs.readFile(dataPath(root, "process-flows", "pf-1.json"), "utf-8")).toBe(beforePf);
    await expect(fs.access(dataPath(root, "tables", "after-id.json"))).rejects.toThrow();
  });

  it("operationId が一致しない場合 throw", async () => {
    const root = await makeWorkspace();
    await expect(undoEntityRename("nonexistent-op", root)).rejects.toThrow(/Undo 対象/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. preview-only: state 変更なし、totalRefs / fileRenames 正
// ─────────────────────────────────────────────────────────────────────────

describe("previewEntityRename — state 変更なし", () => {
  it("preview 後にファイル状態が変化しないこと", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "tbl-prev");
    await seedProcessFlow(root, "pf-prev", { steps: [{ tableId: "tbl-prev" }] });

    const beforeTbl = await fs.readFile(dataPath(root, "tables", "tbl-prev.json"), "utf-8");
    const beforePf = await fs.readFile(dataPath(root, "process-flows", "pf-prev.json"), "utf-8");

    const preview = await previewEntityRename("table", "tbl-prev", "tbl-renamed", root);
    expect(preview.uniqueOk).toBe(true);
    expect(preview.oldExists).toBe(true);
    expect(preview.lockedByOther).toBe(false);
    expect(preview.totalRefs).toBe(1);
    expect(preview.fileRenames).toHaveLength(1);
    expect(preview.fileRenames[0].from).toBe("tables/tbl-prev.json");
    expect(preview.fileRenames[0].to).toBe("tables/tbl-renamed.json");

    // ファイル状態 byte-identical
    expect(await fs.readFile(dataPath(root, "tables", "tbl-prev.json"), "utf-8")).toBe(beforeTbl);
    expect(await fs.readFile(dataPath(root, "process-flows", "pf-prev.json"), "utf-8")).toBe(beforePf);
    // 新 id 側 file が出現していないこと
    await expect(fs.access(dataPath(root, "tables", "tbl-renamed.json"))).rejects.toThrow();
  });

  it("uniqueness 衝突を uniqueOk=false で報告", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "a");
    await seedTable(root, "b");
    const preview = await previewEntityRename("table", "a", "b", root);
    expect(preview.uniqueOk).toBe(false);
    expect(preview.oldExists).toBe(true);
  });

  it("oldId 不在を oldExists=false で報告", async () => {
    const root = await makeWorkspace();
    const preview = await previewEntityRename("table", "nope", "new", root);
    expect(preview.oldExists).toBe(false);
  });

  it("lock を lockedByOther=true で報告", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "locked");
    const editSessions: EditSessionLike[] = [{
      state: "Active",
      participants: new Map([["x", { sessionId: "x", role: "Edit" }]]),
    }];
    const preview = await previewEntityRename("table", "locked", "renamed", root, {
      sessionId: "self", editSessions,
    });
    expect(preview.lockedByOther).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. 7 entity type 各々で smoke test (代表 1 case ずつ)
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — 7 entity type smoke", () => {
  it("table: rename 成功", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "t-old");
    const { operation } = await renameEntityId("table", "t-old", "t-new", root);
    expect(operation.entityType).toBe("table");
    await fs.access(dataPath(root, "tables", "t-new.json"));
  });

  it("processFlow: rename 成功 (id/uuid は meta 配下、top-level id 不在)", async () => {
    const root = await makeWorkspace();
    await seedProcessFlow(root, "pf-old", { steps: [] });
    const { operation } = await renameEntityId("processFlow", "pf-old", "pf-new", root);
    expect(operation.entityType).toBe("processFlow");
    const after = await readJsonFile<Record<string, unknown> & { meta: { id: string; uuid: string } }>(
      dataPath(root, "process-flows", "pf-new.json"),
    );
    // M-1: ProcessFlow は meta.id のみ持つ (top-level id は schema 違反、additionalProperties: false)
    expect(after.meta.id).toBe("pf-new");
    expect(after.meta.uuid).toBe(operation.uuid);
    expect("id" in after).toBe(false);
  });

  it("sequence: rename 成功", async () => {
    const root = await makeWorkspace();
    await writeSequence("seq-old", { id: "seq-old", steps: [] }, root);
    const { operation } = await renameEntityId("sequence", "seq-old", "seq-new", root);
    expect(operation.entityType).toBe("sequence");
    await fs.access(dataPath(root, "sequences", "seq-new.json"));
  });

  it("view: rename 成功", async () => {
    const root = await makeWorkspace();
    await writeView("v-old", { id: "v-old", baseTable: "x", columns: [] }, root);
    const { operation } = await renameEntityId("view", "v-old", "v-new", root);
    expect(operation.entityType).toBe("view");
    await fs.access(dataPath(root, "views", "v-new.json"));
  });

  it("viewDefinition: rename 成功", async () => {
    const root = await makeWorkspace();
    await writeViewDefinition("vd-old", { id: "vd-old", kind: "list" }, root);
    const { operation } = await renameEntityId("viewDefinition", "vd-old", "vd-new", root);
    expect(operation.entityType).toBe("viewDefinition");
    await fs.access(dataPath(root, "view-definitions", "vd-new.json"));
  });

  it("pageLayout: rename 成功 + design.json 同伴", async () => {
    const root = await makeWorkspace();
    await writePageLayout("pl-old", { id: "pl-old", regions: [] }, root);
    // design.json を raw write
    await fs.mkdir(dataPath(root, "page-layouts"), { recursive: true });
    await fs.writeFile(dataPath(root, "page-layouts", "pl-old.design.json"),
      JSON.stringify({ design: "payload" }), "utf-8");
    const { operation } = await renameEntityId("pageLayout", "pl-old", "pl-new", root);
    expect(operation.entityType).toBe("pageLayout");
    await fs.access(dataPath(root, "page-layouts", "pl-new.json"));
    await fs.access(dataPath(root, "page-layouts", "pl-new.design.json"));
    await expect(fs.access(dataPath(root, "page-layouts", "pl-old.design.json"))).rejects.toThrow();
  });

  it("screen: rename 成功 + design.json 同伴", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("scr-old", { id: "scr-old", kind: "page", path: "/old", items: [] }, root);
    // design.json
    await fs.writeFile(dataPath(root, "screens", "scr-old.design.json"),
      JSON.stringify({ pages: [] }), "utf-8");
    const { operation } = await renameEntityId("screen", "scr-old", "scr-new", root);
    expect(operation.entityType).toBe("screen");
    await fs.access(dataPath(root, "screens", "scr-new.json"));
    await fs.access(dataPath(root, "screens", "scr-new.design.json"));
    await expect(fs.access(dataPath(root, "screens", "scr-old.json"))).rejects.toThrow();
    await expect(fs.access(dataPath(root, "screens", "scr-old.design.json"))).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 追加: oldId === newId の no-op パス
// ─────────────────────────────────────────────────────────────────────────

describe("previewEntityRename — oldId === newId", () => {
  it("preview は no-op として通る (totalRefs=0, fileRenames=[])", async () => {
    const root = await makeWorkspace();
    const preview = await previewEntityRename("table", "same", "same", root);
    expect(preview.totalRefs).toBe(0);
    expect(preview.fileRenames).toEqual([]);
  });
});

describe("renameEntityId — oldId === newId", () => {
  it("throw する", async () => {
    const root = await makeWorkspace();
    await expect(renameEntityId("table", "same", "same", root)).rejects.toThrow(/同一/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Opus 独立レビュー Must-fix regression (M-1〜M-5 + S-2)
// ─────────────────────────────────────────────────────────────────────────

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas/v3");
let _ajvCached: InstanceType<typeof Ajv2020> | null = null;

/** test 用: process-flow.v3 / view-definition.v3 / harmony.v3 等を読み込んだ AJV instance を返す */
async function getAjvForRenameRegression(): Promise<InstanceType<typeof Ajv2020>> {
  if (_ajvCached) return _ajvCached;
  const ajv = new Ajv2020({ strict: false, allErrors: true, discriminator: true });
  addFormats(ajv);
  const schemaFiles = [
    "common.v3.schema.json",
    "extensions.v3.schema.json",
    "screen-item.v3.schema.json",
    "process-flow.v3.schema.json",
    "screen.v3.schema.json",
    "table.v3.schema.json",
    "view.v3.schema.json",
    "view-definition.v3.schema.json",
    "sequence.v3.schema.json",
    "page-layout.v3.schema.json",
    "harmony.v3.schema.json",
    "screen-flow-positions.v3.schema.json",
  ];
  for (const f of schemaFiles) {
    const text = await fs.readFile(path.join(SCHEMAS_DIR, f), "utf-8");
    const schema = JSON.parse(text) as { $id?: string };
    if (schema.$id && !ajv.getSchema(schema.$id)) {
      ajv.addSchema(schema);
    }
  }
  _ajvCached = ajv;
  return ajv;
}

const PROCESS_FLOW_SCHEMA_ID =
  "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/process-flow.v3.schema.json";
const VIEW_DEFINITION_SCHEMA_ID =
  "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/view-definition.v3.schema.json";

// ─── M-1: ProcessFlow rename 後の JSON が AJV pass する (top-level id 不在) ───

describe("renameEntityId — M-1: ProcessFlow rename → AJV pass + top-level id 不在", () => {
  it("real ProcessFlow fixture (meta.id 持ち) を rename → AJV pass", async () => {
    const root = await makeWorkspace();
    // 実在 schema に沿った最小 ProcessFlow を seed (meta + actions、top-level id なし)
    const minPf = {
      $schema: "../../../schemas/v3/process-flow.v3.schema.json",
      meta: {
        id: "pf-source",
        uuid: "11111111-1111-4111-8111-111111111111",
        name: "源フロー",
        flowType: "system",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      actions: [],
    };
    // raw write (writeProcessFlow が top-level id を勝手に付けない経路で seed)
    await fs.mkdir(dataPath(root, "process-flows"), { recursive: true });
    await fs.writeFile(
      dataPath(root, "process-flows", "pf-source.json"),
      JSON.stringify(minPf, null, 2),
      "utf-8",
    );

    await renameEntityId("processFlow", "pf-source", "pf-target", root);

    const after = await readJsonFile<Record<string, unknown>>(
      dataPath(root, "process-flows", "pf-target.json"),
    );
    // top-level id 不在
    expect("id" in after).toBe(false);
    // meta.id が newId
    expect((after.meta as { id: string }).id).toBe("pf-target");

    // AJV 通過 assertion
    const ajv = await getAjvForRenameRegression();
    const validate = ajv.getSchema(PROCESS_FLOW_SCHEMA_ID);
    if (!validate) throw new Error("process-flow schema not loaded");
    const ok = validate(after);
    if (!ok) {
      // 失敗時のデバッグ用に errors を出力
      // eslint-disable-next-line no-console
      console.error("AJV errors:", validate.errors);
    }
    expect(ok).toBe(true);
  });

  it("M-5: meta.id 未設定 fixture でも rename 後 meta.id === newId", async () => {
    const root = await makeWorkspace();
    // 旧 fixture: meta は uuid のみ持ち id なし (I-2 移行前 想定)
    const noMetaIdPf = {
      meta: {
        uuid: "22222222-2222-4222-8222-222222222222",
        name: "id 無し meta",
        flowType: "system",
        createdAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      actions: [],
    };
    await fs.mkdir(dataPath(root, "process-flows"), { recursive: true });
    await fs.writeFile(
      dataPath(root, "process-flows", "no-meta-id.json"),
      JSON.stringify(noMetaIdPf, null, 2),
      "utf-8",
    );

    await renameEntityId("processFlow", "no-meta-id", "with-meta-id", root);
    const after = await readJsonFile<{ meta: { id: string; uuid: string } } & Record<string, unknown>>(
      dataPath(root, "process-flows", "with-meta-id.json"),
    );
    expect(after.meta.id).toBe("with-meta-id");
    expect(after.meta.uuid).toBe("22222222-2222-4222-8222-222222222222"); // uuid 不変
    expect("id" in after).toBe(false);
  });
});

// ─── M-2: table rename が sourceTableId / referencedTableId / targetTableId を更新 ───

describe("renameEntityId — M-2: table rename が ViewDefinition.sourceTableId / FK.referencedTableId / ER targetTableId を更新", () => {
  it("ViewDefinition.sourceTableId が rename される + AJV-valid 構造を保持", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "store-master");

    // ViewDefinition seed: schema 整合な Level 1 (Simple) 構成
    const vd = {
      id: "store-master-list-viewer",
      uuid: "33333333-3333-4333-8333-333333333333",
      name: "店舗マスタ一覧",
      createdAt: "2026-05-25T00:00:00.000Z",
      updatedAt: "2026-05-25T00:00:00.000Z",
      kind: "list",
      sourceTableId: "store-master",
      columns: [
        {
          name: "store_code",
          fieldType: { kind: "string" },
          tableColumnRef: { tableId: "store-master", columnId: "code" },
        },
      ],
    };
    await fs.mkdir(dataPath(root, "view-definitions"), { recursive: true });
    await fs.writeFile(
      dataPath(root, "view-definitions", "store-master-list-viewer.json"),
      JSON.stringify(vd, null, 2),
      "utf-8",
    );

    // 事前 baseline: AJV validate (rename 前) を取って errors 集合を比較する
    const ajv = await getAjvForRenameRegression();
    const validate = ajv.getSchema(VIEW_DEFINITION_SCHEMA_ID);
    if (!validate) throw new Error("view-definition schema not loaded");
    const beforeValid = validate(vd);

    const { preview } = await renameEntityId("table", "store-master", "store", root);

    // refUpdates に sourceTableId と tableColumnRef.tableId 両方含まれること
    const sourceTableIdHit = preview.refUpdates.find(
      (r) => r.jsonPointer.endsWith("/sourceTableId") && r.oldValue === "store-master",
    );
    expect(sourceTableIdHit).toBeDefined();
    const tableColumnRefHit = preview.refUpdates.find(
      (r) => r.jsonPointer.includes("/tableColumnRef/tableId") && r.oldValue === "store-master",
    );
    expect(tableColumnRefHit).toBeDefined();

    const after = await readJsonFile<{
      sourceTableId: string;
      columns: Array<{ tableColumnRef: { tableId: string } }>;
    }>(dataPath(root, "view-definitions", "store-master-list-viewer.json"));
    expect(after.sourceTableId).toBe("store");
    expect(after.columns[0].tableColumnRef.tableId).toBe("store");

    // AJV validity が rename によって悪化していないこと (rename は schema validity を変えてはならない)
    const afterValid = validate(after);
    expect(afterValid).toBe(beforeValid);
  });

  it("Table.constraint.referencedTableId が rename される (FK)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "customer");
    // 参照 table: orders → customer の FK
    await writeTable("orders", {
      id: "orders",
      name: "orders",
      columns: [],
      constraints: [
        {
          id: "fk-1",
          kind: "foreignKey",
          columnIds: ["customer-id"],
          referencedTableId: "customer",
          referencedColumnIds: ["id"],
        },
      ],
    }, root);

    const { preview } = await renameEntityId("table", "customer", "user", root);
    const fkHit = preview.refUpdates.find(
      (r) => r.jsonPointer.endsWith("/referencedTableId") && r.oldValue === "customer",
    );
    expect(fkHit).toBeDefined();

    const ordersAfter = await readJsonFile<{
      constraints: Array<{ referencedTableId: string }>;
    }>(dataPath(root, "tables", "orders.json"));
    expect(ordersAfter.constraints[0].referencedTableId).toBe("user");
  });
});

// ─── M-3: screen rename が sourceScreenId / targetScreenId / harmony.entries[].id 更新 ───

describe("renameEntityId — M-3: screen rename が ScreenTransition (sourceScreenId/targetScreenId) を更新", () => {
  it("harmony.json screenTransitions[] の sourceScreenId / targetScreenId が更新される", async () => {
    const root = await makeWorkspace();
    // seed: 2 screen + harmony.json に screenTransitions 2 件
    await writeScreenEntity("login", { id: "login", kind: "page", path: "/login", items: [] }, root);
    await writeScreenEntity("dashboard", { id: "dashboard", kind: "page", path: "/", items: [] }, root);

    const harmonyData = {
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "ws", uuid: "44444444-4444-4444-8444-444444444444",
        name: "ws", createdAt: "2026-05-25T00:00:00.000Z", updatedAt: "2026-05-25T00:00:00.000Z",
      },
      extensionsApplied: [],
      entities: {
        screens: [
          { id: "login", no: 1, name: "login", kind: "page",
            updatedAt: "2026-05-25T00:00:00.000Z" },
          { id: "dashboard", no: 2, name: "dashboard", kind: "page",
            updatedAt: "2026-05-25T00:00:00.000Z" },
        ],
        screenTransitions: [
          { id: "t1", sourceScreenId: "login", targetScreenId: "dashboard", trigger: "submit" },
          { id: "t2", sourceScreenId: "dashboard", targetScreenId: "login", trigger: "logout" },
        ],
      },
      // Phase H N-1 (Opus round 2): `initialScreen` は harmony.v3 schema に未登録のため fixture
      // からも削除。test は schema 準拠の field (sourceScreenId/targetScreenId/entities.screens[].id)
      // のみで rename 網羅性を検証する。
    };
    await fs.writeFile(harmonyFile(root), JSON.stringify(harmonyData, null, 2), "utf-8");

    const { preview } = await renameEntityId("screen", "login", "sign-in", root);

    // sourceScreenId / targetScreenId / harmony.entries[].id を全部捕捉
    const matched = preview.refUpdates.filter((r) => r.entityKind === "project");
    const ptrs = matched.map((r) => r.jsonPointer).sort();
    // transitions[0].sourceScreenId + transitions[1].targetScreenId + entities/screens/0/id
    expect(ptrs).toContain("/entities/screens/0/id");
    expect(ptrs.some((p) => p.includes("/sourceScreenId"))).toBe(true);
    expect(ptrs.some((p) => p.includes("/targetScreenId"))).toBe(true);

    const harmonyAfter = await readJsonFile<{
      entities: {
        screens: Array<{ id: string }>;
        screenTransitions: Array<{ sourceScreenId: string; targetScreenId: string }>;
      };
    }>(harmonyFile(root));
    expect(harmonyAfter.entities.screens[0].id).toBe("sign-in");
    expect(harmonyAfter.entities.screens[1].id).toBe("dashboard"); // 無関係
    expect(harmonyAfter.entities.screenTransitions[0].sourceScreenId).toBe("sign-in");
    expect(harmonyAfter.entities.screenTransitions[1].targetScreenId).toBe("sign-in");
  });
});

// ─── M-4: screen-flow-positions の object KEY rename + harmony entries[].id rename ───

describe("renameEntityId — M-4: screen rename → screen-flow-positions.positions[KEY] migration", () => {
  it("positions[oldId] が消えて positions[newId] が新出する (KEY 置換)", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("home", { id: "home", kind: "page", path: "/", items: [] }, root);

    // screen-flow-positions.json seed (object KEY = screen id)
    const sfp = {
      positions: {
        "home": { x: 100, y: 100, width: 200, height: 80 },
        "other": { x: 300, y: 100, width: 200, height: 80 },
      },
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    await fs.writeFile(
      dataPath(root, "screen-flow-positions.json"),
      JSON.stringify(sfp, null, 2),
      "utf-8",
    );

    const { preview } = await renameEntityId("screen", "home", "landing", root);

    // /positions/home の match が refUpdates に含まれる
    const positionHit = preview.refUpdates.find(
      (r) => r.entityKind === "screenFlowPositions" && r.jsonPointer === "/positions/home",
    );
    expect(positionHit).toBeDefined();

    const sfpAfter = await readJsonFile<{ positions: Record<string, unknown> }>(
      dataPath(root, "screen-flow-positions.json"),
    );
    expect("home" in sfpAfter.positions).toBe(false);
    expect("landing" in sfpAfter.positions).toBe(true);
    expect("other" in sfpAfter.positions).toBe(true); // 無関係 KEY は維持
  });

  it("harmony.json entities.screens[].id が新 id に置換される (entry self-id)", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("scr-a", { id: "scr-a", kind: "page", path: "/a", items: [] }, root);

    const harmony = {
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "ws", uuid: "55555555-5555-4555-8555-555555555555",
        name: "ws", createdAt: "2026-05-25T00:00:00.000Z", updatedAt: "2026-05-25T00:00:00.000Z",
      },
      extensionsApplied: [],
      entities: {
        screens: [
          { id: "scr-a", no: 1, name: "A", kind: "page",
            updatedAt: "2026-05-25T00:00:00.000Z" },
        ],
      },
    };
    await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");

    await renameEntityId("screen", "scr-a", "scr-renamed", root);

    const after = await readJsonFile<{
      entities: { screens: Array<{ id: string }> };
    }>(harmonyFile(root));
    expect(after.entities.screens[0].id).toBe("scr-renamed");
  });

  it("Table rename → harmony.json entities.tables[].id も更新される", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "t-original");

    const harmony = {
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "ws", uuid: "66666666-6666-4666-8666-666666666666",
        name: "ws", createdAt: "2026-05-25T00:00:00.000Z", updatedAt: "2026-05-25T00:00:00.000Z",
      },
      extensionsApplied: [],
      entities: {
        tables: [
          { id: "t-original", no: 1, name: "Original", physicalName: "original",
            updatedAt: "2026-05-25T00:00:00.000Z" },
        ],
      },
    };
    await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");

    await renameEntityId("table", "t-original", "t-renamed", root);

    const after = await readJsonFile<{
      entities: { tables: Array<{ id: string }> };
    }>(harmonyFile(root));
    expect(after.entities.tables[0].id).toBe("t-renamed");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase F regression (Codex 独立レビュー Must-fix 6 + Should-fix 1)
//   F-1: ProcessFlow ref に handlerFlowId / refId 追加 (M-1)
//   F-2: er-layout.json scan source 追加 + positions KEY migration (M-2)
//   F-3: array / map walker (View.dependencies / PageLayout.assignments / ProcessFlow.tableIds) (M-3)
//   F-4: 自己参照 rewrite (Table self-FK / self-ref ProcessFlow) (M-4)
//   F-6: 旧ファイル削除 failure で snapshot rollback (M-6)
// ─────────────────────────────────────────────────────────────────────────

import { erLayoutFile } from "./projectStorage.js";

// ─── F-1: ProcessFlow rename が handlerFlowId / refId を更新 (Codex M-1) ───

describe("renameEntityId — Phase F M-1: ProcessFlow rename → handlerFlowId / refId 更新", () => {
  it("Screen items の event.handlerFlowId が新 id に置換される", async () => {
    const root = await makeWorkspace();
    // PF を seed
    await seedProcessFlow(root, "header-handler", { actions: [] });
    // Screen に handlerFlowId 参照を seed
    await writeScreenEntity("hdr-screen", {
      id: "hdr-screen",
      kind: "other",
      path: "/hdr",
      items: [
        {
          id: "btn",
          label: "ボタン",
          type: "boolean",
          direction: "input",
          events: [
            { id: "click", handlerFlowId: "header-handler", argumentMapping: {} },
          ],
        },
      ],
    }, root);

    const { preview } = await renameEntityId("processFlow", "header-handler", "header-handler-2", root);
    const hit = preview.refUpdates.find(
      (r) => r.jsonPointer.endsWith("/handlerFlowId") && r.oldValue === "header-handler",
    );
    expect(hit).toBeDefined();

    const scrAfter = await readJsonFile<{
      items: Array<{ events: Array<{ handlerFlowId: string }> }>;
    }>(dataPath(root, "screens", "hdr-screen.json"));
    expect(scrAfter.items[0].events[0].handlerFlowId).toBe("header-handler-2");
  });

  it("ProcessFlow commonProcess.refId が新 id に置換される", async () => {
    const root = await makeWorkspace();
    await seedProcessFlow(root, "common-logger", { actions: [] });
    await seedProcessFlow(root, "caller-flow", {
      actions: [
        {
          id: "act-1",
          steps: [
            { id: "s1", kind: "commonProcess", refId: "common-logger", description: "" },
          ],
        },
      ],
    });

    const { preview } = await renameEntityId("processFlow", "common-logger", "common-logger-v2", root);
    const hit = preview.refUpdates.find(
      (r) => r.jsonPointer.endsWith("/refId") && r.oldValue === "common-logger",
    );
    expect(hit).toBeDefined();

    const callerAfter = await readJsonFile<{
      actions: Array<{ steps: Array<{ refId: string }> }>;
    }>(dataPath(root, "process-flows", "caller-flow.json"));
    expect(callerAfter.actions[0].steps[0].refId).toBe("common-logger-v2");
  });

  it("retail global-header 形 fixture: 同一 PF を processFlowId と handlerFlowId 双方で参照しても両方更新される", async () => {
    const root = await makeWorkspace();
    await seedProcessFlow(root, "hdr-pf", { actions: [] });
    // Screen が processFlowId + items[].events[].handlerFlowId 両方で同 PF を参照
    await writeScreenEntity("hdr", {
      id: "hdr",
      kind: "other",
      path: "/hdr",
      processFlowId: "hdr-pf",
      items: [
        {
          id: "logout",
          label: "ログアウト",
          type: "boolean",
          direction: "input",
          events: [{ id: "click", handlerFlowId: "hdr-pf", argumentMapping: {} }],
        },
      ],
    }, root);

    const { preview } = await renameEntityId("processFlow", "hdr-pf", "hdr-pf-renamed", root);
    // processFlowId + handlerFlowId 両方が refUpdates に含まれる
    expect(preview.refUpdates.some((r) => r.jsonPointer === "/processFlowId")).toBe(true);
    expect(preview.refUpdates.some((r) => r.jsonPointer.endsWith("/handlerFlowId"))).toBe(true);

    const hdrAfter = await readJsonFile<{
      processFlowId: string;
      items: Array<{ events: Array<{ handlerFlowId: string }> }>;
    }>(dataPath(root, "screens", "hdr.json"));
    expect(hdrAfter.processFlowId).toBe("hdr-pf-renamed");
    expect(hdrAfter.items[0].events[0].handlerFlowId).toBe("hdr-pf-renamed");
  });
});

// ─── F-2: er-layout.json scan + positions KEY migration (Codex M-2) ────

describe("renameEntityId — Phase F M-2: er-layout.json scan + positions KEY migration", () => {
  it("Table rename → er-layout.positions[KEY] と logicalRelations[sourceTableId/targetTableId] 全部更新", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "customer");
    await seedTable(root, "orders");

    // er-layout.json seed: positions に KEY "customer" + logicalRelations に sourceTableId 参照
    const erLayout = {
      positions: {
        "customer": { x: 100, y: 100 },
        "orders": { x: 300, y: 100 },
      },
      logicalRelations: [
        {
          id: "lr-1",
          sourceTableId: "orders",
          targetTableId: "customer",
          cardinality: "many-to-many" as const,
        },
      ],
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    const dataRoot = path.join(root, "harmony");
    await fs.writeFile(erLayoutFile(dataRoot), JSON.stringify(erLayout, null, 2), "utf-8");

    const { preview } = await renameEntityId("table", "customer", "user", root);

    // refUpdates に er-layout 関連 location が含まれる
    const erHits = preview.refUpdates.filter((r) => r.entityKind === "erLayout");
    // 期待: /positions/customer (KEY) + /logicalRelations/0/targetTableId
    expect(erHits.length).toBeGreaterThanOrEqual(2);
    expect(erHits.some((r) => r.jsonPointer === "/positions/customer")).toBe(true);
    expect(erHits.some((r) => r.jsonPointer === "/logicalRelations/0/targetTableId")).toBe(true);

    const erAfter = await readJsonFile<{
      positions: Record<string, unknown>;
      logicalRelations: Array<{ sourceTableId: string; targetTableId: string }>;
    }>(erLayoutFile(dataRoot));
    expect("customer" in erAfter.positions).toBe(false);
    expect("user" in erAfter.positions).toBe(true);
    expect("orders" in erAfter.positions).toBe(true); // 無関係 KEY は維持
    expect(erAfter.logicalRelations[0].targetTableId).toBe("user");
    expect(erAfter.logicalRelations[0].sourceTableId).toBe("orders");
  });
});

// ─── F-3: array / map walker (Codex M-3) ──────────────────────────────

describe("renameEntityId — Phase F M-3: array / map 形の ref walker", () => {
  it("PageLayout.assignments map value が新 id に置換される (Screen rename)", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("global-header", {
      id: "global-header", kind: "other", path: "/g", items: [],
    }, root);
    await writePageLayout("main-layout", {
      id: "main-layout",
      regions: [{ name: "header" }, { name: "main" }],
      assignments: {
        header: "global-header",
        sidebar: "other-gadget",
      },
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    }, root);

    const { preview } = await renameEntityId("screen", "global-header", "global-header-v2", root);
    const hit = preview.refUpdates.find(
      (r) => r.jsonPointer === "/assignments/header" && r.oldValue === "global-header",
    );
    expect(hit).toBeDefined();

    const plAfter = await readJsonFile<{
      assignments: Record<string, string>;
    }>(dataPath(root, "page-layouts", "main-layout.json"));
    expect(plAfter.assignments.header).toBe("global-header-v2");
    expect(plAfter.assignments.sidebar).toBe("other-gadget"); // 無関係は維持
  });

  it("View.dependencies[] array に含まれる EntityId が新 id に置換される (Table rename)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "store-master");
    await writeView("store-view", {
      id: "store-view",
      physicalName: "store_view",
      selectStatement: "SELECT * FROM stores",
      outputColumns: [{ physicalName: "id", dataType: { kind: "string" } }],
      dependencies: ["store-master", "other-table"],
    }, root);

    const { preview } = await renameEntityId("table", "store-master", "store", root);
    const hit = preview.refUpdates.find(
      (r) => r.jsonPointer.startsWith("/dependencies/") && r.oldValue === "store-master",
    );
    expect(hit).toBeDefined();

    const viewAfter = await readJsonFile<{ dependencies: string[] }>(
      dataPath(root, "views", "store-view.json"),
    );
    expect(viewAfter.dependencies).toContain("store");
    expect(viewAfter.dependencies).toContain("other-table");
    expect(viewAfter.dependencies).not.toContain("store-master");
  });

  it("ProcessFlow CdcStep.tableIds[] array に含まれる EntityId が新 id に置換される (Table rename)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "audit-log");
    await seedProcessFlow(root, "cdc-flow", {
      actions: [
        {
          id: "act-cdc",
          steps: [
            {
              id: "s1",
              kind: "cdc",
              description: "CDC",
              tableIds: ["audit-log", "other-table"],
              captureMode: "incremental",
              destination: {},
            },
          ],
        },
      ],
    });

    const { preview } = await renameEntityId("table", "audit-log", "audit-event", root);
    const hit = preview.refUpdates.find(
      (r) => r.jsonPointer.startsWith("/actions/0/steps/0/tableIds/") && r.oldValue === "audit-log",
    );
    expect(hit).toBeDefined();

    const pfAfter = await readJsonFile<{
      actions: Array<{ steps: Array<{ tableIds: string[] }> }>;
    }>(dataPath(root, "process-flows", "cdc-flow.json"));
    expect(pfAfter.actions[0].steps[0].tableIds).toContain("audit-event");
    expect(pfAfter.actions[0].steps[0].tableIds).toContain("other-table");
    expect(pfAfter.actions[0].steps[0].tableIds).not.toContain("audit-log");
  });
});

// ─── F-4: 自己参照 rewrite (Codex M-4) ────────────────────────────────

describe("renameEntityId — Phase F M-4: 自己参照 (self-FK / self-ref) も rewrite される", () => {
  it("Table self-FK (constraints[].referencedTableId === 自己 id) が新 id に置換される", async () => {
    const root = await makeWorkspace();
    // 階層 Table (parent_id → 自身を参照する FK)
    await writeTable("category", {
      id: "category",
      name: "category",
      columns: [
        { id: "id-col", physicalName: "id", dataType: { kind: "string" } },
        { id: "parent-col", physicalName: "parent_id", dataType: { kind: "string" } },
      ],
      constraints: [
        {
          id: "fk-self",
          kind: "foreignKey",
          columnIds: ["parent-col"],
          referencedTableId: "category", // 自己参照
          referencedColumnIds: ["id-col"],
        },
      ],
    }, root);

    const { preview } = await renameEntityId("table", "category", "category-v2", root);
    // refUpdates に自己 ref location が含まれる (entityKind === "table" + entityId === "category")
    const selfRefHit = preview.refUpdates.find(
      (r) => r.entityKind === "table"
        && r.entityId === "category"
        && r.jsonPointer.endsWith("/referencedTableId")
        && r.oldValue === "category",
    );
    expect(selfRefHit).toBeDefined();

    // 新 file 内の自己 FK referencedTableId が newId に置換されていること
    const after = await readJsonFile<{
      id: string;
      constraints: Array<{ referencedTableId: string }>;
    }>(dataPath(root, "tables", "category-v2.json"));
    expect(after.id).toBe("category-v2");
    expect(after.constraints[0].referencedTableId).toBe("category-v2");

    // 旧 file は削除されていること
    await expect(fs.access(dataPath(root, "tables", "category.json"))).rejects.toThrow();
  });

  it("ProcessFlow 自己参照 (commonProcess.refId === 自己 id) も新 id に置換される", async () => {
    const root = await makeWorkspace();
    // PF が自身を再帰呼出する fixture
    await seedProcessFlow(root, "recursive-pf", {
      actions: [
        {
          id: "act-recurse",
          steps: [
            { id: "s1", kind: "commonProcess", refId: "recursive-pf", description: "self-call" },
          ],
        },
      ],
    });

    await renameEntityId("processFlow", "recursive-pf", "recursive-pf-v2", root);
    const after = await readJsonFile<{
      meta: { id: string };
      actions: Array<{ steps: Array<{ refId: string }> }>;
    }>(dataPath(root, "process-flows", "recursive-pf-v2.json"));
    expect(after.meta.id).toBe("recursive-pf-v2");
    expect(after.actions[0].steps[0].refId).toBe("recursive-pf-v2");
  });
});

// ─── F-6: 旧ファイル削除 failure → snapshot rollback (Codex M-6) ────────

describe("renameEntityId — Phase F M-6: 旧ファイル削除 failure → byte-identical rollback", () => {
  it("commit phase の strictUnlink が permission denied で fail → 旧 file 復元 + 新 file 削除", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "src-table");
    await seedProcessFlow(root, "ref-pf", { steps: [{ tableId: "src-table" }] });

    const beforeSrc = await fs.readFile(dataPath(root, "tables", "src-table.json"), "utf-8");
    const beforeRef = await fs.readFile(dataPath(root, "process-flows", "ref-pf.json"), "utf-8");

    // strictUnlink を上書きして、対象 src-table.json への delete のみ EACCES で fail させる。
    // 他 path (design.json 等) は real unlink で透過させる。
    _setStrictUnlinkOverrideForTest(async (p: string) => {
      if (p.endsWith(path.join("tables", "src-table.json"))) {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      try { await fs.unlink(p); } catch { /* ignore */ }
    });

    try {
      await expect(
        renameEntityId("table", "src-table", "dst-table", root),
      ).rejects.toThrow(/EACCES/);

      // 旧 file content が byte-identical で復元されていること (rollback 復元)
      expect(await fs.readFile(dataPath(root, "tables", "src-table.json"), "utf-8")).toBe(beforeSrc);
      // 新 file (dst-table.json) は削除されていること (同一 uuid file が複数残らない)
      await expect(fs.access(dataPath(root, "tables", "dst-table.json"))).rejects.toThrow();
      // 参照側 PF も rollback されていること
      expect(await fs.readFile(dataPath(root, "process-flows", "ref-pf.json"), "utf-8")).toBe(beforeRef);
    } finally {
      _setStrictUnlinkOverrideForTest(null);
    }
  });

  it("ENOENT (既に削除済) は tolerant: rename 成功扱い (副作用なし)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "src-2");

    // strictUnlink で対象 file への delete を ENOENT で fail させる (= 既に消えてる扱い)
    _setStrictUnlinkOverrideForTest(async (p: string) => {
      if (p.endsWith(path.join("tables", "src-2.json"))) {
        // ENOENT は tolerant 扱い: 実 strictUnlink と同じ早期 return
        return;
      }
      try { await fs.unlink(p); } catch { /* ignore */ }
    });

    try {
      const { operation } = await renameEntityId("table", "src-2", "dst-2", root);
      expect(operation.newId).toBe("dst-2");
      // 新 file 存在
      await fs.access(dataPath(root, "tables", "dst-2.json"));
    } finally {
      _setStrictUnlinkOverrideForTest(null);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase G regression (Codex round 2 独立レビュー、2026-05-25)
//   M-1: View.dependencies[] cross-type ambiguous (Table+View 共存) → block
//   M-2: legacy actions/<id>.json ProcessFlow rename → undo で orphan を残さない
//   M-3: undo の strictUnlink atomic (失敗時 byte-identical rollback)
//   M-4: 参照側 active EditSession 検出 → block
// ─────────────────────────────────────────────────────────────────────────

// ─── G M-1: cross-type ambiguous dependency ────────────────────────────

describe("renameEntityId — Phase G M-1: View.dependencies[] cross-type ambiguous は block", () => {
  it("Table と同名の View が共存し、別 View が View 側を dependencies で参照する場合に Table rename は throw", async () => {
    const root = await makeWorkspace();
    // Table "sales" と View "sales" を共存 (RFC #1284: entity type 内 unique なので valid)
    await seedTable(root, "sales");
    await writeView("sales", {
      id: "sales",
      physicalName: "v_sales",
      selectStatement: "SELECT 1",
      outputColumns: [{ physicalName: "n", dataType: { kind: "string" } }],
    }, root);
    // 別 View が View "sales" を dependencies で参照
    await writeView("monthly-sales", {
      id: "monthly-sales",
      physicalName: "v_monthly",
      selectStatement: "SELECT 1",
      outputColumns: [{ physicalName: "n", dataType: { kind: "string" } }],
      dependencies: ["sales"], // ambiguous: Table と View どちらの "sales" を指すか不明
    }, root);

    // preview は ambiguousDependencies を非空で返す
    const preview = await previewEntityRename("table", "sales", "sales-tbl", root);
    expect(preview.ambiguousDependencies.length).toBeGreaterThan(0);
    expect(preview.ambiguousDependencies[0].viewId).toBe("monthly-sales");
    expect(preview.ambiguousDependencies[0].conflictingEntityType).toBe("view");

    // execute は throw
    await expect(
      renameEntityId("table", "sales", "sales-tbl", root),
    ).rejects.toThrow(/ambiguous/);

    // ファイル状態は変化なし (silent corruption が無いこと)
    await fs.access(dataPath(root, "tables", "sales.json"));
    await expect(fs.access(dataPath(root, "tables", "sales-tbl.json"))).rejects.toThrow();
    const depAfter = await readJsonFile<{ dependencies: string[] }>(
      dataPath(root, "views", "monthly-sales.json"),
    );
    expect(depAfter.dependencies).toEqual(["sales"]);
  });

  it("同名 entity が他 type に無ければ通常通り rename される (ambiguous でない)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "orders");
    await writeView("orders-view", {
      id: "orders-view",
      physicalName: "v_orders",
      selectStatement: "SELECT 1",
      outputColumns: [{ physicalName: "n", dataType: { kind: "string" } }],
      dependencies: ["orders"], // Table "orders" のみ存在 → ambiguous でない
    }, root);

    const preview = await previewEntityRename("table", "orders", "orders-renamed", root);
    expect(preview.ambiguousDependencies).toEqual([]);

    const { operation } = await renameEntityId("table", "orders", "orders-renamed", root);
    expect(operation.newId).toBe("orders-renamed");
    const depAfter = await readJsonFile<{ dependencies: string[] }>(
      dataPath(root, "views", "orders-view.json"),
    );
    expect(depAfter.dependencies).toEqual(["orders-renamed"]);
  });
});

// ─── G M-2: legacy actions/ ProcessFlow rename + undo ──────────────────

describe("renameEntityId — Phase G M-2: legacy actions/<id>.json PF の rename + undo orphan 防止", () => {
  it("actions/<oldId>.json fixture を rename → process-flows/<newId>.json (canonical) に書かれ、orphan 無し", async () => {
    const root = await makeWorkspace();
    // legacy 配置で seed: actions/legacy-pf.json を直接 write
    const legacyDir = dataPath(root, "actions");
    await fs.mkdir(legacyDir, { recursive: true });
    const legacyPath = path.join(legacyDir, "legacy-pf.json");
    const initialContent = {
      meta: {
        id: "legacy-pf",
        uuid: "11111111-2222-3333-4444-555555555555",
        name: "legacy",
      },
      actions: [],
    };
    await fs.writeFile(legacyPath, JSON.stringify(initialContent, null, 2), "utf-8");

    const { operation } = await renameEntityId("processFlow", "legacy-pf", "new-pf", root);

    // canonical 側に書かれていること
    await fs.access(dataPath(root, "process-flows", "new-pf.json"));
    // legacy 側の old file は削除されていること
    await expect(fs.access(legacyPath)).rejects.toThrow();
    // legacy 側に new file は存在しないこと (= orphan 無し)
    await expect(fs.access(path.join(legacyDir, "new-pf.json"))).rejects.toThrow();

    // operation.fileRenames は legacy → canonical の plan を持つこと
    const planToCanonical = operation.fileRenames.find(
      (f) => f.from.includes("actions/") && f.to.includes("process-flows/"),
    );
    expect(planToCanonical).toBeDefined();

    // undo → legacy 側に restore + canonical 側削除 (完全 revert)
    await undoEntityRename(operation.operationId, root);
    await fs.access(legacyPath); // legacy 側に戻る
    await expect(fs.access(dataPath(root, "process-flows", "new-pf.json"))).rejects.toThrow();
    // orphan 無し
    await expect(fs.access(path.join(legacyDir, "new-pf.json"))).rejects.toThrow();

    // 復元 content が byte-identical (uuid 含む)
    const restoredContent = await readJsonFile<{ meta: { id: string; uuid: string } }>(legacyPath);
    expect(restoredContent.meta.id).toBe("legacy-pf");
    expect(restoredContent.meta.uuid).toBe("11111111-2222-3333-4444-555555555555");
  });
});

// ─── G M-3: undo の strict unlink atomic ────────────────────────────────

describe("renameEntityId — Phase G M-3: undo の new-path unlink が失敗 → byte-identical rollback + 再 undo 可", () => {
  it("undo 中の strictUnlink EACCES → rollback で rename 完了状態に戻り、operation は再度 undo 可能", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "tbl-old");
    await seedProcessFlow(root, "pf-x", { steps: [{ tableId: "tbl-old" }] });

    // rename 実行 (この時点では strictUnlink 透過)
    const { operation } = await renameEntityId("table", "tbl-old", "tbl-new", root);

    // rename 完了状態の bytes を保持
    const newPathAbs = dataPath(root, "tables", "tbl-new.json");
    const newRefAbs  = dataPath(root, "process-flows", "pf-x.json");
    const renamedNewPath = await fs.readFile(newPathAbs, "utf-8");
    const renamedRef     = await fs.readFile(newRefAbs, "utf-8");

    // undo 中の tbl-new.json delete を EACCES で fail させる
    _setStrictUnlinkOverrideForTest(async (p: string) => {
      if (p.endsWith(path.join("tables", "tbl-new.json"))) {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      try { await fs.unlink(p); } catch { /* ignore */ }
    });

    try {
      await expect(undoEntityRename(operation.operationId, root)).rejects.toThrow(/EACCES/);

      // rollback で rename 完了状態に戻ること (byte-identical)
      // (a) new path content が再復元
      expect(await fs.readFile(newPathAbs, "utf-8")).toBe(renamedNewPath);
      // (b) ref 側 (PF) が rename 完了時の newContent に戻る
      expect(await fs.readFile(newRefAbs, "utf-8")).toBe(renamedRef);
      // (c) old path は不在 (= rename 完了状態と一致)
      await expect(fs.access(dataPath(root, "tables", "tbl-old.json"))).rejects.toThrow();
    } finally {
      _setStrictUnlinkOverrideForTest(null);
    }

    // operation が再 push されており、再 undo が可能であること
    const undoResult = await undoEntityRename(operation.operationId, root);
    expect(undoResult.restoredFiles).toBeGreaterThan(0);
    // 完全 revert 確認
    await fs.access(dataPath(root, "tables", "tbl-old.json"));
    await expect(fs.access(newPathAbs)).rejects.toThrow();
  });
});

// ─── G M-4: ref-side active EditSession block ──────────────────────────

describe("renameEntityId — Phase G M-4: 参照側 entity の active Edit session があれば block", () => {
  it("ref scan で更新する ProcessFlow を別 session が Edit 中なら preview で concurrentEditRefs を報告、execute で throw", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "ref-tbl");
    await seedProcessFlow(root, "ref-pf", { steps: [{ tableId: "ref-tbl" }] });

    // fetchEditSessionsForRef を inject: ProcessFlow "ref-pf" には他 session の Edit がある
    const fetchEditSessionsForRef = (entityKind: string, entityId: string): ReadonlyArray<EditSessionLike> => {
      if (entityKind === "processFlow" && entityId === "ref-pf") {
        return [{
          state: "Active",
          participants: new Map([
            ["other-sess", { sessionId: "other-sess", role: "Edit" }],
          ]),
        }];
      }
      return [];
    };

    // preview は concurrentEditRefs を非空で返す
    const preview = await previewEntityRename("table", "ref-tbl", "new-tbl", root, {
      sessionId: "self", fetchEditSessionsForRef,
    });
    expect(preview.concurrentEditRefs.length).toBeGreaterThan(0);
    expect(preview.concurrentEditRefs[0].entityKind).toBe("processFlow");
    expect(preview.concurrentEditRefs[0].entityId).toBe("ref-pf");
    expect(preview.concurrentEditRefs[0].sessionId).toBe("other-sess");

    // execute は throw
    await expect(
      renameEntityId("table", "ref-tbl", "new-tbl", root, {
        sessionId: "self", fetchEditSessionsForRef,
      }),
    ).rejects.toThrow(/参照側.*編集中/);

    // ファイル状態は変化なし
    await fs.access(dataPath(root, "tables", "ref-tbl.json"));
    await expect(fs.access(dataPath(root, "tables", "new-tbl.json"))).rejects.toThrow();
  });

  it("自セッションが ref 側 Edit role でも rename は通る (excluded)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "self-ref-tbl");
    await seedProcessFlow(root, "self-pf", { steps: [{ tableId: "self-ref-tbl" }] });

    const fetchEditSessionsForRef = (entityKind: string, entityId: string): ReadonlyArray<EditSessionLike> => {
      if (entityKind === "processFlow" && entityId === "self-pf") {
        return [{
          state: "Active",
          participants: new Map([
            ["self-sess", { sessionId: "self-sess", role: "Edit" }],
          ]),
        }];
      }
      return [];
    };

    const { operation } = await renameEntityId("table", "self-ref-tbl", "renamed-tbl", root, {
      sessionId: "self-sess", fetchEditSessionsForRef,
    });
    expect(operation.newId).toBe("renamed-tbl");
  });

  it("fetchEditSessionsForRef 省略時は ref-side check skip (後方互換)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "skip-tbl");
    await seedProcessFlow(root, "skip-pf", { steps: [{ tableId: "skip-tbl" }] });

    // callback 渡さず → ref-side check 走らない
    const { operation } = await renameEntityId("table", "skip-tbl", "skip-tbl-v2", root);
    expect(operation.newId).toBe("skip-tbl-v2");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase I round 3+4 Must-fix D (3 AI 全員指摘): positions に oldId + newId 同時存在を
//   warning → **blocker** に格上げ。旧 Phase H N-2 の warning 経路は positionsCollisions
//   に分離され、execute 時 throw される。
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — Phase I D: positions key 衝突は blocker (preview.positionsCollisions + execute throw)", () => {
  it("screen-flow-positions に oldId と newId が同時存在 → preview.positionsCollisions が非空", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("home", { id: "home", kind: "page", path: "/", items: [] }, root);

    // screen-flow-positions.json seed: oldId "home" + newId "landing" が同時存在 (stale data)
    const sfp = {
      positions: {
        "home": { x: 100, y: 100, width: 200, height: 80 },
        "landing": { x: 300, y: 100, width: 200, height: 80 },
      },
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    await fs.writeFile(
      dataPath(root, "screen-flow-positions.json"),
      JSON.stringify(sfp, null, 2),
      "utf-8",
    );

    const preview = await previewEntityRename("screen", "home", "landing", root);

    // positionsCollisions が非空 + メッセージに oldId/newId/screen-flow-positions が含まれる
    expect(preview.positionsCollisions.length).toBeGreaterThan(0);
    expect(preview.positionsCollisions[0]).toMatch(/screen-flow-positions/);
    expect(preview.positionsCollisions[0]).toMatch(/"home"/);
    expect(preview.positionsCollisions[0]).toMatch(/"landing"/);
    // warnings 配列には positions collision メッセージは含まれない (blocker に分離済)
    expect(preview.warnings).toEqual([]);

    // refUpdates には positions の match が含まれない (skip された)
    const positionHits = preview.refUpdates.filter(
      (r) => r.entityKind === "screenFlowPositions" && r.jsonPointer.startsWith("/positions/"),
    );
    expect(positionHits.length).toBe(0);
  });

  it("er-layout.json で table rename 時に oldId と newId が同時存在 → preview.positionsCollisions 返却 + skip", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "orders");
    await seedTable(root, "orders-v2");

    // er-layout.json seed: oldId "orders" + newId "orders-v2" 同時存在 (stale data)
    const erLayout = {
      schemaVersion: "v3",
      updatedAt: "2026-05-25T00:00:00.000Z",
      positions: {
        "orders": { x: 0, y: 0, width: 200, height: 100 },
        "orders-v2": { x: 220, y: 0, width: 200, height: 100 },
      },
    };
    await fs.writeFile(
      erLayoutFile(path.join(root, "harmony")),
      JSON.stringify(erLayout, null, 2),
      "utf-8",
    );

    const preview = await previewEntityRename("table", "orders", "orders-v2", root);

    // 主 entity uniqueness 衝突は uniqueOk=false で別経路で検出されるため、本テストは
    // positionsCollisions 経路だけを assert する。
    expect(preview.positionsCollisions.length).toBeGreaterThan(0);
    expect(preview.positionsCollisions[0]).toMatch(/er-layout/);
    expect(preview.positionsCollisions[0]).toMatch(/"orders"/);
    expect(preview.positionsCollisions[0]).toMatch(/"orders-v2"/);

    // positions match は出ない (skip)
    const erPositionHits = preview.refUpdates.filter(
      (r) => r.entityKind === "erLayout" && r.jsonPointer.startsWith("/positions/"),
    );
    expect(erPositionHits.length).toBe(0);
  });

  it("通常 case (oldId のみ存在) は positionsCollisions 空", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("normal", { id: "normal", kind: "page", path: "/n", items: [] }, root);

    const sfp = {
      positions: {
        "normal": { x: 0, y: 0, width: 200, height: 80 },
      },
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    await fs.writeFile(
      dataPath(root, "screen-flow-positions.json"),
      JSON.stringify(sfp, null, 2),
      "utf-8",
    );

    const preview = await previewEntityRename("screen", "normal", "renamed", root);
    expect(preview.positionsCollisions.length).toBe(0);
    expect(preview.warnings.length).toBe(0);
  });

  it("renameEntityId は positionsCollisions が非空なら throw する (execute blocker)", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("src", { id: "src", kind: "page", path: "/s", items: [] }, root);

    const sfp = {
      positions: {
        "src": { x: 0, y: 0, width: 200, height: 80 },
        "dst": { x: 220, y: 0, width: 200, height: 80 }, // stale newId
      },
      updatedAt: "2026-05-25T00:00:00.000Z",
    };
    await fs.writeFile(
      dataPath(root, "screen-flow-positions.json"),
      JSON.stringify(sfp, null, 2),
      "utf-8",
    );

    // execute は throw — 旧 silent success 経路を blocker に格上げ
    await expect(renameEntityId("screen", "src", "dst", root)).rejects.toThrow(/positions key 衝突/);

    // 主 entity ファイル状態は変化なし (block されたため)
    await fs.access(dataPath(root, "screens", "src.json"));
    await expect(fs.access(dataPath(root, "screens", "dst.json"))).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase I round 3+4 Must-fix B (3 AI 全員指摘): Flow / ER singleton EditSession を
//   detectConcurrentEditRefs から skip しない (rename ref scan が当該 file を touch する場合は
//   block 対象)。
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — Phase I B: singleton EditSession (flow/er-layout) も ref-side lock check", () => {
  it("Screen rename で harmony.json を編集する場合、flow/singleton session を block 対象に含める", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("home", { id: "home", kind: "page", path: "/", items: [] }, root);

    // harmony.json の entities.screens に home を追加 → ref scan が harmony.json を touch する
    const harmony = JSON.parse(await fs.readFile(path.join(root, "harmony.json"), "utf-8")) as Record<string, unknown>;
    (harmony.entities as Record<string, unknown>).screens = [{ id: "home", uuid: "00000000-0000-4000-8000-000000000001" }];
    await fs.writeFile(path.join(root, "harmony.json"), JSON.stringify(harmony, null, 2), "utf-8");

    // fetchEditSessionsForRef: project (= flow/singleton) に active Edit がある
    const fetcher = (entityKind: string, entityId: string): ReadonlyArray<EditSessionLike> => {
      if (entityKind === "project" && entityId === "harmony.json") {
        return [{
          state: "Active",
          participants: new Map([
            ["other-sess", { sessionId: "other-sess", role: "Edit" }],
          ]),
        }];
      }
      return [];
    };

    // preview は concurrentEditRefs に project を含む (skip されない)
    const preview = await previewEntityRename("screen", "home", "renamed", root, {
      sessionId: "self", fetchEditSessionsForRef: fetcher,
    });
    expect(preview.concurrentEditRefs.some((r) => r.entityKind === "project")).toBe(true);

    // execute は throw
    await expect(
      renameEntityId("screen", "home", "renamed", root, {
        sessionId: "self", fetchEditSessionsForRef: fetcher,
      }),
    ).rejects.toThrow(/参照側.*編集中/);
  });

  it("Table rename で er-layout.json を編集する場合、erLayout singleton session を block 対象に含める", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "accounts");

    // er-layout.json seed: positions に accounts エントリ + logicalRelations
    const erLayout = {
      schemaVersion: "v3",
      updatedAt: "2026-05-25T00:00:00.000Z",
      positions: { "accounts": { x: 0, y: 0, width: 200, height: 100 } },
    };
    await fs.writeFile(erLayoutFile(path.join(root, "harmony")), JSON.stringify(erLayout, null, 2), "utf-8");

    const fetcher = (entityKind: string, entityId: string): ReadonlyArray<EditSessionLike> => {
      if (entityKind === "erLayout" && entityId === "er-layout.json") {
        return [{
          state: "Active",
          participants: new Map([
            ["er-sess", { sessionId: "er-sess", role: "Edit" }],
          ]),
        }];
      }
      return [];
    };

    const preview = await previewEntityRename("table", "accounts", "accounts-v2", root, {
      sessionId: "self", fetchEditSessionsForRef: fetcher,
    });
    expect(preview.concurrentEditRefs.some((r) => r.entityKind === "erLayout")).toBe(true);

    await expect(
      renameEntityId("table", "accounts", "accounts-v2", root, {
        sessionId: "self", fetchEditSessionsForRef: fetcher,
      }),
    ).rejects.toThrow(/参照側.*編集中/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase I round 3+4 Must-fix C (3 AI 全員指摘): undo は rename 後の事後編集を破棄しない
//   (block + 再 undo 可能) + rollback も undo 開始時 bytes で復元する
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — Phase I C: undo post-update detection + rollback uses current bytes", () => {
  it("rename → ref 側 file を編集 → undo は block + 再 undo 可能", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "src-tbl");
    await seedProcessFlow(root, "ref-pf", { steps: [{ tableId: "src-tbl" }] });

    // rename 実行
    const { operation } = await renameEntityId("table", "src-tbl", "renamed-tbl", root);

    // rename 後の ref file (process-flow) を編集 (新 tableId は維持しつつ追加 step を入れる)
    const pfPath = dataPath(root, "process-flows", "ref-pf.json");
    const pf = JSON.parse(await fs.readFile(pfPath, "utf-8")) as Record<string, unknown>;
    (pf.steps as Array<Record<string, unknown>>).push({ tableId: "renamed-tbl", extraNote: "user added after rename" });
    await fs.writeFile(pfPath, JSON.stringify(pf, null, 2), "utf-8");

    // undo は block (事後編集検出)
    await expect(undoEntityRename(operation.operationId, root)).rejects.toThrow(/Undo を block|rename 後に編集/);

    // user の事後編集は保持されている (pf の steps が 2 件のまま)
    const after = JSON.parse(await fs.readFile(pfPath, "utf-8")) as Record<string, unknown>;
    expect((after.steps as Array<Record<string, unknown>>).length).toBe(2);

    // operation は再 pushUndo されているため、再 undo を試みると同じ block error が出る
    await expect(undoEntityRename(operation.operationId, root)).rejects.toThrow(/Undo を block|rename 後に編集/);
  });

  it("rename → 事後編集なし → undo 成功 (完全 revert)", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "src2");
    await seedProcessFlow(root, "ref-pf2", { steps: [{ tableId: "src2" }] });

    const { operation } = await renameEntityId("table", "src2", "renamed2", root);

    // undo (事後編集なし) → 成功
    const result = await undoEntityRename(operation.operationId, root);
    expect(result.restoredFiles).toBeGreaterThan(0);
    // 旧 path 復元 + 新 path 削除
    await fs.access(dataPath(root, "tables", "src2.json"));
    await expect(fs.access(dataPath(root, "tables", "renamed2.json"))).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase I round 3+4 Must-fix E (Antigravity M-6): generic-definitions の path 形式 ref も
//   rename 対象に含める (`relations[].ref: "tables/<id>"` 等)
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — Phase I E: generic-definitions の path 形式 ref も rewrite", () => {
  it("Table rename で generic-definitions の `tables/<oldId>` ref が新 id に更新される", async () => {
    const root = await makeWorkspace();
    await seedTable(root, "transactions");

    // generic-definitions/data-contract/TransactionCreateRequest.json を seed
    const gdDir = dataPath(root, "generic-definitions", "data-contract");
    await fs.mkdir(gdDir, { recursive: true });
    const gd = {
      kind: "data-contract",
      name: "TransactionCreateRequest",
      relations: [
        { kind: "transformsTo", ref: "tables/transactions", description: "INSERT 先" },
        { kind: "uses", ref: "generic-definitions/domain-type/Money" },
      ],
    };
    const gdPath = path.join(gdDir, "TransactionCreateRequest.json");
    await fs.writeFile(gdPath, JSON.stringify(gd, null, 2), "utf-8");

    // rename Table
    const { preview } = await renameEntityId("table", "transactions", "tx-records", root);

    // preview.refUpdates に genericDefinition の hit が含まれる
    const gdHits = preview.refUpdates.filter((r) => r.entityKind === "genericDefinition");
    expect(gdHits.length).toBeGreaterThan(0);
    expect(gdHits[0].entityId).toBe("data-contract/TransactionCreateRequest");

    // 実 file が更新されている
    const updated = JSON.parse(await fs.readFile(gdPath, "utf-8")) as Record<string, unknown>;
    const rels = updated.relations as Array<Record<string, unknown>>;
    expect(rels[0].ref).toBe("tables/tx-records");
    // 自己参照型 (generic-definitions/...) は touch しない
    expect(rels[1].ref).toBe("generic-definitions/domain-type/Money");
  });

  it("Screen rename で generic-definitions の `screens/<oldId>` ref が更新される", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("dashboard", { id: "dashboard", kind: "page", path: "/d", items: [] }, root);

    const gdDir = dataPath(root, "generic-definitions", "application-rule");
    await fs.mkdir(gdDir, { recursive: true });
    const gd = {
      kind: "application-rule",
      name: "DeficitWarning",
      relations: [{ kind: "appliesTo", ref: "screens/dashboard" }],
    };
    const gdPath = path.join(gdDir, "DeficitWarning.json");
    await fs.writeFile(gdPath, JSON.stringify(gd, null, 2), "utf-8");

    await renameEntityId("screen", "dashboard", "main-board", root);

    const updated = JSON.parse(await fs.readFile(gdPath, "utf-8")) as Record<string, unknown>;
    expect((updated.relations as Array<Record<string, unknown>>)[0].ref).toBe("screens/main-board");
  });

  it("ProcessFlow rename で generic-definitions の `process-flows/<oldId>` ref が更新される", async () => {
    const root = await makeWorkspace();
    await seedProcessFlow(root, "createTx", {});

    const gdDir = dataPath(root, "generic-definitions", "runtime-policy");
    await fs.mkdir(gdDir, { recursive: true });
    const gd = {
      kind: "runtime-policy",
      name: "BackendRetryPolicy",
      relations: [{ kind: "appliesTo", ref: "process-flows/createTx" }],
    };
    const gdPath = path.join(gdDir, "BackendRetryPolicy.json");
    await fs.writeFile(gdPath, JSON.stringify(gd, null, 2), "utf-8");

    await renameEntityId("processFlow", "createTx", "createTransaction", root);

    const updated = JSON.parse(await fs.readFile(gdPath, "utf-8")) as Record<string, unknown>;
    expect((updated.relations as Array<Record<string, unknown>>)[0].ref).toBe("process-flows/createTransaction");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase I round 3+4 Must-fix F (Codex round 4 M-5): Puck Screen rename が
//   `screens/<id>/puck-data.json` を新 directory に移動 + entity の puckDataRef 整合
// ─────────────────────────────────────────────────────────────────────────

describe("renameEntityId — Phase I F: Puck Screen rename → puck-data.json 同伴 + schema 整合", () => {
  it("Puck screen rename で puck-data.json が新 directory に移動し、entity は puckDataRef のみ持つ", async () => {
    const root = await makeWorkspace();
    // Puck screen entity を seed (design.editorKind = "puck")
    await writeScreenEntity("puck-scr", {
      id: "puck-scr",
      kind: "page",
      path: "/p",
      items: [],
      design: { editorKind: "puck", puckDataRef: "puck-data.json" },
    }, root);

    // puck-data.json を seed (screens/<id>/puck-data.json)
    const oldPuckPath = dataPath(root, "screens", "puck-scr", "puck-data.json");
    await fs.mkdir(path.dirname(oldPuckPath), { recursive: true });
    await fs.writeFile(oldPuckPath, JSON.stringify({ root: { type: "Root" }, content: [] }, null, 2), "utf-8");

    // rename
    await renameEntityId("screen", "puck-scr", "renamed-puck", root);

    // 新 directory に puck-data.json が存在
    const newPuckPath = dataPath(root, "screens", "renamed-puck", "puck-data.json");
    await fs.access(newPuckPath);
    // 旧 directory は cleanup されている (rmdir best-effort、puck-data.json は削除済)
    await expect(fs.access(oldPuckPath)).rejects.toThrow();

    // 新 entity ファイルは puckDataRef のみ持ち、designFileRef を持たない (schema 整合)
    const newEntity = JSON.parse(
      await fs.readFile(dataPath(root, "screens", "renamed-puck.json"), "utf-8"),
    ) as Record<string, unknown>;
    const design = newEntity.design as Record<string, unknown>;
    expect(design.editorKind).toBe("puck");
    expect(design.puckDataRef).toBe("puck-data.json");
    expect(design.designFileRef).toBeUndefined();
  });

  it("grapesjs screen の writeScreenEntity は designFileRef のみで puckDataRef を持たない (regression)", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("g-scr", {
      id: "g-scr",
      kind: "page",
      path: "/g",
      items: [],
      design: { editorKind: "grapesjs" },
    }, root);

    const entity = JSON.parse(
      await fs.readFile(dataPath(root, "screens", "g-scr.json"), "utf-8"),
    ) as Record<string, unknown>;
    const design = entity.design as Record<string, unknown>;
    expect(design.editorKind).toBe("grapesjs");
    expect(design.designFileRef).toBe("g-scr.design.json");
    expect(design.puckDataRef).toBeUndefined();
  });

  it("Puck screen rename の undo は puck-data.json も旧 path に復元する", async () => {
    const root = await makeWorkspace();
    await writeScreenEntity("p2", {
      id: "p2",
      kind: "page",
      path: "/p2",
      items: [],
      design: { editorKind: "puck", puckDataRef: "puck-data.json" },
    }, root);
    const oldPuckPath = dataPath(root, "screens", "p2", "puck-data.json");
    const puckContent = JSON.stringify({ root: { type: "Root" }, content: [{ type: "Text" }] }, null, 2);
    await fs.mkdir(path.dirname(oldPuckPath), { recursive: true });
    await fs.writeFile(oldPuckPath, puckContent, "utf-8");

    const { operation } = await renameEntityId("screen", "p2", "p2-renamed", root);

    // undo
    await undoEntityRename(operation.operationId, root);

    // 旧 path に puck-data.json が復元 + 新 path は削除
    const restored = await fs.readFile(oldPuckPath, "utf-8");
    expect(restored).toBe(puckContent);
    await expect(
      fs.access(dataPath(root, "screens", "p2-renamed", "puck-data.json")),
    ).rejects.toThrow();
  });
});
