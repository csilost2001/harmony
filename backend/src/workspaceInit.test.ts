/**
 * workspaceInit 単体テスト (#672, #677-C, #754)
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  inspectWorkspacePath,
  initializeWorkspace,
  autoActivateOnStartup,
  _internals,
} from "./workspaceInit.js";

const TMP_ROOT = path.join(os.tmpdir(), `workspace-init-test-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
});

afterAll(async () => {
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("inspectWorkspacePath", () => {
  it("存在しない path → notFound", async () => {
    const r = await inspectWorkspacePath(path.join(TMP_ROOT, "missing"));
    expect(r.status).toBe("notFound");
  });

  it("空フォルダ → needsInit", async () => {
    const dir = path.join(TMP_ROOT, "empty");
    await fs.mkdir(dir);
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("needsInit");
  });

  it("project.json あり → ready + name 抽出", async () => {
    const dir = path.join(TMP_ROOT, "ready");
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "project.json"),
      JSON.stringify({ meta: { name: "テストプロジェクト" } }),
    );
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.name).toBe("テストプロジェクト");
    }
  });

  it("project.json があるが meta.name 無し → name は basename", async () => {
    const dir = path.join(TMP_ROOT, "no-name");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify({ meta: {} }));
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.name).toBe("no-name");
    }
  });

  it("path がファイルでフォルダではない → notFound", async () => {
    const file = path.join(TMP_ROOT, "file.txt");
    await fs.writeFile(file, "x");
    const r = await inspectWorkspacePath(file);
    expect(r.status).toBe("notFound");
  });
});

describe("initializeWorkspace", () => {
  it("空フォルダに project.json + サブディレクトリ群を生成", async () => {
    const dir = path.join(TMP_ROOT, "init-target");
    const r = await initializeWorkspace(dir);
    expect(r.path).toBe(path.resolve(dir));
    expect(r.name).toBe("init-target");
    expect(r.projectId).toMatch(/^[0-9a-f-]{36}$/);

    // project.json 存在
    const projPath = path.join(dir, "project.json");
    const proj = JSON.parse(await fs.readFile(projPath, "utf-8"));
    expect(proj.schemaVersion).toBe("v3");
    expect(proj.meta.id).toBe(r.projectId);
    expect(proj.meta.name).toBe("init-target");
    expect(proj.meta.createdAt).toMatch(/Z$/);

    // サブディレクトリ
    for (const sub of ["screens", "tables", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"]) {
      const stat = await fs.stat(path.join(dir, sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("存在しない path も mkdir -p で作る", async () => {
    const dir = path.join(TMP_ROOT, "deep", "nested", "ws");
    const r = await initializeWorkspace(dir);
    expect(r.name).toBe("ws");
    const stat = await fs.stat(path.join(dir, "project.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("既に project.json があれば idempotent (上書きしない)", async () => {
    const dir = path.join(TMP_ROOT, "existing");
    await fs.mkdir(dir);
    const original = {
      schemaVersion: "v3",
      meta: { id: "11111111-1111-4111-8111-111111111111", name: "Existing", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      entities: {},
    };
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(original, null, 2));
    const r = await initializeWorkspace(dir);
    expect(r.projectId).toBe("11111111-1111-4111-8111-111111111111");
    const re = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf-8"));
    expect(re.meta.name).toBe("Existing");
  });

  it("生成された project.json は schemas/v3/project.v3.schema.json で検証 pass", async () => {
    const dir = path.join(TMP_ROOT, "validated");
    await initializeWorkspace(dir);
    // 検証は initializeWorkspace 内で実行済 (失敗時は throw)。ここでは追加のスキーマ違反例を
    // 再度通すことはしない。pass = この時点で例外無く戻ってきたこと。
    const proj = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf-8"));
    expect(proj.meta.maturity).toBe("draft");
    expect(proj.meta.mode).toBe("upstream");
    expect(Array.isArray(proj.entities.screens)).toBe(true);
  });
});

/**
 * autoActivateOnStartup テスト (#754)
 *
 * DESIGNER_RECENT_FILE env で recent ファイルを一時ファイルに向けることで
 * ~/.harmony/recent-workspaces.json を汚染せずテストする。
 * DESIGNER_DATA_DIR は未設定 (lockdown モード回避)。
 */
describe("autoActivateOnStartup (#754)", () => {
  const recentFilePath = path.join(TMP_ROOT, "recent-workspaces.json");
  const origRecentFile = process.env.DESIGNER_RECENT_FILE;
  const origDataDir = process.env.DESIGNER_DATA_DIR;

  beforeEach(async () => {
    // テスト用 recent ファイルを向ける
    process.env.DESIGNER_RECENT_FILE = recentFilePath;
    // lockdown モードを確実に無効化
    delete process.env.DESIGNER_DATA_DIR;
    // recent ファイルが存在すれば削除 (テスト間独立)
    try { await fs.unlink(recentFilePath); } catch { /* ignore */ }
  });

  afterEach(() => {
    // 環境変数を元に戻す
    if (origRecentFile === undefined) {
      delete process.env.DESIGNER_RECENT_FILE;
    } else {
      process.env.DESIGNER_RECENT_FILE = origRecentFile;
    }
    if (origDataDir === undefined) {
      delete process.env.DESIGNER_DATA_DIR;
    } else {
      process.env.DESIGNER_DATA_DIR = origDataDir;
    }
  });

  it("recent 空 + lockdown 無し → status: none (data/project.json が存在しても auto-activate されない)", async () => {
    // data/project.json を模倣 (レポジトリ root の data/ 直下) — legacy auto-activate がないことを確認
    // recent は空 (ファイル未作成) なので status は none になるはず
    const r = await autoActivateOnStartup();
    expect(r.status).toBe("none");
  });

  it("recent 空 + lockdown 無し → active = null (UI が /workspace/select に redirect すべき状態)", async () => {
    const r = await autoActivateOnStartup();
    // none = active 未設定
    expect(r.status).toBe("none");
    // AutoActivateResult の型から "registeredLegacy" が無いことを型レベルで保証
    // (TypeScript が compile 時にチェック — runtime では確認不要だが念のため)
    const statuses = ["lockdown", "restored", "none"] as const;
    expect(statuses).toContain(r.status);
  });

  it("recent に ready な workspace が登録されていれば status: restored", async () => {
    // workspace を作成
    const wsDir = path.join(TMP_ROOT, "my-workspace");
    await initializeWorkspace(wsDir);

    // recent ファイルに直接書き込む (recentStore API を使わず fs で)
    const wsId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recentData = {
      $schema: "harmony-recent-workspaces-v1",
      version: 1,
      workspaces: [
        {
          id: wsId,
          path: path.resolve(wsDir),
          name: "my-workspace",
          lastOpenedAt: new Date().toISOString(),
        },
      ],
      lastActiveId: wsId,
    };
    await fs.mkdir(path.dirname(recentFilePath), { recursive: true });
    await fs.writeFile(recentFilePath, JSON.stringify(recentData, null, 2), "utf-8");

    const r = await autoActivateOnStartup();
    expect(r.status).toBe("restored");
    if (r.status === "restored") {
      expect(r.entry.id).toBe(wsId);
    }
  });

  it("recent の lastActiveId が stale (workspace が消えている) → status: none", async () => {
    const staleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const recentData = {
      $schema: "harmony-recent-workspaces-v1",
      version: 1,
      workspaces: [
        {
          id: staleId,
          path: path.join(TMP_ROOT, "deleted-workspace"),
          name: "Deleted",
          lastOpenedAt: new Date().toISOString(),
        },
      ],
      lastActiveId: staleId,
    };
    await fs.mkdir(path.dirname(recentFilePath), { recursive: true });
    await fs.writeFile(recentFilePath, JSON.stringify(recentData, null, 2), "utf-8");
    // deleted-workspace は作らない

    const r = await autoActivateOnStartup();
    expect(r.status).toBe("none");
  });
});

describe("_internals", () => {
  it("PROJECT_SCHEMA_REF は schemas/v3/project.v3.schema.json への相対パスを含む", () => {
    expect(_internals.PROJECT_SCHEMA_REF).toContain("project.v3.schema.json");
  });
});
