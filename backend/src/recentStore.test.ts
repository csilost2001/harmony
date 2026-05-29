/**
 * recentStore 単体テスト (#671)
 *
 * env DESIGNER_RECENT_FILE で永続化先を tmp に振り替えてテストする。
 * 実 user の ~/.harmony/recent-workspaces.json には一切触れない。
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TMP_DIR = path.join(os.tmpdir(), `harmony-recent-test-${process.pid}-${Date.now()}`);
const TMP_FILE = path.join(TMP_DIR, "recent-workspaces.json");
const ORIGINAL_ENV = process.env.DESIGNER_RECENT_FILE;

// 環境変数を設定してから recentStore を import (環境変数は recentStore 内で関数経由で
// 都度読まれる仕様にしてあるため、import 順は本来問わないが、明示性のため top で設定)。
process.env.DESIGNER_RECENT_FILE = TMP_FILE;

const {
  upsertWorkspace,
  removeWorkspace,
  findById,
  findByPath,
  listWorkspaces,
  listDisplayWorkspaces,
  setLastActive,
  readRecent,
  _internals,
} = await import("./recentStore.js");

beforeAll(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });
});

beforeEach(async () => {
  // 各テスト前に tmp file をクリア
  try {
    await fs.unlink(TMP_FILE);
  } catch { /* not found is OK */ }
});

afterAll(async () => {
  // tmp ディレクトリ全削除 + env 復元
  try {
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
  if (ORIGINAL_ENV !== undefined) {
    process.env.DESIGNER_RECENT_FILE = ORIGINAL_ENV;
  } else {
    delete process.env.DESIGNER_RECENT_FILE;
  }
});

describe("recentStore", () => {
  it("readRecent: ファイル無しなら empty を返す", async () => {
    const r = await readRecent();
    expect(r.workspaces).toEqual([]);
    expect(r.lastActiveId).toBeNull();
    expect(r.version).toBe(1);
  });

  it("upsertWorkspace: 新規エントリは uuid 採番 + 末尾追加", async () => {
    const e1 = await upsertWorkspace("/tmp/ws1", "Workspace1");
    expect(e1.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e1.path).toBe(path.resolve("/tmp/ws1"));
    expect(e1.name).toBe("Workspace1");
    const r = await readRecent();
    expect(r.workspaces.length).toBe(1);
  });

  it("upsertWorkspace: 同じ path は id 維持で name と lastOpenedAt 更新", async () => {
    const e1 = await upsertWorkspace("/tmp/ws1", "Old Name");
    await new Promise((r) => setTimeout(r, 5));
    const e2 = await upsertWorkspace("/tmp/ws1", "New Name");
    expect(e2.id).toBe(e1.id);
    expect(e2.name).toBe("New Name");
    expect(new Date(e2.lastOpenedAt).getTime()).toBeGreaterThan(new Date(e1.lastOpenedAt).getTime());
    const r = await readRecent();
    expect(r.workspaces.length).toBe(1);
  });

  it("findByPath: 大文字小文字を含めた絶対パス正規化で一致", async () => {
    await upsertWorkspace("/tmp/ws1", "WS1");
    const found = await findByPath("/tmp/./ws1");
    expect(found).not.toBeNull();
    expect(found?.name).toBe("WS1");
  });

  it("findById: 存在しない id は null", async () => {
    const r = await findById("nope");
    expect(r).toBeNull();
  });

  it("setLastActive: lastActiveId を更新", async () => {
    const e1 = await upsertWorkspace("/tmp/ws1", "WS1");
    await setLastActive(e1.id);
    const r = await readRecent();
    expect(r.lastActiveId).toBe(e1.id);
    await setLastActive(null);
    const r2 = await readRecent();
    expect(r2.lastActiveId).toBeNull();
  });

  it("removeWorkspace: 存在する id は true、lastActiveId が同じなら null に", async () => {
    const e1 = await upsertWorkspace("/tmp/ws1", "WS1");
    await setLastActive(e1.id);
    const removed = await removeWorkspace(e1.id);
    expect(removed).toBe(true);
    const r = await readRecent();
    expect(r.workspaces.length).toBe(0);
    expect(r.lastActiveId).toBeNull();
  });

  it("removeWorkspace: 存在しない id は false", async () => {
    const r = await removeWorkspace("missing");
    expect(r).toBe(false);
  });

  it("listWorkspaces: 全件 + lastActiveId を返す", async () => {
    const e1 = await upsertWorkspace("/tmp/ws1", "WS1");
    await upsertWorkspace("/tmp/ws2", "WS2");
    await setLastActive(e1.id);
    const { workspaces, lastActiveId } = await listWorkspaces();
    expect(workspaces.length).toBe(2);
    expect(lastActiveId).toBe(e1.id);
  });

  it("listDisplayWorkspaces: 存在しない path / harmony.json 不在 entry を recent から prune する", async () => {
    const readyDir = path.join(TMP_DIR, "ready-ws");
    const noManifestDir = path.join(TMP_DIR, "no-manifest-ws");
    await fs.mkdir(readyDir, { recursive: true });
    await fs.mkdir(noManifestDir, { recursive: true });
    await fs.writeFile(path.join(readyDir, "harmony.json"), "{}", "utf-8");

    const ready = await upsertWorkspace(readyDir, "Ready");
    const missing = await upsertWorkspace(path.join(TMP_DIR, "missing-ws"), "Missing");
    await upsertWorkspace(noManifestDir, "NoManifest");
    await setLastActive(missing.id);

    const listed = await listDisplayWorkspaces();

    expect(listed.workspaces.map((w) => w.id)).toEqual([ready.id]);
    expect(listed.lastActiveId).toBeNull();
    expect(listed.prunedCount).toBe(2);

    const persisted = await readRecent();
    expect(persisted.workspaces.map((w) => w.id)).toEqual([ready.id]);
    expect(persisted.lastActiveId).toBeNull();
  });

  it("listDisplayWorkspaces: .tmp/e2e-workspaces 配下は recent に保持しつつ通常一覧から隠す", async () => {
    const readyDir = path.join(TMP_DIR, "normal-ws");
    const e2eDir = path.join(TMP_DIR, ".tmp", "e2e-workspaces", "w0-smoke");
    await fs.mkdir(readyDir, { recursive: true });
    await fs.mkdir(e2eDir, { recursive: true });
    await fs.writeFile(path.join(readyDir, "harmony.json"), "{}", "utf-8");
    await fs.writeFile(path.join(e2eDir, "harmony.json"), "{}", "utf-8");

    const ready = await upsertWorkspace(readyDir, "Ready");
    const e2e = await upsertWorkspace(e2eDir, "E2E");

    const listed = await listDisplayWorkspaces();

    expect(listed.workspaces.map((w) => w.id)).toEqual([ready.id]);
    expect(listed.hiddenCount).toBe(1);
    expect(await findById(e2e.id)).not.toBeNull();
  });

  it("recentFile() は env DESIGNER_RECENT_FILE を尊重 (現在値が TMP_FILE)", () => {
    expect(_internals.recentFile()).toBe(path.resolve(TMP_FILE));
  });

  it("env 未設定時のデフォルトは ~/.harmony/recent-workspaces.json", () => {
    const original = process.env.DESIGNER_RECENT_FILE;
    const originalHome = process.env.HARMONY_HOME;
    delete process.env.DESIGNER_RECENT_FILE;
    delete process.env.HARMONY_HOME;
    try {
      expect(_internals.recentFile()).toBe(
        path.join(os.homedir(), ".harmony", "recent-workspaces.json"),
      );
    } finally {
      if (original !== undefined) process.env.DESIGNER_RECENT_FILE = original;
      if (originalHome !== undefined) process.env.HARMONY_HOME = originalHome;
    }
  });

  it("env HARMONY_HOME 指定時は <HARMONY_HOME>/recent-workspaces.json (#1055)", () => {
    const original = process.env.DESIGNER_RECENT_FILE;
    const originalHome = process.env.HARMONY_HOME;
    delete process.env.DESIGNER_RECENT_FILE;
    process.env.HARMONY_HOME = "/tmp/harmony-state-xyz";
    try {
      expect(_internals.recentFile()).toBe("/tmp/harmony-state-xyz/recent-workspaces.json");
    } finally {
      if (original !== undefined) process.env.DESIGNER_RECENT_FILE = original;
      if (originalHome !== undefined) {
        process.env.HARMONY_HOME = originalHome;
      } else {
        delete process.env.HARMONY_HOME;
      }
    }
  });

  it("DESIGNER_RECENT_FILE は HARMONY_HOME より優先される (#1055)", () => {
    const original = process.env.DESIGNER_RECENT_FILE;
    const originalHome = process.env.HARMONY_HOME;
    process.env.DESIGNER_RECENT_FILE = "/tmp/override-file.json";
    process.env.HARMONY_HOME = "/tmp/should-be-ignored";
    try {
      expect(_internals.recentFile()).toBe(path.resolve("/tmp/override-file.json"));
    } finally {
      if (original !== undefined) {
        process.env.DESIGNER_RECENT_FILE = original;
      } else {
        delete process.env.DESIGNER_RECENT_FILE;
      }
      if (originalHome !== undefined) {
        process.env.HARMONY_HOME = originalHome;
      } else {
        delete process.env.HARMONY_HOME;
      }
    }
  });

  it("HARMONY_HOME が空文字 / 空白のみの場合はデフォルトに fallback (#1055)", () => {
    const original = process.env.DESIGNER_RECENT_FILE;
    const originalHome = process.env.HARMONY_HOME;
    delete process.env.DESIGNER_RECENT_FILE;
    process.env.HARMONY_HOME = "   ";
    try {
      expect(_internals.recentFile()).toBe(
        path.join(os.homedir(), ".harmony", "recent-workspaces.json"),
      );
    } finally {
      if (original !== undefined) process.env.DESIGNER_RECENT_FILE = original;
      if (originalHome !== undefined) {
        process.env.HARMONY_HOME = originalHome;
      } else {
        delete process.env.HARMONY_HOME;
      }
    }
  });
});
