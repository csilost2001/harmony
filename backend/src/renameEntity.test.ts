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
      initialScreen: "login",
    };
    await fs.writeFile(harmonyFile(root), JSON.stringify(harmonyData, null, 2), "utf-8");

    const { preview } = await renameEntityId("screen", "login", "sign-in", root);

    // sourceScreenId / targetScreenId / initialScreen / harmony.entries[].id 全部捕捉
    const matched = preview.refUpdates.filter((r) => r.entityKind === "project");
    const ptrs = matched.map((r) => r.jsonPointer).sort();
    // initialScreen + transitions[0].sourceScreenId + transitions[1].targetScreenId + entities/screens/0/id
    expect(ptrs).toContain("/initialScreen");
    expect(ptrs).toContain("/entities/screens/0/id");
    expect(ptrs.some((p) => p.includes("/sourceScreenId"))).toBe(true);
    expect(ptrs.some((p) => p.includes("/targetScreenId"))).toBe(true);

    const harmonyAfter = await readJsonFile<{
      initialScreen: string;
      entities: {
        screens: Array<{ id: string }>;
        screenTransitions: Array<{ sourceScreenId: string; targetScreenId: string }>;
      };
    }>(harmonyFile(root));
    expect(harmonyAfter.initialScreen).toBe("sign-in");
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
