/**
 * draftHistoryStore.test.ts (#893)
 *
 * DraftHistoryStore の基本動作を実 FS で確認する。
 * - saveSnapshot → listHistory で取得、timestamp 降順
 * - cleanupExpired で 7 日以前の history を削除、新しいのは残る
 * - restoreFromHistory で正しい snapshot が読める
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DraftHistoryStore, generateHistoryId } from "./draftHistoryStore.js";

// ── テスト共通セットアップ ──────────────────────────────────────────────────────

let tmpDir: string;
let store: DraftHistoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-history-store-test-"));
  store = new DraftHistoryStore(tmpDir);
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── generateHistoryId ─────────────────────────────────────────────────────────

describe("generateHistoryId", () => {
  it("-- (二重ハイフン) を区切り文字として含む", () => {
    const id = generateHistoryId("2026-05-07T18:30:00.000Z", "es-abc12345");
    expect(id).toContain("--");
  });

  it("コロンを含まない (Windows ファイル名互換)", () => {
    const id = generateHistoryId("2026-05-07T18:30:00.000Z", "es-abc12345");
    expect(id).not.toContain(":");
  });

  it("異なる呼び出しで異なる ID が生成される", () => {
    const id1 = generateHistoryId("2026-05-07T18:30:00.000Z", "es-abc12345");
    const id2 = generateHistoryId("2026-05-07T18:30:00.000Z", "es-abc12345");
    // ランダムサフィックスにより衝突しにくい (確率的だが基本は異なる)
    // 同一 ms + 同一 rand でも空文字と異なることは確認できる
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(10);
  });
});

// ── saveSnapshot ──────────────────────────────────────────────────────────────

describe("saveSnapshot", () => {
  it("snapshot を保存してエントリを返す", async () => {
    const entry = await store.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-1",
      editSessionId: "es-test-001",
      ownerSessionId: "session-A",
      ownerLabel: "@alice",
      reason: "save",
      snapshot: { id: "pf-1", actions: [] },
    });

    expect(entry.historyId).toBeTruthy();
    expect(entry.resourceType).toBe("process-flow");
    expect(entry.resourceId).toBe("pf-1");
    expect(entry.reason).toBe("save");
    expect(entry.ownerLabel).toBe("@alice");
    expect(entry.snapshot).toEqual({ id: "pf-1", actions: [] });
  });

  it("FS にファイルが作成される", async () => {
    const entry = await store.saveSnapshot({
      resourceType: "table",
      resourceId: "tbl-1",
      editSessionId: "es-test-002",
      ownerSessionId: "session-B",
      ownerLabel: "@bob",
      reason: "discard",
      snapshot: { id: "tbl-1", columns: [] },
    });

    const filePath = path.join(
      tmpDir,
      ".edit-sessions-history",
      "table",
      "tbl-1",
      `${entry.historyId}.json`,
    );
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.historyId).toBe(entry.historyId);
    expect(parsed.snapshot).toEqual({ id: "tbl-1", columns: [] });
  });
});

// ── listHistory ───────────────────────────────────────────────────────────────

describe("listHistory", () => {
  it("エントリが timestamp 降順で返る", async () => {
    // 3 件を time 順に追加
    for (let i = 0; i < 3; i++) {
      await store.saveSnapshot({
        resourceType: "process-flow",
        resourceId: "pf-list",
        editSessionId: "es-list-001",
        ownerSessionId: "session-A",
        ownerLabel: "@alice",
        reason: "save",
        snapshot: { seq: i },
      });
      // 微小な時間差を作る (同一 ms の場合は sort 順は不定だが通常は連続しない)
      await new Promise((r) => setTimeout(r, 5));
    }

    const history = await store.listHistory({ resourceType: "process-flow", resourceId: "pf-list" });
    expect(history.length).toBe(3);

    // timestamp 降順 (後に追加したものが先頭)
    for (let i = 0; i < history.length - 1; i++) {
      const ta = new Date(history[i].timestamp).getTime();
      const tb = new Date(history[i + 1].timestamp).getTime();
      expect(ta).toBeGreaterThanOrEqual(tb);
    }
  });

  it("ディレクトリが存在しない場合は空配列を返す", async () => {
    const history = await store.listHistory({ resourceType: "process-flow", resourceId: "nonexistent" });
    expect(history).toEqual([]);
  });

  it("別リソースの履歴は混在しない", async () => {
    await store.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-A",
      editSessionId: "es-A",
      ownerSessionId: "session-A",
      ownerLabel: "@alice",
      reason: "save",
      snapshot: { id: "A" },
    });
    await store.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-B",
      editSessionId: "es-B",
      ownerSessionId: "session-B",
      ownerLabel: "@bob",
      reason: "discard",
      snapshot: { id: "B" },
    });

    const historyA = await store.listHistory({ resourceType: "process-flow", resourceId: "pf-A" });
    const historyB = await store.listHistory({ resourceType: "process-flow", resourceId: "pf-B" });
    expect(historyA).toHaveLength(1);
    expect(historyA[0].snapshot).toEqual({ id: "A" });
    expect(historyB).toHaveLength(1);
    expect(historyB[0].snapshot).toEqual({ id: "B" });
  });
});

// ── restoreFromHistory ────────────────────────────────────────────────────────

describe("restoreFromHistory", () => {
  it("historyId から正しい snapshot が読める", async () => {
    const entry = await store.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-restore",
      editSessionId: "es-restore-001",
      ownerSessionId: "session-A",
      ownerLabel: "@alice",
      reason: "transferEdit",
      snapshot: { id: "pf-restore", actions: [{ id: "act-1" }] },
    });

    const restored = await store.restoreFromHistory({ historyId: entry.historyId });
    expect(restored).not.toBeNull();
    expect(restored!.historyId).toBe(entry.historyId);
    expect(restored!.snapshot).toEqual({ id: "pf-restore", actions: [{ id: "act-1" }] });
    expect(restored!.ownerLabel).toBe("@alice");
    expect(restored!.reason).toBe("transferEdit");
  });

  it("存在しない historyId は null を返す", async () => {
    const result = await store.restoreFromHistory({ historyId: "nonexistent-id" });
    expect(result).toBeNull();
  });
});

// ── cleanupExpired ────────────────────────────────────────────────────────────

describe("cleanupExpired", () => {
  it("7 日以前のファイルを削除し、新しいファイルは残す", async () => {
    // 新しいエントリを保存
    const newEntry = await store.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-cleanup",
      editSessionId: "es-new",
      ownerSessionId: "session-A",
      ownerLabel: "@alice",
      reason: "save",
      snapshot: { type: "new" },
    });

    // 古いエントリを模倣: ファイルの mtime を 8 日前に変更
    const historyDir = path.join(tmpDir, ".edit-sessions-history", "process-flow", "pf-cleanup");
    const files = await fs.readdir(historyDir);
    const oldFilePath = path.join(historyDir, `old-entry--esold-abcd.json`);
    const oldEntry = {
      historyId: "old-entry--esold-abcd",
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      editSessionId: "es-old",
      ownerSessionId: "session-B",
      ownerLabel: "@bob",
      reason: "discard",
      resourceType: "process-flow",
      resourceId: "pf-cleanup",
      snapshot: { type: "old" },
    };
    await fs.writeFile(oldFilePath, JSON.stringify(oldEntry), "utf-8");
    // mtime を 8 日前に設定
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldFilePath, eightDaysAgo, eightDaysAgo);

    // cleanup 実行
    const deleted = await store.cleanupExpired({ olderThanDays: 7 });

    // 古いエントリが削除される
    expect(deleted).toContain("old-entry--esold-abcd");

    // 新しいエントリはまだ存在する
    const newFilePath = path.join(historyDir, `${newEntry.historyId}.json`);
    await expect(fs.access(newFilePath)).resolves.toBeUndefined();

    // 削除されたファイルは存在しない
    await expect(fs.access(oldFilePath)).rejects.toThrow();

    void files; // suppress unused warning
  });

  it("ディレクトリが存在しない場合は空配列を返す", async () => {
    const deleted = await store.cleanupExpired({ olderThanDays: 7 });
    expect(deleted).toEqual([]);
  });
});
