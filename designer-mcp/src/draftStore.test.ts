/**
 * draftStore 単体テスト (#685)
 *
 * per-session API (#700 R-2): connect(clientId, path) を使って workspace を設定。
 * 実際のワークスペースには一切触れない。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP_ROOT = path.join(os.tmpdir(), `draft-store-test-${process.pid}-${Date.now()}`);
const TEST_CLIENT_ID = "test-client";

const {
  createDraft,
  readDraft,
  updateDraft,
  commitDraft,
  discardDraft,
  hasDraft,
  listDrafts,
} = await import("./draftStore.js");

const { _resetForTest, connect, initWorkspaceState } = await import("./workspaceState.js");

const { writeScreen, writeScreenEntity, readScreenEntity } = await import("./projectStorage.js");

const SCHEMAS_DIR = path.resolve(import.meta.dirname, "../../schemas");

function expectedScreenSchemaRef(root: string): string {
  return path.relative(
    path.join(root, "screens"),
    path.join(SCHEMAS_DIR, "v3", "screen.v3.schema.json"),
  ).replace(/\\/g, "/");
}

async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  try {
    await fs.writeFile(path.join(TMP_ROOT, "project.json"), JSON.stringify({ name: "test" }), "utf-8");
  } catch {
    // ignore
  }
}

beforeAll(async () => {
  await ensureWorkspace();
  _resetForTest();
  initWorkspaceState();
  connect(TEST_CLIENT_ID, TMP_ROOT);
});

beforeEach(async () => {
  const draftsDir = path.join(TMP_ROOT, ".drafts");
  try {
    await fs.rm(draftsDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

afterAll(async () => {
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
  _resetForTest();
});

describe("draftStore", () => {
  describe("createDraft / readDraft / updateDraft", () => {
    it("happy path: create (新規) → read → update → read", async () => {
      const result = await createDraft(TEST_CLIENT_ID, "table", "tbl-001");
      expect(result.created).toBe(true);

      const initial = await readDraft(TEST_CLIENT_ID, "table", "tbl-001");
      expect(initial).toEqual({});

      await updateDraft(TEST_CLIENT_ID, "table", "tbl-001", { name: "users", columns: [] });
      const updated = await readDraft(TEST_CLIENT_ID, "table", "tbl-001");
      expect(updated).toMatchObject({ name: "users", columns: [] });
    });

    it("createDraft: 既に draft が存在する場合は created: false を返す", async () => {
      await createDraft(TEST_CLIENT_ID, "table", "tbl-dup");
      const second = await createDraft(TEST_CLIENT_ID, "table", "tbl-dup");
      expect(second.created).toBe(false);
    });

    it("createDraft: 本体ファイルが存在すれば内容をコピーする", async () => {
      const tablesDir = path.join(TMP_ROOT, "tables");
      await fs.mkdir(tablesDir, { recursive: true });
      await fs.writeFile(
        path.join(tablesDir, "tbl-copy.json"),
        JSON.stringify({ id: "tbl-copy", name: "existing" }),
        "utf-8",
      );

      const r = await createDraft(TEST_CLIENT_ID, "table", "tbl-copy");
      expect(r.created).toBe(true);
      const draft = await readDraft(TEST_CLIENT_ID, "table", "tbl-copy");
      expect(draft).toMatchObject({ name: "existing" });
    });

    it("readDraft: 存在しない draft は null を返す", async () => {
      const d = await readDraft(TEST_CLIENT_ID, "table", "nonexistent");
      expect(d).toBeNull();
    });

    it("updateDraft: draft が未存在でも書き込める (新規作成)", async () => {
      await updateDraft(TEST_CLIENT_ID, "sequence", "seq-001", { steps: [1, 2, 3] });
      const d = await readDraft(TEST_CLIENT_ID, "sequence", "seq-001");
      expect(d).toMatchObject({ steps: [1, 2, 3] });
    });
  });

  describe("commitDraft", () => {
    it("table: draft を本体ファイルへ昇格し draft が消える", async () => {
      await updateDraft(TEST_CLIENT_ID, "table", "tbl-commit", { id: "tbl-commit", name: "orders" });
      const r = await commitDraft(TEST_CLIENT_ID, "table", "tbl-commit");
      expect(r.committed).toBe(true);

      const afterDraft = await readDraft(TEST_CLIENT_ID, "table", "tbl-commit");
      expect(afterDraft).toBeNull();

      const bodyPath = path.join(TMP_ROOT, "tables", "tbl-commit.json");
      const body = JSON.parse(await fs.readFile(bodyPath, "utf-8"));
      expect(body).toMatchObject({ name: "orders" });
    });

    it("process-flow: draft を actions/ 配下へ昇格する", async () => {
      await updateDraft(TEST_CLIENT_ID, "process-flow", "flow-001", { id: "flow-001", steps: [] });
      const r = await commitDraft(TEST_CLIENT_ID, "process-flow", "flow-001");
      expect(r.committed).toBe(true);

      const bodyPath = path.join(TMP_ROOT, "actions", "flow-001.json");
      const body = JSON.parse(await fs.readFile(bodyPath, "utf-8"));
      expect(body).toMatchObject({ id: "flow-001" });
    });

    it("convention: draft を conventions/catalog.json へ昇格する", async () => {
      await updateDraft(TEST_CLIENT_ID, "convention", "catalog", { version: 1, rules: [] });
      const r = await commitDraft(TEST_CLIENT_ID, "convention", "catalog");
      expect(r.committed).toBe(true);

      const bodyPath = path.join(TMP_ROOT, "conventions", "catalog.json");
      const body = JSON.parse(await fs.readFile(bodyPath, "utf-8"));
      expect(body).toMatchObject({ version: 1 });
    });

    it("commitDraft: draft が存在しない場合は committed: false を返す", async () => {
      const r = await commitDraft(TEST_CLIENT_ID, "table", "no-such-draft");
      expect(r.committed).toBe(false);
    });

    it("screen-item: commitDraft は writeScreenItems を呼び出して committed: true を返す", async () => {
      await updateDraft(TEST_CLIENT_ID, "screen-item", "si-001", { screenId: "si-001", items: [] });
      const r = await commitDraft(TEST_CLIENT_ID, "screen-item", "si-001");
      expect(r.committed).toBe(true);
      // draft が削除されていること
      const afterDraft = await readDraft(TEST_CLIENT_ID, "screen-item", "si-001");
      expect(afterDraft).toBeNull();
    });

    it("screen-item: payload.screenId が指す screen に書き込まれる", async () => {
      const screenId = "scr-abc123";
      // 書き込み先 screen が存在するよう事前にディレクトリを作成
      const screensDir = path.join(TMP_ROOT, "screens");
      await fs.mkdir(screensDir, { recursive: true });
      await fs.writeFile(
        path.join(screensDir, `${screenId}.design.json`),
        JSON.stringify({ id: screenId, name: "テスト画面", items: [] }),
        "utf-8",
      );

      // singleton id で draft を作成・commit
      await updateDraft(TEST_CLIENT_ID, "screen-item", "singleton", {
        screenId,
        items: [{ id: "item-1", label: "ラベル" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const r = await commitDraft(TEST_CLIENT_ID, "screen-item", "singleton");
      expect(r.committed).toBe(true);

      // draft が削除されていること
      const afterDraft = await readDraft(TEST_CLIENT_ID, "screen-item", "singleton");
      expect(afterDraft).toBeNull();

      // 正しい screenId のファイルに書き込まれていること ("singleton" ではない)
      // writeScreenItems → writeScreenEntity は screens/{screenId}.json に items を保存する
      const bodyPath = path.join(TMP_ROOT, "screens", `${screenId}.json`);
      const body = JSON.parse(await fs.readFile(bodyPath, "utf-8"));
      expect(body).toMatchObject({ id: screenId, items: [{ id: "item-1" }] });
    });

    it("screen-item: payload.screenId が空文字のときエラーを投げる", async () => {
      await updateDraft(TEST_CLIENT_ID, "screen-item", "singleton", {
        screenId: "",
        items: [],
      });
      await expect(commitDraft(TEST_CLIENT_ID, "screen-item", "singleton")).rejects.toThrow(
        "screen-item draft payload に screenId がありません",
      );
    });

    it("screen-item: payload.screenId が存在しないときエラーを投げる", async () => {
      await updateDraft(TEST_CLIENT_ID, "screen-item", "singleton", { items: [] });
      await expect(commitDraft(TEST_CLIENT_ID, "screen-item", "singleton")).rejects.toThrow(
        "screen-item draft payload に screenId がありません",
      );
    });
  });

  describe("discardDraft", () => {
    it("create → discard → has=false", async () => {
      await createDraft(TEST_CLIENT_ID, "sequence", "seq-discard");
      const r = await discardDraft(TEST_CLIENT_ID, "sequence", "seq-discard");
      expect(r.discarded).toBe(true);

      const exists = await hasDraft(TEST_CLIENT_ID, "sequence", "seq-discard");
      expect(exists).toBe(false);
    });

    it("discardDraft: 存在しない draft は discarded: false", async () => {
      const r = await discardDraft(TEST_CLIENT_ID, "table", "ghost");
      expect(r.discarded).toBe(false);
    });
  });

  describe("hasDraft", () => {
    it("draft 存在時は true、非存在時は false", async () => {
      expect(await hasDraft(TEST_CLIENT_ID, "table", "hd-test")).toBe(false);
      await createDraft(TEST_CLIENT_ID, "table", "hd-test");
      expect(await hasDraft(TEST_CLIENT_ID, "table", "hd-test")).toBe(true);
    });
  });

  describe("listDrafts", () => {
    it("複数 type の draft を列挙できる", async () => {
      await createDraft(TEST_CLIENT_ID, "table", "t1");
      await createDraft(TEST_CLIENT_ID, "table", "t2");
      await createDraft(TEST_CLIENT_ID, "sequence", "s1");

      const items = await listDrafts(TEST_CLIENT_ID);
      expect(items.length).toBeGreaterThanOrEqual(3);

      const types = items.map((i) => i.type);
      expect(types).toContain("table");
      expect(types).toContain("sequence");

      for (const item of items) {
        expect(typeof item.id).toBe("string");
        expect(typeof item.mtimeMs).toBe("number");
        expect(item.mtimeMs).toBeGreaterThan(0);
      }
    });

    it(".drafts/ が存在しない場合は空配列を返す", async () => {
      const items = await listDrafts(TEST_CLIENT_ID);
      expect(Array.isArray(items)).toBe(true);
    });
  });

  describe("atomic write", () => {
    it("連続 update でも最終値が正しく読める", async () => {
      const updates = Array.from({ length: 10 }, (_, i) => ({ version: i }));
      for (const payload of updates) {
        await updateDraft(TEST_CLIENT_ID, "table", "atomic-test", payload);
      }
      const final = await readDraft(TEST_CLIENT_ID, "table", "atomic-test");
      expect(final).toMatchObject({ version: 9 });
    });
  });

  describe("workspace 隔離 (#701 R-3)", () => {
    const TMP_ROOT_A = path.join(os.tmpdir(), `draft-iso-A-${process.pid}-${Date.now()}`);
    const TMP_ROOT_B = path.join(os.tmpdir(), `draft-iso-B-${process.pid}-${Date.now()}`);
    const CLIENT_A = "test-client-iso-A";
    const CLIENT_B = "test-client-iso-B";

    beforeAll(async () => {
      // 2 つのワークスペース root を作成
      await fs.mkdir(TMP_ROOT_A, { recursive: true });
      await fs.writeFile(path.join(TMP_ROOT_A, "project.json"), JSON.stringify({ name: "A" }), "utf-8");
      await fs.mkdir(TMP_ROOT_B, { recursive: true });
      await fs.writeFile(path.join(TMP_ROOT_B, "project.json"), JSON.stringify({ name: "B" }), "utf-8");

      _resetForTest();
      initWorkspaceState();
      connect(CLIENT_A, TMP_ROOT_A);
      connect(CLIENT_B, TMP_ROOT_B);
    });

    afterAll(async () => {
      await fs.rm(TMP_ROOT_A, { recursive: true, force: true }).catch(() => {});
      await fs.rm(TMP_ROOT_B, { recursive: true, force: true }).catch(() => {});
      _resetForTest();
      // メインテストの TEST_CLIENT_ID を再登録
      initWorkspaceState();
      connect(TEST_CLIENT_ID, TMP_ROOT);
    });

    it("client A の draft は client B から見えない", async () => {
      await createDraft(CLIENT_A, "table", "shared-id");
      await updateDraft(CLIENT_A, "table", "shared-id", { name: "from-A" });

      // B は同じ id でも独立
      expect(await hasDraft(CLIENT_B, "table", "shared-id")).toBe(false);
      expect(await readDraft(CLIENT_B, "table", "shared-id")).toBeNull();
    });

    it("client A と client B が独立に同じ id で draft を持てる", async () => {
      await createDraft(CLIENT_A, "process-flow", "iso-test");
      await updateDraft(CLIENT_A, "process-flow", "iso-test", { name: "A-flow" });

      await createDraft(CLIENT_B, "process-flow", "iso-test");
      await updateDraft(CLIENT_B, "process-flow", "iso-test", { name: "B-flow" });

      const a = await readDraft(CLIENT_A, "process-flow", "iso-test");
      const b = await readDraft(CLIENT_B, "process-flow", "iso-test");
      expect(a).toMatchObject({ name: "A-flow" });
      expect(b).toMatchObject({ name: "B-flow" });
    });

    it("client A の draft 削除は client B に影響しない", async () => {
      await createDraft(CLIENT_A, "view", "delete-test");
      await createDraft(CLIENT_B, "view", "delete-test");
      await discardDraft(CLIENT_A, "view", "delete-test");

      expect(await hasDraft(CLIENT_A, "view", "delete-test")).toBe(false);
      expect(await hasDraft(CLIENT_B, "view", "delete-test")).toBe(true);
    });

    it("listDrafts は active workspace の draft のみ列挙する", async () => {
      await createDraft(CLIENT_A, "table", "list-A");
      await createDraft(CLIENT_B, "table", "list-B");

      const listA = await listDrafts(CLIENT_A);
      const listB = await listDrafts(CLIENT_B);

      expect(listA.some((d) => d.id === "list-A")).toBe(true);
      expect(listA.some((d) => d.id === "list-B")).toBe(false);
      expect(listB.some((d) => d.id === "list-B")).toBe(true);
      expect(listB.some((d) => d.id === "list-A")).toBe(false);
    });

    it("draft path は workspace root 内の .drafts 配下に作られる", async () => {
      await createDraft(CLIENT_A, "table", "path-test");

      const expectedPath = path.join(TMP_ROOT_A, ".drafts", "table", "path-test.json");
      await fs.access(expectedPath); // throw しないこと

      // workspace B には作られないこと
      const bPath = path.join(TMP_ROOT_B, ".drafts", "table", "path-test.json");
      await expect(fs.access(bPath)).rejects.toThrow();
    });
  });

  // #804 regression: writeScreen / writeScreenEntity が items[] を消さないこと
  describe("#804 regression: screen entity items[] 保持", () => {

    it("writeScreen: 既存 entity の items[] が保持される", async () => {
      const screenId = "scr-items-test";
      const screensDir = path.join(TMP_ROOT, "screens");
      await fs.mkdir(screensDir, { recursive: true });

      const existingEntity = {
        $schema: "../../schemas/v3/screen.v3.schema.json",
        id: screenId,
        name: "テスト画面",
        kind: "list",
        path: "/list",
        maturity: "draft",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        items: [
          { id: "field1", label: "フィールド1", type: "string" },
          { id: "field2", label: "フィールド2", type: "number" },
        ],
        design: { designFileRef: `${screenId}.design.json` },
      };
      await fs.writeFile(
        path.join(screensDir, `${screenId}.json`),
        JSON.stringify(existingEntity),
        "utf-8",
      );

      const designData = { assets: [], styles: [], pages: [] };
      await writeScreen(screenId, designData, TMP_ROOT);

      const afterEntity = JSON.parse(
        await fs.readFile(path.join(screensDir, `${screenId}.json`), "utf-8"),
      );
      expect(afterEntity.items).toHaveLength(2);
      expect(afterEntity.items[0].id).toBe("field1");
      expect(afterEntity.items[1].id).toBe("field2");
    });

    it("writeScreen: $schema path が screens/ からの正しい相対 path になる", async () => {
      const screenId = "scr-schema-test";
      const screensDir = path.join(TMP_ROOT, "screens");
      await fs.mkdir(screensDir, { recursive: true });

      await writeScreen(screenId, { assets: [], styles: [], pages: [] }, TMP_ROOT);

      const entity = JSON.parse(
        await fs.readFile(path.join(screensDir, `${screenId}.json`), "utf-8"),
      );
      expect(entity.$schema).toBe(expectedScreenSchemaRef(TMP_ROOT));
      expect(entity.$schema).not.toBe("../schemas/v3/screen.v3.schema.json");
    });

    it("writeScreenEntity: 既存 entity の items[] が保持される", async () => {
      const screenId = "scr-entity-items-test";
      const screensDir = path.join(TMP_ROOT, "screens");
      await fs.mkdir(screensDir, { recursive: true });

      const existingEntity = {
        $schema: "../../schemas/v3/screen.v3.schema.json",
        id: screenId,
        name: "エンティティテスト",
        kind: "form",
        path: "/form",
        maturity: "committed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        description: "説明文",
        auth: "required",
        items: [{ id: "inputA", label: "入力A", type: "string" }],
        design: { designFileRef: `${screenId}.design.json` },
      };
      await fs.writeFile(
        path.join(screensDir, `${screenId}.json`),
        JSON.stringify(existingEntity),
        "utf-8",
      );

      // design 保存 → entity の部分更新 (description / auth は保持されるべき)
      await writeScreenEntity(screenId, {
        ...existingEntity,
        updatedAt: "2026-05-05T00:00:00.000Z",
      }, TMP_ROOT);

      const entity = await readScreenEntity(screenId, TMP_ROOT) as Record<string, unknown>;
      expect(Array.isArray(entity.items)).toBe(true);
      expect((entity.items as unknown[]).length).toBe(1);
      expect(entity.description).toBe("説明文");
      expect(entity.auth).toBe("required");
    });
  });
});
