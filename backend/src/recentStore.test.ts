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

  it("recentFile() は env DESIGNER_RECENT_FILE を尊重 (現在値が TMP_FILE)", () => {
    expect(_internals.recentFile()).toBe(path.resolve(TMP_FILE));
  });

  it("env 未設定時のデフォルトは ~/.harmony/recent-workspaces.json", () => {
    const original = process.env.DESIGNER_RECENT_FILE;
    delete process.env.DESIGNER_RECENT_FILE;
    try {
      expect(_internals.recentFile()).toBe(
        path.join(os.homedir(), ".harmony", "recent-workspaces.json"),
      );
    } finally {
      if (original !== undefined) process.env.DESIGNER_RECENT_FILE = original;
    }
  });
});
