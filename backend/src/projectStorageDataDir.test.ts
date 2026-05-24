/**
 * projectStorage R-2 (#851) — dataDir ベース path resolve の unit test
 *
 * 受け入れ基準:
 * 1. 異なる dataDir 値 ("harmony" / "design/spec" / "納品物") の workspace を tmp dir に fixture で作成
 * 2. 各 dataDir で screen / table / processFlow / extension の read/write が正しい path に向くことを検証
 * 3. 旧 project.json への参照が完全に消えたことを grep で検証する test 1 件
 * 4. harmonyFile(root) が root/harmony.json を返すことの確認
 * 5. resolveDataRoot が harmony.json の dataDir に応じた正しい path を返すことの確認
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  harmonyFile,
  resolveDataRoot,
  ensureDataDir,
  readProject,
  writeProject,
  readTable,
  writeTable,
  readProcessFlow,
  writeProcessFlow,
  readScreen,
  writeScreen,
  readScreenEntity,
  writeScreenEntity,
  readConventions,
  writeConventions,
  readSequence,
  writeSequence,
  readView,
  writeView,
  readCustomBlocks,
  writeCustomBlocks,
  readErLayout,
  writeErLayout,
  // #1294 I-2 / RFC #1284: kebab-case EntityId + uuid 構造の helper
  listExistingEntityIds,
  ensureUniqueEntityId,
} from "./projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `proj-storage-r2-test-${process.pid}-${Date.now()}`);

/** 最小限の有効な harmony.json を指定の dataDir で作成し、サブディレクトリ群も作成する */
async function makeWorkspace(root: string, dataDirVal: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const harmony = {
    schemaVersion: "v3",
    dataDir: dataDirVal,
    meta: {
      id: `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0")}`,
      name: `test-${dataDirVal}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    extensionsApplied: [],
    entities: {},
  };
  await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");
  await ensureDataDir(root, dataDirVal);
}

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

// ── 1. harmonyFile のパス確認 ──────────────────────────────────────────────────

describe("harmonyFile", () => {
  it("workspace root 直下の harmony.json パスを返す (dataDir 配下ではない)", () => {
    const root = "/some/workspace";
    const result = harmonyFile(root);
    expect(result).toBe(path.join("/some/workspace", "harmony.json"));
    // project.json への参照を返さないこと
    expect(result).not.toContain("project.json");
  });
});

// ── 2. resolveDataRoot ─────────────────────────────────────────────────────────

describe("resolveDataRoot", () => {
  const rootA = path.join(TMP_ROOT, "resolve-test");

  beforeAll(async () => {
    await makeWorkspace(rootA, "my-data");
  });

  it("harmony.json の dataDir に応じた正しい dataRoot を返す", async () => {
    const result = await resolveDataRoot(rootA);
    expect(result).toBe(path.join(rootA, "my-data"));
  });

  it("harmony.json が存在しない場合は Error を throw する", async () => {
    const missing = path.join(TMP_ROOT, "no-harmony");
    await fs.mkdir(missing, { recursive: true });
    await expect(resolveDataRoot(missing)).rejects.toThrow("harmony.json が見つかりません");
  });

  it("dataDir が空文字の harmony.json では Error を throw する", async () => {
    const rootBad = path.join(TMP_ROOT, "bad-datadir");
    await fs.mkdir(rootBad, { recursive: true });
    await fs.writeFile(
      harmonyFile(rootBad),
      JSON.stringify({ schemaVersion: "v3", dataDir: "", meta: {}, extensionsApplied: [], entities: {} }),
      "utf-8",
    );
    await expect(resolveDataRoot(rootBad)).rejects.toThrow("dataDir フィールドが不正");
  });
});

// ── 3. dataDir = "harmony" (デフォルト) でのデータ読み書き ────────────────────

describe("dataDir = 'harmony' (デフォルト)", () => {
  const root = path.join(TMP_ROOT, "ws-harmony");

  beforeAll(async () => {
    await makeWorkspace(root, "harmony");
  });

  it("harmony.json を readProject で読み込める", async () => {
    const proj = await readProject(root);
    expect(proj).not.toBeNull();
    expect((proj as Record<string, unknown>).dataDir).toBe("harmony");
  });

  it("writeProject → readProject で harmony.json に永続化される", async () => {
    const updated = { schemaVersion: "v3", dataDir: "harmony", meta: { id: "x", name: "updated", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" }, extensionsApplied: [], entities: {} };
    await writeProject(updated, root);
    const result = await readProject(root);
    expect((result as Record<string, unknown>).meta).toMatchObject({ name: "updated" });
    // project.json は存在しないこと
    await expect(fs.access(path.join(root, "project.json"))).rejects.toThrow();
  });

  it("writeTable → readTable で <dataDir>/tables/ に書き込まれる", async () => {
    await writeTable("tbl-001", { id: "tbl-001", name: "orders" }, root);
    const data = await readTable("tbl-001", root);
    expect(data).toMatchObject({ id: "tbl-001", name: "orders" });
    // 物理ファイルの位置を確認
    await fs.access(path.join(root, "harmony", "tables", "tbl-001.json"));
  });

  it("writeProcessFlow → readProcessFlow で <dataDir>/process-flows/ に書き込まれる (#1141 v3 規範 path)", async () => {
    await writeProcessFlow("flow-001", { id: "flow-001", steps: [] }, root);
    const data = await readProcessFlow("flow-001", root);
    expect(data).toMatchObject({ id: "flow-001" });
    // #1141 F-4: 新規は v3 規範 path (process-flows/) に書き込まれる
    await fs.access(path.join(root, "harmony", "process-flows", "flow-001.json"));
  });

  it("writeProcessFlow → 既存 actions/<id>.json があれば legacy path を維持する (#1141 後方互換)", async () => {
    // 事前に legacy 配置 (actions/) にファイルを置いておく
    const legacyPath = path.join(root, "harmony", "actions", "legacy-flow.json");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, JSON.stringify({ id: "legacy-flow" }), "utf-8");
    await writeProcessFlow("legacy-flow", { id: "legacy-flow", steps: [] }, root);
    // 既存 actions/ 配置が維持されている
    await fs.access(legacyPath);
    // process-flows/ には新規ファイルが作成されない
    await expect(fs.access(path.join(root, "harmony", "process-flows", "legacy-flow.json"))).rejects.toThrow();
  });

  it("writeScreen / readScreen で <dataDir>/screens/ に書き込まれる", async () => {
    await writeScreen("scr-001", { assets: [], styles: [], pages: [] }, root);
    // readScreen は .design.json を読む
    const design = await readScreen("scr-001", root);
    expect(design).toMatchObject({ assets: [], pages: [] });
    // entity ファイルの物理位置を確認
    await fs.access(path.join(root, "harmony", "screens", "scr-001.json"));
  });

  it("writeConventions → readConventions で <dataDir>/conventions/ に書き込まれる", async () => {
    await writeConventions({ version: 1, rules: [] }, root);
    const data = await readConventions(root);
    expect(data).toMatchObject({ version: 1 });
    await fs.access(path.join(root, "harmony", "conventions", "catalog.json"));
  });

  it("writeErLayout → readErLayout で <dataDir>/er-layout.json に書き込まれる", async () => {
    await writeErLayout({ nodes: [], edges: [] }, root);
    const data = await readErLayout(root);
    expect(data).toMatchObject({ nodes: [] });
    await fs.access(path.join(root, "harmony", "er-layout.json"));
  });
});

// ── 4. dataDir = "design/spec" (multi-segment) でのデータ読み書き ───────────────

describe("dataDir = 'design/spec' (multi-segment path)", () => {
  const root = path.join(TMP_ROOT, "ws-design-spec");

  beforeAll(async () => {
    await makeWorkspace(root, "design/spec");
  });

  it("writeTable → 物理ファイルが <root>/design/spec/tables/ に作成される", async () => {
    await writeTable("tbl-spec", { id: "tbl-spec", name: "spec-table" }, root);
    await fs.access(path.join(root, "design", "spec", "tables", "tbl-spec.json"));
    // root/tables/ には作成されないこと
    await expect(fs.access(path.join(root, "tables", "tbl-spec.json"))).rejects.toThrow();
  });

  it("writeProcessFlow → 物理ファイルが <root>/design/spec/process-flows/ に作成される (#1141 v3 規範)", async () => {
    await writeProcessFlow("flow-spec", { id: "flow-spec", steps: [] }, root);
    await fs.access(path.join(root, "design", "spec", "process-flows", "flow-spec.json"));
    // root/process-flows/ には作成されないこと
    await expect(fs.access(path.join(root, "process-flows", "flow-spec.json"))).rejects.toThrow();
  });

  it("writeView → 物理ファイルが <root>/design/spec/views/ に作成される", async () => {
    await writeView("view-spec", { id: "view-spec" }, root);
    await fs.access(path.join(root, "design", "spec", "views", "view-spec.json"));
  });

  it("writeCustomBlocks → 物理ファイルが <root>/design/spec/custom-blocks.json に作成される", async () => {
    await writeCustomBlocks([{ id: "block-1" }], root);
    await fs.access(path.join(root, "design", "spec", "custom-blocks.json"));
  });
});

// ── 5. dataDir = "納品物" (日本語フォルダ名) でのデータ読み書き ─────────────────

describe("dataDir = '納品物' (日本語フォルダ名)", () => {
  const root = path.join(TMP_ROOT, "ws-japanese");

  beforeAll(async () => {
    await makeWorkspace(root, "納品物");
  });

  it("writeTable → 物理ファイルが <root>/納品物/tables/ に作成される", async () => {
    await writeTable("tbl-jp", { id: "tbl-jp", name: "日本語テーブル" }, root);
    await fs.access(path.join(root, "納品物", "tables", "tbl-jp.json"));
  });

  it("readTable で正しいデータを読み込める", async () => {
    const data = await readTable("tbl-jp", root);
    expect(data).toMatchObject({ id: "tbl-jp", name: "日本語テーブル" });
  });

  it("writeSequence / readSequence で <dataDir>/sequences/ に書き込まれる", async () => {
    await writeSequence("seq-jp", { id: "seq-jp", currentValue: 1 }, root);
    const data = await readSequence("seq-jp", root);
    expect(data).toMatchObject({ id: "seq-jp" });
    await fs.access(path.join(root, "納品物", "sequences", "seq-jp.json"));
  });
});

// ── 6. dataDir が異なる 2 workspace は互いに干渉しない ─────────────────────────

describe("複数 workspace の dataDir 隔離", () => {
  const rootX = path.join(TMP_ROOT, "ws-iso-x");
  const rootY = path.join(TMP_ROOT, "ws-iso-y");

  beforeAll(async () => {
    await makeWorkspace(rootX, "data-x");
    await makeWorkspace(rootY, "data-y");
  });

  it("workspace X と Y で同じ tableId に書いても互いに影響しない", async () => {
    await writeTable("common-tbl", { id: "common-tbl", name: "from-X" }, rootX);
    await writeTable("common-tbl", { id: "common-tbl", name: "from-Y" }, rootY);

    const fromX = await readTable("common-tbl", rootX);
    const fromY = await readTable("common-tbl", rootY);
    expect((fromX as Record<string, unknown>).name).toBe("from-X");
    expect((fromY as Record<string, unknown>).name).toBe("from-Y");
  });

  it("workspace X のファイルは workspace Y の dataDir 配下には存在しない", async () => {
    await writeTable("only-in-x", { id: "only-in-x" }, rootX);
    // rootY/data-y/tables/only-in-x.json は存在しないはず
    await expect(fs.access(path.join(rootY, "data-y", "tables", "only-in-x.json"))).rejects.toThrow();
  });
});

// ── 7. 旧 project.json 参照が projectStorage.ts から完全に消えたことを確認 ────────

describe("旧 project.json 参照の撤廃確認", () => {
  it("projectStorage.ts に文字列 'project.json' が含まれないこと", async () => {
    const filePath = path.resolve(import.meta.dirname, "projectStorage.ts");
    const content = await fs.readFile(filePath, "utf-8");
    // "project.json" というリテラル文字列が含まれていないことを確認
    expect(content).not.toContain('"project.json"');
    expect(content).not.toContain("'project.json'");
  });

  it("projectStorage.ts に 'projectFile' という export が含まれないこと", async () => {
    const filePath = path.resolve(import.meta.dirname, "projectStorage.ts");
    const content = await fs.readFile(filePath, "utf-8");
    // export function/const 'projectFile' が無いことを確認
    expect(content).not.toMatch(/export\s+(const|function)\s+projectFile\b/);
  });

  it("projectStorage.ts に 'harmonyFile' export が存在すること", async () => {
    const filePath = path.resolve(import.meta.dirname, "projectStorage.ts");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("export const harmonyFile");
  });

  it("projectStorage.ts に 'resolveDataRoot' export が存在すること", async () => {
    const filePath = path.resolve(import.meta.dirname, "projectStorage.ts");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toContain("export async function resolveDataRoot");
  });
});

// ── 8. ensureDataDir のディレクトリ作成確認 ─────────────────────────────────────

describe("ensureDataDir (root, dataDirVal)", () => {
  it("指定した dataDir 配下にサブディレクトリ群が作成される", async () => {
    const root = path.join(TMP_ROOT, "ws-ensure");
    await fs.mkdir(root, { recursive: true });
    await ensureDataDir(root, "my-dir");

    const expectedDirs = ["screens", "tables", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"];
    for (const sub of expectedDirs) {
      const stat = await fs.stat(path.join(root, "my-dir", sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("root 直下には余分なディレクトリが作成されない", async () => {
    const root = path.join(TMP_ROOT, "ws-ensure-check");
    await fs.mkdir(root, { recursive: true });
    await ensureDataDir(root, "subdir");

    // root 直下に screens/ などが作られないこと
    await expect(fs.access(path.join(root, "screens"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "tables"))).rejects.toThrow();
  });
});

// ── 9. uuid 採番 / preserve / immutability (#1294 I-2 / RFC #1284) ────────────

describe("uuid 採番 / preserve / immutability (#1294 I-2)", () => {
  const root = path.join(TMP_ROOT, "ws-uuid-tests");

  beforeAll(async () => {
    await makeWorkspace(root, "harmony");
  });

  it("writeTable: 新規 create 時に uuid が自動採番される", async () => {
    await writeTable("tbl-uuid-create", { id: "tbl-uuid-create", name: "uuid-create-test" }, root);
    const data = await readTable("tbl-uuid-create", root) as Record<string, unknown>;
    expect(typeof data.uuid).toBe("string");
    expect(data.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("writeTable: 既存 update 時に uuid が preserve される (data に uuid 指定なし)", async () => {
    await writeTable("tbl-uuid-preserve", { id: "tbl-uuid-preserve", name: "v1" }, root);
    const v1 = await readTable("tbl-uuid-preserve", root) as Record<string, unknown>;
    const uuid1 = v1.uuid;
    // update: data に uuid 指定なしでも、storage 側で旧 uuid を継承する
    await writeTable("tbl-uuid-preserve", { id: "tbl-uuid-preserve", name: "v2" }, root);
    const v2 = await readTable("tbl-uuid-preserve", root) as Record<string, unknown>;
    expect(v2.uuid).toBe(uuid1);
    expect(v2.name).toBe("v2");
  });

  it("writeTable: data に uuid 指定があり旧値と一致 → 維持", async () => {
    const fixed = "22222222-2222-4222-8222-222222222222";
    await writeTable("tbl-uuid-supplied", { id: "tbl-uuid-supplied", uuid: fixed, name: "v1" }, root);
    const v1 = await readTable("tbl-uuid-supplied", root) as Record<string, unknown>;
    expect(v1.uuid).toBe(fixed);
    await writeTable("tbl-uuid-supplied", { id: "tbl-uuid-supplied", uuid: fixed, name: "v2" }, root);
    const v2 = await readTable("tbl-uuid-supplied", root) as Record<string, unknown>;
    expect(v2.uuid).toBe(fixed);
  });

  it("writeTable: data に uuid 指定があり旧値と不一致 → uuid immutability violation で throw", async () => {
    const original = "33333333-3333-4333-8333-333333333333";
    await writeTable("tbl-uuid-imm", { id: "tbl-uuid-imm", uuid: original, name: "v1" }, root);
    // 異なる uuid で update → throw
    const conflicting = "44444444-4444-4444-8444-444444444444";
    await expect(
      writeTable("tbl-uuid-imm", { id: "tbl-uuid-imm", uuid: conflicting, name: "v2" }, root),
    ).rejects.toThrow(/uuid immutability violation/);
  });

  it("writeView: 新規 create 時に uuid が自動採番される (root.uuid 構造)", async () => {
    await writeView("view-uuid-create", { id: "view-uuid-create", name: "view-create" }, root);
    const data = await readView("view-uuid-create", root) as Record<string, unknown>;
    expect(typeof data.uuid).toBe("string");
    expect(data.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("writeSequence: 新規 create 時に uuid が自動採番される (root.uuid 構造)", async () => {
    await writeSequence("seq-uuid-create", { id: "seq-uuid-create", currentValue: 0 }, root);
    const data = await readSequence("seq-uuid-create", root) as Record<string, unknown>;
    expect(typeof data.uuid).toBe("string");
    expect(data.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("writeProcessFlow: 新規 create 時に meta.uuid が自動採番される (ProcessFlow は 1 階層下)", async () => {
    const flowId = "flow-uuid-create";
    await writeProcessFlow(flowId, {
      $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
      meta: { id: flowId, name: "uuid-create-flow", flowType: "common", maturity: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      context: {},
      actions: [],
      authoring: {},
    }, root);
    const data = await readProcessFlow(flowId, root) as Record<string, unknown>;
    const meta = data.meta as Record<string, unknown>;
    expect(typeof meta.uuid).toBe("string");
    expect(meta.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("writeProcessFlow: 既存 update 時に meta.uuid が preserve される", async () => {
    const flowId = "flow-uuid-preserve";
    await writeProcessFlow(flowId, {
      $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
      meta: { id: flowId, name: "v1", flowType: "common", maturity: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      context: {},
      actions: [],
      authoring: {},
    }, root);
    const v1 = await readProcessFlow(flowId, root) as Record<string, unknown>;
    const uuid1 = (v1.meta as Record<string, unknown>).uuid;
    await writeProcessFlow(flowId, {
      $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
      meta: { id: flowId, name: "v2", flowType: "common", maturity: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      context: {},
      actions: [],
      authoring: {},
    }, root);
    const v2 = await readProcessFlow(flowId, root) as Record<string, unknown>;
    const uuid2 = (v2.meta as Record<string, unknown>).uuid;
    expect(uuid2).toBe(uuid1);
    expect((v2.meta as Record<string, unknown>).name).toBe("v2");
  });

  it("writeProcessFlow: meta.uuid 不一致 update で immutability violation throw", async () => {
    const flowId = "flow-uuid-imm";
    const original = "55555555-5555-4555-8555-555555555555";
    await writeProcessFlow(flowId, {
      $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
      meta: { id: flowId, uuid: original, name: "v1", flowType: "common", maturity: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      context: {},
      actions: [],
      authoring: {},
    }, root);
    const conflicting = "66666666-6666-4666-8666-666666666666";
    await expect(
      writeProcessFlow(flowId, {
        $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
        meta: { id: flowId, uuid: conflicting, name: "v2", flowType: "common", maturity: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
        context: {},
        actions: [],
        authoring: {},
      }, root),
    ).rejects.toThrow(/uuid immutability violation/);
  });
});

// ── 10. ensureUniqueEntityId / listExistingEntityIds (#1294 I-2 / RFC #1284) ─

describe("ensureUniqueEntityId / listExistingEntityIds (#1294 I-2)", () => {
  const root = path.join(TMP_ROOT, "ws-unique-tests");

  beforeAll(async () => {
    await makeWorkspace(root, "harmony");
  });

  it("listExistingEntityIds: 空 dir では空配列を返す", async () => {
    const ids = await listExistingEntityIds("table", root);
    expect(ids).toEqual([]);
  });

  it("listExistingEntityIds: 書き込んだ id 一覧が取得できる", async () => {
    await writeTable("tbl-list-1", { id: "tbl-list-1", name: "a" }, root);
    await writeTable("tbl-list-2", { id: "tbl-list-2", name: "b" }, root);
    const ids = await listExistingEntityIds("table", root);
    expect(ids).toContain("tbl-list-1");
    expect(ids).toContain("tbl-list-2");
  });

  it("listExistingEntityIds (screen): .design.json は id として扱わない", async () => {
    await writeScreen("scr-list-1", { assets: [], pages: [] }, root);
    const ids = await listExistingEntityIds("screen", root);
    expect(ids).toContain("scr-list-1");
    // .design.json prefix が含まれていないこと
    expect(ids).not.toContain("scr-list-1.design");
  });

  it("ensureUniqueEntityId: 既存 id と衝突する場合 throw", async () => {
    await writeTable("tbl-conflict", { id: "tbl-conflict", name: "first" }, root);
    await expect(
      ensureUniqueEntityId("table", "tbl-conflict", root),
    ).rejects.toThrow(/Duplicate table id/);
  });

  it("ensureUniqueEntityId: 既存 id と衝突しない場合は throw しない", async () => {
    await expect(
      ensureUniqueEntityId("table", "tbl-no-conflict", root),
    ).resolves.toBeUndefined();
  });

  it("ensureUniqueEntityId: entity type 内 unique (cross-entity 衝突は許容)", async () => {
    // 同 id でも table と view が別 entity なので衝突しない
    await writeTable("ent-id", { id: "ent-id", name: "table-side" }, root);
    await writeView("ent-id", { id: "ent-id", name: "view-side" }, root);
    // view 側の uniqueness check は table 側 id を見ない
    await expect(
      ensureUniqueEntityId("view", "ent-other", root),
    ).resolves.toBeUndefined();
  });
});
