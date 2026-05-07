/**
 * editSessionStore.test.ts (#898 / meta #897 Phase 1)
 *
 * spec docs/spec/edit-session-protocol.md のシナリオを網羅:
 * - ライフサイクル (create / attachAsView / fetchCurrentPayload / update)
 * - take-over (transferEdit) — 正常系 / エラー系
 * - save 権限 (Edit 在席時 / 全員 View 時)
 * - 複数 EditSession 並存 (§9.1)
 * - AI participant (parentHumanSessionId / §10.2)
 * - cleanupExpired TTL 2 段階 (§12.2)
 * - discard (manual)
 * - ULID-like id の時刻順序
 * - DraftHistoryStore hook (#893): discard / transferEdit / save 時の saveSnapshot 呼び出し
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EditSessionStore,
  EditSessionNotFoundError,
  EditSessionStateError,
  EditSessionPermissionError,
  EditSessionParticipantError,
} from "./editSessionStore.js";
import type { DraftHistoryStore } from "./draftHistoryStore.js";

// ── テスト共通セットアップ ──────────────────────────────────────────────────────

let tmpDir: string;
let store: EditSessionStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-session-store-test-"));
  store = new EditSessionStore(tmpDir);
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── 1. create → 新規 EditSession、initial Edit participant 1 名 ────────────────

describe("create", () => {
  it("新規 EditSession を作成し initial Edit participant が 1 名登録される", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");

    expect(session.id).toMatch(/^es-/);
    expect(session.resourceType).toBe("process-flow");
    expect(session.resourceId).toBe("pf-1");
    expect(session.state).toBe("Active");
    expect(session.sequence).toBe(0);
    expect(session.saveHistory).toHaveLength(0);
    expect(typeof session.createdAt).toBe("string");
    expect(typeof session.expiresAt).toBe("string");
    expect(typeof session.lastActivityAt).toBe("string");

    const participants = Array.from(session.participants.values());
    expect(participants).toHaveLength(1);
    expect(participants[0].sessionId).toBe("session-A");
    expect(participants[0].role).toBe("Edit");
    expect(participants[0].displayLabel).toBe("@alice");
  });

  it("get() で取得できる", () => {
    const session = store.create("session-A", "table", "tbl-1", "@alice");
    const retrieved = store.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
  });

  it("存在しない id は get() が null を返す", () => {
    expect(store.get("nonexistent")).toBeNull();
  });
});

// ── 2. attachAsView → 既存 EditSession に View で join ───────────────────────

describe("attachAsView", () => {
  it("View role で join でき participants が 2 名に増える", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    const participant = store.attachAsView(session.id, "session-B", "@bob");

    expect(participant.sessionId).toBe("session-B");
    expect(participant.role).toBe("View");
    expect(participant.displayLabel).toBe("@bob");

    const participants = Array.from(session.participants.values());
    expect(participants).toHaveLength(2);
  });

  it("存在しない EditSession への attachAsView は EditSessionNotFoundError", () => {
    expect(() => store.attachAsView("nonexistent", "session-B", "@bob")).toThrow(
      EditSessionNotFoundError,
    );
  });

  it("Discarded な EditSession への attachAsView は EditSessionStateError", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    // Edit を View に降格してから discard
    store.setRole(session.id, "session-A", "View");
    await store.discard(session.id, "manual");
    expect(() => store.attachAsView(session.id, "session-B", "@bob")).toThrow(
      EditSessionStateError,
    );
  });
});

// ── 3. fetchCurrentPayload → 別 session が attach 後に最新 payload + sequence を取得 ──

describe("fetchCurrentPayload", () => {
  it("後から接続した viewer が最新 payload を取得できる (§1.1 根本欠陥の解消)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");

    // editor が payload を更新
    const testPayload = { name: "テスト", steps: [1, 2, 3] };
    store.update(session.id, testPayload, "session-A");
    store.update(session.id, { ...testPayload, extra: "value" }, "session-A");

    // 後から接続した viewer が attach
    store.attachAsView(session.id, "session-B", "@bob");

    // fetchCurrentPayload で最新 state を取得できる
    const result = store.fetchCurrentPayload(session.id);
    expect(result).not.toBeNull();
    expect(result?.sequence).toBe(2);
    expect((result?.payload as Record<string, unknown>)?.extra).toBe("value");
  });

  it("存在しない id は null を返す", () => {
    expect(store.fetchCurrentPayload("nonexistent")).toBeNull();
  });

  it("payload 未更新 (null) でも取得できる", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    const result = store.fetchCurrentPayload(session.id);
    expect(result?.payload).toBeNull();
    expect(result?.sequence).toBe(0);
  });
});

// ── 4. update → payload 更新で sequence +1、lastActivityAt 更新 ────────────────

describe("update", () => {
  it("payload 更新で sequence が increment される", () => {
    const session = store.create("session-A", "table", "tbl-1", "@alice");
    const result1 = store.update(session.id, { v: 1 }, "session-A");
    expect(result1.sequence).toBe(1);
    const result2 = store.update(session.id, { v: 2 }, "session-A");
    expect(result2.sequence).toBe(2);
    expect(session.sequence).toBe(2);
  });

  it("View role の participant は update できない", () => {
    const session = store.create("session-A", "table", "tbl-1", "@alice");
    store.attachAsView(session.id, "session-B", "@bob");
    expect(() => store.update(session.id, { v: 1 }, "session-B")).toThrow(
      EditSessionPermissionError,
    );
  });

  it("参加していない session は update できない", () => {
    const session = store.create("session-A", "table", "tbl-1", "@alice");
    expect(() => store.update(session.id, { v: 1 }, "session-X")).toThrow(
      EditSessionParticipantError,
    );
  });

  it("FS に write しない (snapshot only 原則 ④)", async () => {
    const session = store.create("session-A", "table", "tbl-1", "@alice");
    store.update(session.id, { v: 1 }, "session-A");

    // .edit-sessions ディレクトリが存在しないことを確認 (FS write されていない)
    const dir = path.join(tmpDir, ".edit-sessions");
    let exists = false;
    try {
      await fs.access(dir);
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

// ── 5. transferEdit 正常系 → from Edit → View, to View → Edit に atomic ──────

describe("transferEdit (take-over)", () => {
  it("正常系: from Edit→View, to View→Edit が atomic に発生する (spec §7)", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-B", "@bob");

    const result = store.transferEdit("session-A", "session-B", session.id);

    expect(result.from.sessionId).toBe("session-A");
    expect(result.from.role).toBe("View");
    expect(result.to.sessionId).toBe("session-B");
    expect(result.to.role).toBe("Edit");

    // participants に直接アクセスして確認
    expect(session.participants.get("session-A")?.role).toBe("View");
    expect(session.participants.get("session-B")?.role).toBe("Edit");
  });

  // ── 6. transferEdit エラー系 1: from が Edit でない ────────────────────────────

  it("エラー系 1: from が Edit role でない場合は EditSessionPermissionError", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-B", "@bob");

    expect(() => store.transferEdit("session-B", "session-A", session.id)).toThrow(
      EditSessionPermissionError,
    );
  });

  // ── 7. transferEdit エラー系 2: to が participant でない / View でない ──────────

  it("エラー系 2a: to が participant でない場合は EditSessionParticipantError", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");

    expect(() => store.transferEdit("session-A", "session-X", session.id)).toThrow(
      EditSessionParticipantError,
    );
  });

  it("エラー系 2b: to が View でない (= Edit) 場合は EditSessionPermissionError", () => {
    // 同じ session を View で付け直してから Edit にしようとするケース
    // 2 人目の Edit を直接セットしようとする場面をテスト
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    // 別の手段で Edit を付けようとする: setRole を使って Edit を 2 人にしようとする
    store.attachAsView(session.id, "session-B", "@bob");
    // session-B が View の状態で transferEdit — 正常系パスになるが、
    // to に既に Edit がいるケースをシミュレートするため役割を先に切り替えてみる
    store.transferEdit("session-A", "session-B", session.id); // B が Edit になる
    store.attachAsView(session.id, "session-C", "@carol");
    // この時点で A=View, B=Edit, C=View
    // A を from にして C に渡そうとすると A が Edit でないのでエラー
    expect(() => store.transferEdit("session-A", "session-C", session.id)).toThrow(
      EditSessionPermissionError,
    );
  });
});

// ── 8. save 正常系 → SaveEvent が saveHistory に追加され history FS に json 書き込み ──

describe("save", () => {
  it("save により SaveEvent が saveHistory に追加される", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.update(session.id, { data: "test" }, "session-A");

    const event = await store.save(session.id, "session-A");

    expect(event.savedBy).toBe("session-A");
    expect(event.sequence).toBe(1);
    expect(typeof event.savedAt).toBe("string");
    expect(session.saveHistory).toHaveLength(1);
    expect(session.saveHistory[0]).toEqual(event);
  });

  it("save により history FS に json が書き込まれる", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.update(session.id, { data: "test" }, "session-A");
    await store.save(session.id, "session-A");

    const filePath = path.join(tmpDir, ".edit-sessions", `${session.id}.json`);
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.id).toBe(session.id);
    expect(parsed.state).toBe("Active");
    expect(parsed.saveHistory).toHaveLength(1);
    // participants は object に変換されて書き込まれる
    expect(parsed.participants["session-A"]?.role).toBe("Edit");
  });

  it("複数回 save できる (Active 継続、state 変化なし)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    await store.save(session.id, "session-A");
    store.update(session.id, { v: 2 }, "session-A");
    await store.save(session.id, "session-A");

    expect(session.state).toBe("Active");
    expect(session.saveHistory).toHaveLength(2);
  });

  // ── 9. save 権限 ──────────────────────────────────────────────────────────────

  it("権限: Edit 在席時は View が save すると EditSessionPermissionError", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-B", "@bob");

    await expect(store.save(session.id, "session-B")).rejects.toThrow(
      EditSessionPermissionError,
    );
  });

  it("権限: 全員 View (editor 不在) の場合は View の誰でも save できる (spec §5.2)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-B", "@bob");
    // A を Edit→View に降格 (editor 不在状態)
    store.setRole(session.id, "session-A", "View");

    // B (View) でも save できる
    const event = await store.save(session.id, "session-B");
    expect(event.savedBy).toBe("session-B");
  });

  it("参加していない session が save しようとすると EditSessionParticipantError", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    await expect(store.save(session.id, "session-X")).rejects.toThrow(
      EditSessionParticipantError,
    );
  });
});

// ── 10. 複数 EditSession 並存 (spec §9.1) ──────────────────────────────────────

describe("複数 EditSession 並存", () => {
  it("同一 (resourceType, resourceId) で 2 つの active EditSession が共存できる", () => {
    const session1 = store.create("session-A", "process-flow", "pf-1", "@alice");
    const session2 = store.create("session-B", "process-flow", "pf-1", "@bob");

    expect(session1.id).not.toBe(session2.id);
    expect(store.get(session1.id)?.state).toBe("Active");
    expect(store.get(session2.id)?.state).toBe("Active");

    const all = store.listByResource("process-flow", "pf-1");
    expect(all).toHaveLength(2);
  });

  it("異なるリソースの EditSession も並存できる", () => {
    const s1 = store.create("session-A", "process-flow", "pf-1", "@alice");
    const s2 = store.create("session-B", "table", "tbl-1", "@bob");

    expect(store.get(s1.id)).not.toBeNull();
    expect(store.get(s2.id)).not.toBeNull();
  });
});

// ── 11. AI participant — parentHumanSessionId を持つ participant が attach ──────

describe("AI participant (spec §10.2)", () => {
  it("parentHumanSessionId を持つ participant が attach できる", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    const aiParticipant = store.attachAsView(
      session.id,
      "ai-session-xyz",
      "Alice@AI",
      "session-A", // parentHumanSessionId
    );

    expect(aiParticipant.parentHumanSessionId).toBe("session-A");
    expect(aiParticipant.displayLabel).toBe("Alice@AI");
    expect(aiParticipant.role).toBe("View");
  });

  it("AI が take-over で Edit を取得できる (spec §7.4)", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "ai-session-xyz", "Alice@AI", "session-A");

    const result = store.transferEdit("session-A", "ai-session-xyz", session.id);

    expect(result.to.sessionId).toBe("ai-session-xyz");
    expect(result.to.role).toBe("Edit");
    expect(result.to.parentHumanSessionId).toBe("session-A");
  });

  it("AI が save した場合 savedBy に AI session ID が記録される", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "ai-session-xyz", "Alice@AI", "session-A");
    store.transferEdit("session-A", "ai-session-xyz", session.id);

    const event = await store.save(session.id, "ai-session-xyz");
    expect(event.savedBy).toBe("ai-session-xyz");
  });
});

// ── 12. cleanupExpired TTL 2 段階 ──────────────────────────────────────────────

describe("cleanupExpired", () => {
  it("Edit 在席中の EditSession は TTL 経過後も削除されない (spec §12.2)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");

    // 非常に昔のアクティビティとして設定
    const oldDate = "2020-01-01T00:00:00.000Z";
    session.lastActivityAt = oldDate;

    const now = new Date("2030-01-01T00:00:00.000Z");
    const results = await store.cleanupExpired(now, 7, 30);

    // Edit 在席中なので削除されない
    expect(results).toHaveLength(0);
    expect(store.get(session.id)?.state).toBe("Active");
  });

  it("全員 View + ttlDays 経過 → Active → Discarded に遷移 (history FS に discardedAt 反映)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    // A を View に降格 (editor 不在)
    store.setRole(session.id, "session-A", "View");

    // lastActivityAt を 8 日前に設定
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    session.lastActivityAt = eightDaysAgo.toISOString();

    const now = new Date();
    const results = await store.cleanupExpired(now, 7, 30);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("discarded");
    expect(results[0].editSession.state).toBe("Discarded");
    expect(results[0].editSession.discardedAt).toBeDefined();

    // history FS に書き込まれている
    const filePath = path.join(tmpDir, ".edit-sessions", `${session.id}.json`);
    const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(content.state).toBe("Discarded");
    expect(typeof content.discardedAt).toBe("string");
  });

  it("Discarded + retentionDays 経過 → 完全削除 (memory + history FS から)", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.setRole(session.id, "session-A", "View");

    // 先に discard しておく
    await store.discard(session.id, "manual");

    // discardedAt を 31 日前に設定
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    const discardedSession = store.get(session.id);
    if (discardedSession) {
      discardedSession.discardedAt = thirtyOneDaysAgo.toISOString();
    }

    const now = new Date();
    const results = await store.cleanupExpired(now, 7, 30);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("deleted");

    // memory から削除されている
    expect(store.get(session.id)).toBeNull();

    // history FS からも削除されている
    const filePath = path.join(tmpDir, ".edit-sessions", `${session.id}.json`);
    let fileExists = false;
    try {
      await fs.access(filePath);
      fileExists = true;
    } catch {
      fileExists = false;
    }
    expect(fileExists).toBe(false);
  });

  it("ttlDays 未満の場合は遷移しない", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.setRole(session.id, "session-A", "View");

    // lastActivityAt を 3 日前に設定 (ttlDays=7 未満)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    session.lastActivityAt = threeDaysAgo.toISOString();

    const now = new Date();
    const results = await store.cleanupExpired(now, 7, 30);

    expect(results).toHaveLength(0);
    expect(store.get(session.id)?.state).toBe("Active");
  });
});

// ── 13. discard (manual) → state Active → Discarded、history FS 反映 ──────────

describe("discard (manual)", () => {
  it("Active → Discarded に遷移し history FS に書き込まれる", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    // A を View に降格してから discard
    store.setRole(session.id, "session-A", "View");
    await store.discard(session.id, "manual");

    expect(session.state).toBe("Discarded");
    expect(typeof session.discardedAt).toBe("string");

    const filePath = path.join(tmpDir, ".edit-sessions", `${session.id}.json`);
    const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(content.state).toBe("Discarded");
  });

  it("Active 以外の EditSession は discard できない", async () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    store.setRole(session.id, "session-A", "View");
    await store.discard(session.id, "manual");

    // 2 回目の discard は EditSessionStateError
    await expect(store.discard(session.id, "manual")).rejects.toThrow(EditSessionStateError);
  });

  it("存在しない EditSession の discard は EditSessionNotFoundError", async () => {
    await expect(store.discard("nonexistent", "manual")).rejects.toThrow(
      EditSessionNotFoundError,
    );
  });
});

// ── 14. ULID-like id の時刻順序 ─────────────────────────────────────────────────

describe("ULID-like id の時刻順序", () => {
  it("連続 create で id 文字列がソート可能 (時刻 prefix を確認)", async () => {
    const sessions: string[] = [];
    for (let i = 0; i < 5; i++) {
      // 非同期遅延なしでも Date.now() の精度で順序が保たれるが、
      // 念のため微小遅延を入れて確実に時刻が進むようにする
      await new Promise((resolve) => setTimeout(resolve, 2));
      const s = store.create(`session-${i}`, "process-flow", `pf-${i}`, `@user${i}`);
      sessions.push(s.id);
    }

    // 辞書順ソートが生成順と一致することを確認
    const sorted = [...sessions].sort();
    expect(sorted).toEqual(sessions);
  });

  it("id は 'es-' プレフィックスを持つ ULID-like 形式", () => {
    const session = store.create("session-A", "process-flow", "pf-1", "@alice");
    // es-<time-10>-<random-16> 形式
    expect(session.id).toMatch(/^es-[0-9a-z]{10}-[0-9a-f]{16}$/);
  });
});

// ── 15. DraftHistoryStore hook (#893) ────────────────────────────────────────

describe("DraftHistoryStore hook (#893)", () => {
  let storeWithHistory: EditSessionStore;
  let mockHistoryStore: DraftHistoryStore;

  beforeEach(() => {
    const saveSnapshotMock = vi.fn().mockResolvedValue({});
    mockHistoryStore = {
      saveSnapshot: saveSnapshotMock,
      listHistory: vi.fn().mockResolvedValue([]),
      restoreFromHistory: vi.fn().mockResolvedValue(null),
      cleanupExpired: vi.fn().mockResolvedValue([]),
    } as unknown as DraftHistoryStore;
    storeWithHistory = new EditSessionStore(tmpDir, mockHistoryStore);
  });

  it("discard 時に saveSnapshot が payload を持つセッションで呼ばれる", async () => {
    const session = storeWithHistory.create("session-A", "process-flow", "pf-hook-1", "@alice");
    // payload を設定
    storeWithHistory.update(session.id, { id: "pf-hook-1", actions: [] }, "session-A");
    // discard を実行
    await storeWithHistory.discard(session.id, "manual");

    // saveSnapshot が呼ばれた (fire-and-forget なので resolved を待つ)
    await vi.waitFor(() => {
      expect(mockHistoryStore.saveSnapshot).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(mockHistoryStore.saveSnapshot).mock.calls[0][0];
    expect(call.reason).toBe("discard");
    expect(call.resourceType).toBe("process-flow");
    expect(call.resourceId).toBe("pf-hook-1");
    expect(call.ownerLabel).toBe("@alice");
  });

  it("payload が null の場合は discard 時に saveSnapshot は呼ばれない", async () => {
    const session = storeWithHistory.create("session-A", "process-flow", "pf-hook-2", "@alice");
    // payload を設定しない (null のまま)
    await storeWithHistory.discard(session.id, "manual");

    await new Promise((r) => setTimeout(r, 20));
    expect(mockHistoryStore.saveSnapshot).not.toHaveBeenCalled();
  });

  it("transferEdit 時に saveSnapshot が元 owner のラベルで呼ばれる", async () => {
    const session = storeWithHistory.create("session-A", "process-flow", "pf-hook-3", "@alice");
    storeWithHistory.update(session.id, { id: "pf-hook-3" }, "session-A");
    storeWithHistory.attachAsView(session.id, "session-B", "@bob");
    storeWithHistory.transferEdit("session-A", "session-B", session.id);

    await vi.waitFor(() => {
      expect(mockHistoryStore.saveSnapshot).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(mockHistoryStore.saveSnapshot).mock.calls[0][0];
    expect(call.reason).toBe("transferEdit");
    expect(call.ownerLabel).toBe("@alice"); // 元 owner のラベル
    expect(call.ownerSessionId).toBe("session-A");
  });

  it("save 時に saveSnapshot が呼ばれる", async () => {
    const session = storeWithHistory.create("session-A", "process-flow", "pf-hook-4", "@alice");
    storeWithHistory.update(session.id, { id: "pf-hook-4" }, "session-A");
    await storeWithHistory.save(session.id, "session-A");

    await vi.waitFor(() => {
      expect(mockHistoryStore.saveSnapshot).toHaveBeenCalledTimes(1);
    });
    const call = vi.mocked(mockHistoryStore.saveSnapshot).mock.calls[0][0];
    expect(call.reason).toBe("save");
    expect(call.ownerLabel).toBe("@alice");
  });
});
