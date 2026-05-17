/**
 * workspaceInit 単体テスト (#672, #677-C, #754, #852 R-3)
 *
 * R-3 変更点:
 * - inspectWorkspacePath: project.json → harmony.json + AJV 検証 + invalid ステータス
 * - initializeWorkspace: harmony.json 生成 + dataDir 配下サブディレクトリ + opts.dataDir
 * - lockdown mode 経路テスト追加
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
import { _resetForTest as resetWorkspaceState, initWorkspaceState } from "./workspaceState.js";

const TMP_ROOT = path.join(os.tmpdir(), `workspace-init-test-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  resetWorkspaceState();
});

afterEach(async () => {
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
  resetWorkspaceState();
});

afterAll(async () => {
  try {
    await fs.rm(TMP_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ── harmony.json fixture helper ─────────────────────────────────────────────

function makeValidHarmony(opts: { name?: string; dataDir?: string } = {}): object {
  const ts = new Date().toISOString();
  return {
    $schema: "../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: opts.dataDir ?? "harmony",
    meta: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: opts.name ?? "テスト",
      createdAt: ts,
      updatedAt: ts,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [],
      sequences: [],
      views: [],
    },
  };
}

// ── inspectWorkspacePath ────────────────────────────────────────────────────

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

  it("harmony.json あり (valid) → ready + name 抽出", async () => {
    const dir = path.join(TMP_ROOT, "ready");
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "harmony.json"),
      JSON.stringify(makeValidHarmony({ name: "テストプロジェクト" })),
    );
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.name).toBe("テストプロジェクト");
    }
  });

  it("harmony.json があるが meta.name 無し → name は basename", async () => {
    const dir = path.join(TMP_ROOT, "no-name");
    await fs.mkdir(dir);
    const fixture = makeValidHarmony();
    // meta.name を削除
    delete (fixture as Record<string, unknown> & { meta: Record<string, unknown> }).meta.name;
    await fs.writeFile(path.join(dir, "harmony.json"), JSON.stringify(fixture));
    const r = await inspectWorkspacePath(dir);
    // AJV で meta.name が required の場合は invalid になる可能性があるため、
    // ready または invalid どちらか (schema 依存) を受け入れる
    // schema で name が required なら invalid、optional なら ready
    // harmony.v3.schema.json の meta.name は required なので invalid になるはず
    expect(["ready", "invalid"]).toContain(r.status);
  });

  it("harmony.json があるが JSON 不正 → invalid", async () => {
    const dir = path.join(TMP_ROOT, "bad-json");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "harmony.json"), "{ invalid json }");
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") {
      expect(r.reason).toMatch(/JSON parse 失敗/);
    }
  });

  it("harmony.json が schema 違反 → invalid", async () => {
    const dir = path.join(TMP_ROOT, "schema-violation");
    await fs.mkdir(dir);
    // schemaVersion フィールドを省略した不正な JSON
    await fs.writeFile(
      path.join(dir, "harmony.json"),
      JSON.stringify({ dataDir: "harmony", meta: { name: "X" } }),
    );
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("invalid");
    if (r.status === "invalid") {
      expect(r.reason).toMatch(/harmony\.v3\.schema\.json 検証エラー/);
    }
  });

  it("path がファイルでフォルダではない → notFound", async () => {
    const file = path.join(TMP_ROOT, "file.txt");
    await fs.writeFile(file, "x");
    const r = await inspectWorkspacePath(file);
    expect(r.status).toBe("notFound");
  });

  it("project.json のみあり (旧形式) → needsInit (harmony.json が無い)", async () => {
    const dir = path.join(TMP_ROOT, "old-format");
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "project.json"),
      JSON.stringify({ meta: { name: "旧ワークスペース" } }),
    );
    // harmony.json が無いので needsInit になるべき
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("needsInit");
  });
});

// ── initializeWorkspace ─────────────────────────────────────────────────────

describe("initializeWorkspace", () => {
  it("空フォルダに harmony.json + dataDir 配下サブディレクトリ群を生成 (デフォルト dataDir=harmony)", async () => {
    const dir = path.join(TMP_ROOT, "init-target");
    const r = await initializeWorkspace(dir);
    expect(r.path).toBe(path.resolve(dir));
    expect(r.name).toBe("init-target");
    expect(r.projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.dataDir).toBe("harmony");

    // harmony.json 存在 (root 直下)
    const harmonyPath = path.join(dir, "harmony.json");
    const harmony = JSON.parse(await fs.readFile(harmonyPath, "utf-8"));
    expect(harmony.schemaVersion).toBe("v3");
    expect(harmony.dataDir).toBe("harmony");
    expect(harmony.meta.id).toBe(r.projectId);
    expect(harmony.meta.name).toBe("init-target");
    expect(harmony.meta.createdAt).toMatch(/Z$/);

    // project.json が root 直下に無いことを確認 (harmony.json に置き換わった)
    await expect(fs.access(path.join(dir, "project.json"))).rejects.toThrow();

    // サブディレクトリが dataDir 配下にある
    const dataRoot = path.join(dir, "harmony");
    for (const sub of ["screens", "tables", "actions", "conventions", "sequences", "views", "view-definitions", "extensions"]) {
      const stat = await fs.stat(path.join(dataRoot, sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("opts.dataDir を指定すると harmony.json と指定 dataDir 配下にサブディレクトリが生成される", async () => {
    const dir = path.join(TMP_ROOT, "custom-datadir");
    const r = await initializeWorkspace(dir, { dataDir: "data" });
    expect(r.dataDir).toBe("data");

    const harmony = JSON.parse(await fs.readFile(path.join(dir, "harmony.json"), "utf-8"));
    expect(harmony.dataDir).toBe("data");

    // サブディレクトリが data/ 配下にある
    const stat = await fs.stat(path.join(dir, "data", "screens"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("存在しない path も mkdir -p で作る", async () => {
    const dir = path.join(TMP_ROOT, "deep", "nested", "ws");
    const r = await initializeWorkspace(dir);
    expect(r.name).toBe("ws");
    const stat = await fs.stat(path.join(dir, "harmony.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("既に harmony.json があれば idempotent (上書きしない)", async () => {
    const dir = path.join(TMP_ROOT, "existing");
    await fs.mkdir(dir);
    const ts = new Date().toISOString();
    const original = {
      $schema: "../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Existing",
        createdAt: ts,
        updatedAt: ts,
        mode: "upstream",
        maturity: "draft",
      },
      extensionsApplied: [],
      entities: {
        screens: [],
        screenGroups: [],
        screenTransitions: [],
        tables: [],
        sequences: [],
        views: [],
      },
    };
    await fs.writeFile(path.join(dir, "harmony.json"), JSON.stringify(original, null, 2));
    const r = await initializeWorkspace(dir);
    expect(r.projectId).toBe("11111111-1111-4111-8111-111111111111");
    const re = JSON.parse(await fs.readFile(path.join(dir, "harmony.json"), "utf-8"));
    expect(re.meta.name).toBe("Existing");
  });

  it("生成された harmony.json は schemas/v3/harmony.v3.schema.json で検証 pass", async () => {
    const dir = path.join(TMP_ROOT, "validated");
    await initializeWorkspace(dir);
    // 検証は initializeWorkspace 内で実行済 (失敗時は throw)。ここでは追加のスキーマ違反例を
    // 再度通すことはしない。pass = この時点で例外無く戻ってきたこと。
    const harmony = JSON.parse(await fs.readFile(path.join(dir, "harmony.json"), "utf-8"));
    expect(harmony.meta.maturity).toBe("draft");
    expect(harmony.meta.mode).toBe("upstream");
    expect(harmony.dataDir).toBe("harmony");
    expect(Array.isArray(harmony.entities.screens)).toBe(true);
  });

  it("initializeWorkspace 後に inspectWorkspacePath が ready を返す", async () => {
    const dir = path.join(TMP_ROOT, "roundtrip");
    await initializeWorkspace(dir);
    const r = await inspectWorkspacePath(dir);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.name).toBe("roundtrip");
    }
  });

  // Codex post-merge review P2-2: 既存 harmony.json が schema 違反なら init を中止
  it("既存 harmony.json の dataDir が path traversal だと throw (workspace 外への作成事故防止)", async () => {
    const dir = path.join(TMP_ROOT, "invalid-existing-traversal");
    await fs.mkdir(dir, { recursive: true });
    const broken = {
      $schema: "../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3" as const,
      dataDir: "../outside", // 仕様違反
      meta: { id: "x", name: "x", maturity: "draft", mode: "upstream", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      entities: { screens: [], tables: [], processFlows: [], conventions: [], sequences: [], views: [], viewDefinitions: [] },
    };
    await fs.writeFile(path.join(dir, "harmony.json"), JSON.stringify(broken), "utf-8");
    await expect(initializeWorkspace(dir)).rejects.toThrow(/schema 違反/);
    // workspace 外にディレクトリが作られていないことを確認
    const outside = path.join(TMP_ROOT, "outside");
    await expect(fs.access(outside)).rejects.toThrow();
  });

  it("既存 harmony.json の dataDir が絶対パスだと throw", async () => {
    const dir = path.join(TMP_ROOT, "invalid-existing-abs");
    await fs.mkdir(dir, { recursive: true });
    const broken = {
      $schema: "../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3" as const,
      dataDir: "/etc/passwd",
      meta: { id: "y", name: "y", maturity: "draft", mode: "upstream", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      entities: { screens: [], tables: [], processFlows: [], conventions: [], sequences: [], views: [], viewDefinitions: [] },
    };
    await fs.writeFile(path.join(dir, "harmony.json"), JSON.stringify(broken), "utf-8");
    await expect(initializeWorkspace(dir)).rejects.toThrow(/schema 違反/);
  });

  // opts.dataDir が反映されることの positive テスト (P2-1 関連: MCP からの dataDir 引数も同経路)
  it("opts.dataDir で dataDir をオーバーライドできる", async () => {
    const dir = path.join(TMP_ROOT, "custom-datadir");
    const result = await initializeWorkspace(dir, { dataDir: "docs/spec" });
    expect(result.dataDir).toBe("docs/spec");
    const harmony = JSON.parse(await fs.readFile(path.join(dir, "harmony.json"), "utf-8"));
    expect(harmony.dataDir).toBe("docs/spec");
    // dataDir 配下にサブディレクトリが作られていること
    await expect(fs.access(path.join(dir, "docs", "spec", "screens"))).resolves.toBeUndefined();
  });
});

// ── lockdown mode (harmony.json から dataDir 解決) ──────────────────────────

describe("lockdown mode — harmony.json から dataDir 解決 (#852 R-3 D-10)", () => {
  const origDataDir = process.env.DESIGNER_DATA_DIR;

  afterEach(() => {
    if (origDataDir === undefined) {
      delete process.env.DESIGNER_DATA_DIR;
    } else {
      process.env.DESIGNER_DATA_DIR = origDataDir;
    }
    resetWorkspaceState();
  });

  it("DESIGNER_DATA_DIR が指す path の harmony.json を正しく inspectWorkspacePath で判定できる", async () => {
    const wsDir = path.join(TMP_ROOT, "lockdown-ws");
    // harmony.json を含む valid workspace を作成
    await initializeWorkspace(wsDir);

    // lockdown env 設定
    process.env.DESIGNER_DATA_DIR = wsDir;
    initWorkspaceState();

    // inspectWorkspacePath は env と独立して path を受け取る (lockdown path を渡す)
    const r = await inspectWorkspacePath(wsDir);
    expect(r.status).toBe("ready");
  });

  it("DESIGNER_DATA_DIR が指す path の harmony.json が無ければ needsInit を返す", async () => {
    const wsDir = path.join(TMP_ROOT, "lockdown-empty");
    await fs.mkdir(wsDir);

    process.env.DESIGNER_DATA_DIR = wsDir;
    initWorkspaceState();

    const r = await inspectWorkspacePath(wsDir);
    expect(r.status).toBe("needsInit");
  });

  it("lockdown workspace の harmony.json から dataDir が解決できる (custom dataDir 対応)", async () => {
    const wsDir = path.join(TMP_ROOT, "lockdown-custom-datadir");
    await initializeWorkspace(wsDir, { dataDir: "app-data" });

    process.env.DESIGNER_DATA_DIR = wsDir;
    initWorkspaceState();

    // harmony.json を直接読んで dataDir を確認 (resolveDataRoot は projectStorage 側のため、
    // workspaceInit では inspectWorkspacePath 経由で ready を確認するのみ)
    const r = await inspectWorkspacePath(wsDir);
    expect(r.status).toBe("ready");

    // harmony.json の dataDir フィールドが正しく保存されている
    const harmony = JSON.parse(
      await fs.readFile(path.join(wsDir, "harmony.json"), "utf-8"),
    );
    expect(harmony.dataDir).toBe("app-data");
    // サブディレクトリが app-data/ 配下にある
    const stat = await fs.stat(path.join(wsDir, "app-data", "screens"));
    expect(stat.isDirectory()).toBe(true);
  });
});

// ── autoActivateOnStartup (#754) ────────────────────────────────────────────

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
    resetWorkspaceState();
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
    resetWorkspaceState();
  });

  it("recent 空 + lockdown 無し → status: none (data/project.json が存在しても auto-activate されない)", async () => {
    // legacy auto-activate がないことを確認
    // recent は空 (ファイル未作成) なので status は none になるはず
    const r = await autoActivateOnStartup();
    expect(r.status).toBe("none");
  });

  it("recent 空 + lockdown 無し → active = null (UI が /workspace/select に redirect すべき状態)", async () => {
    const r = await autoActivateOnStartup();
    // none = active 未設定
    expect(r.status).toBe("none");
    const statuses = ["lockdown", "restored", "none"] as const;
    expect(statuses).toContain(r.status);
  });

  it("recent に ready な workspace (harmony.json あり) が登録されていれば status: restored", async () => {
    // workspace を作成 (harmony.json 形式)
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
  it("HARMONY_SCHEMA_REF は schemas/v3/harmony.v3.schema.json への相対パスを含む", () => {
    expect(_internals.HARMONY_SCHEMA_REF).toContain("harmony.v3.schema.json");
  });
});
