/**
 * fsBrowse 単体テスト (#1056)
 *
 * 実 fs を tmp ディレクトリに構築して browseFs() の動作を検証。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { browseFs, BrowseFsError, resolveDefaultBrowsePath } from "./fsBrowse.js";

const TMP_ROOT = path.join(os.tmpdir(), `harmony-fsbrowse-test-${process.pid}-${Date.now()}`);

beforeAll(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  // 構造:
  //   TMP_ROOT/
  //     ws-a/
  //       harmony.json                  ← isWorkspace=true
  //       screens/
  //     ws-b/
  //       harmony.json                  ← isWorkspace=true
  //     not-a-workspace/
  //       readme.md                     ← isWorkspace=false (harmony.json なし)
  //     file-at-root.txt                ← isDir=false, isWorkspace=false
  await fs.mkdir(path.join(TMP_ROOT, "ws-a", "screens"), { recursive: true });
  await fs.writeFile(path.join(TMP_ROOT, "ws-a", "harmony.json"), "{}", "utf-8");
  await fs.mkdir(path.join(TMP_ROOT, "ws-b"), { recursive: true });
  await fs.writeFile(path.join(TMP_ROOT, "ws-b", "harmony.json"), "{}", "utf-8");
  await fs.mkdir(path.join(TMP_ROOT, "not-a-workspace"), { recursive: true });
  await fs.writeFile(path.join(TMP_ROOT, "not-a-workspace", "readme.md"), "# hi", "utf-8");
  await fs.writeFile(path.join(TMP_ROOT, "file-at-root.txt"), "hello", "utf-8");
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("browseFs", () => {
  it("ディレクトリ内のエントリを返す + workspace 判定が正しい", async () => {
    const r = await browseFs(TMP_ROOT);
    expect(r.path).toBe(path.resolve(TMP_ROOT));
    expect(r.parent).toBe(path.dirname(TMP_ROOT));
    const names = r.entries.map((e) => e.name);
    expect(names).toContain("ws-a");
    expect(names).toContain("ws-b");
    expect(names).toContain("not-a-workspace");
    expect(names).toContain("file-at-root.txt");

    const wsA = r.entries.find((e) => e.name === "ws-a")!;
    expect(wsA.isDir).toBe(true);
    expect(wsA.isWorkspace).toBe(true);

    const notWs = r.entries.find((e) => e.name === "not-a-workspace")!;
    expect(notWs.isDir).toBe(true);
    expect(notWs.isWorkspace).toBe(false);

    const file = r.entries.find((e) => e.name === "file-at-root.txt")!;
    expect(file.isDir).toBe(false);
    expect(file.isWorkspace).toBe(false);
  });

  it("ディレクトリ→ファイル順、各カテゴリ内は name 昇順でソート", async () => {
    const r = await browseFs(TMP_ROOT);
    // dir 群が file 群より前にあること
    const firstFileIdx = r.entries.findIndex((e) => !e.isDir);
    const lastDirIdx = r.entries.reduce((acc, e, i) => (e.isDir ? i : acc), -1);
    expect(lastDirIdx).toBeLessThan(firstFileIdx);
    // dir 部分が name 昇順
    const dirs = r.entries.filter((e) => e.isDir).map((e) => e.name);
    expect(dirs).toEqual([...dirs].sort((a, b) => a.localeCompare(b, "ja")));
  });

  it("mtime が ISO 8601 で返る", async () => {
    const r = await browseFs(TMP_ROOT);
    const wsA = r.entries.find((e) => e.name === "ws-a")!;
    expect(wsA.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("path 省略時は default 開始位置 (= resolveDefaultBrowsePath) を使う", async () => {
    const originalWs = process.env.HARMONY_WORKSPACES_DIR;
    const originalHome = process.env.HARMONY_HOME;
    process.env.HARMONY_WORKSPACES_DIR = TMP_ROOT;
    delete process.env.HARMONY_HOME;
    try {
      const r = await browseFs();
      expect(r.path).toBe(path.resolve(TMP_ROOT));
    } finally {
      if (originalWs !== undefined) {
        process.env.HARMONY_WORKSPACES_DIR = originalWs;
      } else {
        delete process.env.HARMONY_WORKSPACES_DIR;
      }
      if (originalHome !== undefined) process.env.HARMONY_HOME = originalHome;
    }
  });

  it("../ を含む相対 path は path.resolve で正規化される", async () => {
    const tricky = path.join(TMP_ROOT, "ws-a", "..", "ws-b");
    const r = await browseFs(tricky);
    expect(r.path).toBe(path.join(TMP_ROOT, "ws-b"));
  });

  it("notFound: 存在しない path", async () => {
    await expect(browseFs(path.join(TMP_ROOT, "does-not-exist-xyz")))
      .rejects.toThrow(BrowseFsError);
    try {
      await browseFs(path.join(TMP_ROOT, "does-not-exist-xyz"));
    } catch (e) {
      expect(e).toBeInstanceOf(BrowseFsError);
      expect((e as BrowseFsError).code).toBe("notFound");
    }
  });

  it("notDir: ファイルを指定", async () => {
    try {
      await browseFs(path.join(TMP_ROOT, "file-at-root.txt"));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BrowseFsError);
      expect((e as BrowseFsError).code).toBe("notDir");
    }
  });

  it("root の parent は null", async () => {
    // Linux/macOS では '/'、Windows では 'C:\' 等
    const root = path.parse(process.cwd()).root;
    if (root && root !== "" && root !== process.cwd()) {
      const r = await browseFs(root);
      expect(r.parent).toBeNull();
    }
  });
});

describe("resolveDefaultBrowsePath", () => {
  let originalWs: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalWs = process.env.HARMONY_WORKSPACES_DIR;
    originalHome = process.env.HARMONY_HOME;
    delete process.env.HARMONY_WORKSPACES_DIR;
    delete process.env.HARMONY_HOME;
  });

  afterEach(() => {
    if (originalWs !== undefined) {
      process.env.HARMONY_WORKSPACES_DIR = originalWs;
    } else {
      delete process.env.HARMONY_WORKSPACES_DIR;
    }
    if (originalHome !== undefined) {
      process.env.HARMONY_HOME = originalHome;
    } else {
      delete process.env.HARMONY_HOME;
    }
  });

  it("HARMONY_WORKSPACES_DIR が最優先", () => {
    process.env.HARMONY_WORKSPACES_DIR = "/data/workspaces";
    process.env.HARMONY_HOME = "/home/node/.harmony";
    expect(resolveDefaultBrowsePath()).toBe(path.resolve("/data/workspaces"));
  });

  it("HARMONY_HOME のみ指定時はその親ディレクトリ", () => {
    process.env.HARMONY_HOME = "/home/node/.harmony";
    expect(resolveDefaultBrowsePath()).toBe(path.resolve("/home/node"));
  });

  it("いずれも未設定なら os.homedir()", () => {
    expect(resolveDefaultBrowsePath()).toBe(os.homedir());
  });
});
