/**
 * pageLayoutStorage — PageLayout CRUD の unit test (pl-2, #1023)
 *
 * 受け入れ基準:
 * 1. writePageLayout → readPageLayout で値復元
 * 2. writePageLayout → deletePageLayoutFile → readPageLayout が null
 * 3. listAllPageLayouts で複数件返却
 * 4. ファイル不在時の null 返却
 * 5. <dataDir>/page-layouts/ に正しく配置されることを物理確認
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  harmonyFile,
  ensureDataDir,
  readPageLayout,
  writePageLayout,
  deletePageLayoutFile,
  listAllPageLayouts,
} from "./projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `page-layout-storage-test-${process.pid}-${Date.now()}`);

/** 最小限の有効な harmony.json を指定の dataDir で作成しサブディレクトリ群も作成する */
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

// ── メインテストスイート ───────────────────────────────────────────────────────

describe("PageLayout CRUD (projectStorage)", () => {
  const root = path.join(TMP_ROOT, "ws-page-layout");

  beforeAll(async () => {
    await makeWorkspace(root, "harmony");
  });

  it("存在しない pageLayoutId は null を返す", async () => {
    const data = await readPageLayout("non-existent-pl", root);
    expect(data).toBeNull();
  });

  it("writePageLayout → readPageLayout で値を復元できる", async () => {
    const payload = {
      id: "pl-001",
      name: "Main Layout",
      maturity: "draft",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      regions: [{ name: "header" }, { name: "main" }],
      assignments: {},
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    };
    await writePageLayout("pl-001", payload, root);
    const data = await readPageLayout("pl-001", root);
    expect(data).toMatchObject({ id: "pl-001", name: "Main Layout" });
    expect((data as Record<string, unknown>).maturity).toBe("draft");
    // 物理ファイルが page-layouts/ に配置されていること
    await fs.access(path.join(root, "harmony", "page-layouts", "pl-001.json"));
  });

  it("writePageLayout → deletePageLayoutFile → readPageLayout は null を返す", async () => {
    await writePageLayout("pl-del", { id: "pl-del", name: "To Delete" }, root);
    // 書き込み確認
    const before = await readPageLayout("pl-del", root);
    expect(before).not.toBeNull();
    // 削除
    await deletePageLayoutFile("pl-del", root);
    // 削除後は null
    const after = await readPageLayout("pl-del", root);
    expect(after).toBeNull();
  });

  it("deletePageLayoutFile は存在しないファイルでもエラーを throw しない", async () => {
    await expect(deletePageLayoutFile("pl-not-exist", root)).resolves.toBeUndefined();
  });

  it("listAllPageLayouts で複数件返却される", async () => {
    const ids = ["pl-list-a", "pl-list-b", "pl-list-c"];
    for (const id of ids) {
      await writePageLayout(id, { id, name: `Layout ${id}`, maturity: "draft" }, root);
    }
    const all = await listAllPageLayouts(root);
    // pl-001 (先の書き込み) も含めて 4 件以上
    expect(all.length).toBeGreaterThanOrEqual(ids.length);
    const foundIds = (all as Array<Record<string, unknown>>).map((p) => p.id);
    for (const id of ids) {
      expect(foundIds).toContain(id);
    }
  });

  it("listAllPageLayouts — ディレクトリが空の場合は空配列を返す", async () => {
    // 別のワークスペースで確認 (既存エントリがないワークスペース)
    const emptyRoot = path.join(TMP_ROOT, "ws-pl-empty");
    await makeWorkspace(emptyRoot, "data");
    const all = await listAllPageLayouts(emptyRoot);
    expect(all).toEqual([]);
  });

  // #1332 Codex 再 review M1 regression test:
  // listAllPageLayouts が design payload (`<id>.design.json`) を entity として
  // 読み込んでしまうと readEntityAndEnsureUuid が uuid 欠落と判定し、
  // writeJSON で design payload を破壊する。entity scan からは必ず除外され、
  // design payload の byte 内容が一覧操作で書き換わらないこと。
  it("listAllPageLayouts は <id>.design.json を entity として扱わず byte preserve する (#1332 M1)", async () => {
    const cleanRoot = path.join(TMP_ROOT, "ws-pl-design-preserve");
    await makeWorkspace(cleanRoot, "harmony");
    // 1) entity 1 件と、それに対応する design payload を直接書く
    await writePageLayout("pl-design-test", {
      id: "pl-design-test",
      name: "Design Test",
      maturity: "draft",
      regions: [{ name: "header" }],
      assignments: {},
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    }, cleanRoot);
    // 2) design payload — 意図的に entity-likely な uuid を持たない / 異種 schema の json を置く
    const designDir = path.join(cleanRoot, "harmony", "page-layouts");
    const designFile = path.join(designDir, "pl-design-test.design.json");
    const designPayloadOriginal = {
      // Puck-like state — uuid / id を持たない raw payload
      root: { props: { title: "design-only" } },
      content: [{ type: "Heading", props: { text: "raw" } }],
      zones: {},
    };
    await fs.writeFile(designFile, JSON.stringify(designPayloadOriginal, null, 2), "utf-8");
    const beforeBytes = await fs.readFile(designFile, "utf-8");

    // 3) list 操作実行 — design.json が entity として読まれて writeJSON で uuid が追加されたら byte が変わる
    const list = await listAllPageLayouts(cleanRoot);
    expect(list.length).toBeGreaterThanOrEqual(1);
    // design payload 自体は entity scan に含まれてはいけない
    const ids = (list as Array<Record<string, unknown>>).map((p) => p.id);
    expect(ids).toContain("pl-design-test");
    expect(ids).not.toContain("pl-design-test.design");

    // 4) byte preserve assertion
    const afterBytes = await fs.readFile(designFile, "utf-8");
    expect(afterBytes).toBe(beforeBytes);

    // 5) design payload が uuid を勝手に持たされていないことも内容で確認
    const designReread = JSON.parse(afterBytes);
    expect(designReread).not.toHaveProperty("uuid");
    expect(designReread).toEqual(designPayloadOriginal);
  });

  it("writePageLayout は更新でデータを上書きする", async () => {
    await writePageLayout("pl-update", { id: "pl-update", name: "Old Name" }, root);
    await writePageLayout("pl-update", { id: "pl-update", name: "New Name", updatedAt: "2026-06-01T00:00:00.000Z" }, root);
    const data = await readPageLayout("pl-update", root) as Record<string, unknown>;
    expect(data.name).toBe("New Name");
    expect(data.updatedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

// ── dataDir = "design/spec" (multi-segment) での配置確認 ─────────────────────

describe("PageLayout CRUD — multi-segment dataDir", () => {
  const root = path.join(TMP_ROOT, "ws-pl-multipath");

  beforeAll(async () => {
    await makeWorkspace(root, "design/spec");
  });

  it("writePageLayout → 物理ファイルが <root>/design/spec/page-layouts/ に作成される", async () => {
    await writePageLayout("pl-ms", { id: "pl-ms", name: "Multi-Segment Layout" }, root);
    await fs.access(path.join(root, "design", "spec", "page-layouts", "pl-ms.json"));
    // root/page-layouts/ には作成されないこと
    await expect(fs.access(path.join(root, "page-layouts", "pl-ms.json"))).rejects.toThrow();
  });

  it("readPageLayout で正しいデータが取得できる", async () => {
    const data = await readPageLayout("pl-ms", root);
    expect(data).toMatchObject({ id: "pl-ms", name: "Multi-Segment Layout" });
  });
});
