/**
 * multiEditSession.test.ts (#904 / meta #897 Phase 7)
 *
 * 複数 EditSession 並存 (spec §9) の統合テスト。
 * spec §18.1 受け入れ基準の以下を検証:
 *  - § 9 複数 EditSession 並存 + last-save-wins 警告ダイアログ (警告ダイアログは frontend 側、
 *    ここでは save 順序と mtime 整合の backend ロジックを検証)
 *
 * 検証ケース:
 * 1. 同一 resource に 2 active EditSession → listByResource() が両方返す
 * 2. 並存中の独立性 — EditSession-A の participant 変化が EditSession-B に影響しない
 * 3. EditSession-A.save → history FS に A の saveHistory が書かれる
 * 4. EditSession-B.save (A の後) → last-save-wins、B の saveHistory も独立
 * 5. active 件数が複数: listByResource() の件数確認 + 警告判定ロジック検証
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EditSessionStore,
} from "./editSessionStore.js";

// ── テスト共通セットアップ ──────────────────────────────────────────────────────

let tmpDir: string;
let store: EditSessionStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-edit-session-test-"));
  store = new EditSessionStore(tmpDir);
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── 1. 同一 resource に 2 active EditSession → listByResource() が両方返す ────

describe("同一 resource に複数 EditSession 並存 (spec §9.1)", () => {
  it("1. 同一 resource に 2 つの active EditSession が共存し、listByResource() が両方返す", () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    // 両方 Active
    expect(sessionA.state).toBe("Active");
    expect(sessionB.state).toBe("Active");
    expect(sessionA.id).not.toBe(sessionB.id);

    // listByResource() が両方返す
    const sessions = store.listByResource("process-flow", "pf-1");
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(sessionA.id);
    expect(ids).toContain(sessionB.id);
  });

  it("3 つの EditSession も並存できる", () => {
    store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.create("session-bob", "process-flow", "pf-1", "@bob");
    store.create("session-carol", "process-flow", "pf-1", "@carol");

    const sessions = store.listByResource("process-flow", "pf-1");
    expect(sessions).toHaveLength(3);
  });

  it("異なる resource の EditSession は listByResource() で混在しない", () => {
    store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.create("session-bob", "process-flow", "pf-2", "@bob"); // 別リソース
    store.create("session-carol", "table", "tbl-1", "@carol"); // 別タイプ

    const pf1Sessions = store.listByResource("process-flow", "pf-1");
    expect(pf1Sessions).toHaveLength(1);
    expect(pf1Sessions[0].participants.get("session-alice")?.displayLabel).toBe("@alice");
  });
});

// ── 2. 並存中の独立性 ─────────────────────────────────────────────────────────

describe("並存中の独立性 (spec §9.1)", () => {
  it("2. EditSession-A の participant 変化が EditSession-B に影響しない", () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    // EditSession-A に carol を追加
    store.attachAsView(sessionA.id, "session-carol", "@carol");

    // EditSession-A には alice (Edit) + carol (View) の 2 名
    expect(sessionA.participants.size).toBe(2);

    // EditSession-B は影響を受けない — bob のみ
    expect(sessionB.participants.size).toBe(1);
    expect(sessionB.participants.get("session-bob")?.role).toBe("Edit");
  });

  it("EditSession-A の payload 更新が EditSession-B に漏れない", () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    // EditSession-A の payload を更新
    store.update(sessionA.id, { content: "A 案: 現金払い" }, "session-alice");

    // EditSession-B の payload は null のまま (更新されていない)
    const payloadB = store.fetchCurrentPayload(sessionB.id);
    expect(payloadB?.payload).toBeNull();
    expect(sessionB.sequence).toBe(0);

    // EditSession-A の payload が A 案であることを確認
    const payloadA = store.fetchCurrentPayload(sessionA.id);
    expect((payloadA?.payload as Record<string, unknown>)?.content).toBe("A 案: 現金払い");
  });

  it("EditSession-A の take-over が EditSession-B に影響しない", () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    store.attachAsView(sessionA.id, "session-carol", "@carol");

    // EditSession-A: alice → carol に take-over
    store.transferEdit("session-alice", "session-carol", sessionA.id);

    // EditSession-A: alice=View, carol=Edit
    expect(sessionA.participants.get("session-alice")?.role).toBe("View");
    expect(sessionA.participants.get("session-carol")?.role).toBe("Edit");

    // EditSession-B は影響を受けない: bob=Edit のまま
    expect(sessionB.participants.get("session-bob")?.role).toBe("Edit");
  });
});

// ── 3. EditSession-A.save → 本体ファイルは A 案の saveHistory が記録される ───

describe("A/B 案の独立 save (spec §9.3 last-save-wins)", () => {
  it("3. EditSession-A.save → history FS に A の saveHistory が書かれる", async () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.update(sessionA.id, { content: "A 案: 定期払い" }, "session-alice");

    const saveEventA = await store.save(sessionA.id, "session-alice");

    expect(saveEventA.savedBy).toBe("session-alice");
    expect(sessionA.saveHistory).toHaveLength(1);

    // history FS を確認
    const filePathA = path.join(tmpDir, ".edit-sessions", `${sessionA.id}.json`);
    const contentA = JSON.parse(await fs.readFile(filePathA, "utf-8"));
    expect(contentA.saveHistory).toHaveLength(1);
    expect(contentA.saveHistory[0].savedBy).toBe("session-alice");
    expect(contentA.state).toBe("Active");
  });

  it("4. EditSession-B.save (A の後) → B の saveHistory が独立して記録される (last-save-wins)", async () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    store.update(sessionA.id, { content: "A 案: 定期払い" }, "session-alice");
    store.update(sessionB.id, { content: "B 案: 現金払い" }, "session-bob");

    // EditSession-A を先に save
    await store.save(sessionA.id, "session-alice");
    const saveTimeA = new Date(sessionA.saveHistory[0].savedAt).getTime();

    // EditSession-B を後に save (last-save-wins)
    await store.save(sessionB.id, "session-bob");
    const saveTimeB = new Date(sessionB.saveHistory[0].savedAt).getTime();

    // B の save が A の save より後であることを確認 (または同時)
    expect(saveTimeB).toBeGreaterThanOrEqual(saveTimeA);

    // 両方の history FS が独立して存在する
    const filePathA = path.join(tmpDir, ".edit-sessions", `${sessionA.id}.json`);
    const filePathB = path.join(tmpDir, ".edit-sessions", `${sessionB.id}.json`);

    const contentA = JSON.parse(await fs.readFile(filePathA, "utf-8"));
    const contentB = JSON.parse(await fs.readFile(filePathB, "utf-8"));

    expect(contentA.saveHistory[0].savedBy).toBe("session-alice");
    expect(contentB.saveHistory[0].savedBy).toBe("session-bob");
  });
});

// ── 5. 複数 active 件数の警告判定ロジック ───────────────────────────────────

describe("警告判定ロジック (spec §9.3 警告ダイアログ前提)", () => {
  it("5a. listByResource() の active 件数が 2 以上なら UI で警告ダイアログを出すべき", () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    const activeSessions = store
      .listByResource("process-flow", "pf-1")
      .filter((s) => s.state === "Active");

    // active 2 件 → 警告ダイアログを出す前提条件が満たされている
    expect(activeSessions.length).toBeGreaterThanOrEqual(2);

    // 実際の警告判断: 今から save しようとしているのが alice で、
    // 他に active EditSession が存在するなら警告
    const sessionToSave = sessionA;
    const otherActiveSessions = activeSessions.filter((s) => s.id !== sessionToSave.id);
    expect(otherActiveSessions).toHaveLength(1);
    expect(otherActiveSessions[0].id).toBe(sessionB.id);
  });

  it("5b. Discarded な EditSession は警告判定から除外される", async () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    // EditSession-B を discard
    store.setRole(sessionB.id, "session-bob", "View");
    await store.discard(sessionB.id, "manual");

    // active のみフィルタ
    const activeSessions = store
      .listByResource("process-flow", "pf-1")
      .filter((s) => s.state === "Active");

    // sessionB は Discarded なので active には 1 件のみ
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].id).toBe(sessionA.id);
  });

  it("5c. saveHistory の最終 save 時刻を用いた衝突判定: A の後に B が save した場合", async () => {
    const sessionA = store.create("session-alice", "process-flow", "pf-1", "@alice");
    const sessionB = store.create("session-bob", "process-flow", "pf-1", "@bob");

    store.update(sessionA.id, { version: "A" }, "session-alice");
    store.update(sessionB.id, { version: "B" }, "session-bob");

    // A を save
    await store.save(sessionA.id, "session-alice");
    const lastSaveByA = sessionA.saveHistory[sessionA.saveHistory.length - 1].savedAt;

    // B が save しようとする際の衝突チェックロジック
    // (wsBridge は save リクエスト時に他 active EditSession の lastSave を比較)
    const otherActiveSessions = store
      .listByResource("process-flow", "pf-1")
      .filter((s) => s.state === "Active" && s.id !== sessionB.id);

    const conflictExists = otherActiveSessions.some((s) => {
      const lastSave = s.saveHistory[s.saveHistory.length - 1];
      return lastSave !== undefined; // A は既に save 済み → conflict
    });

    expect(conflictExists).toBe(true); // → 警告ダイアログを出す前提

    // B が save を続行 (last-save-wins)
    const saveEventB = await store.save(sessionB.id, "session-bob");
    expect(saveEventB.savedBy).toBe("session-bob");

    // A の saveHistory には A の記録が残る
    expect(sessionA.saveHistory[0].savedAt).toBe(lastSaveByA);
    // B の saveHistory には B の記録が独立して残る
    expect(sessionB.saveHistory[0].savedBy).toBe("session-bob");
  });
});
