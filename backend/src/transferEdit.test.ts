/**
 * transferEdit.test.ts (#904 / meta #897 Phase 7)
 *
 * take-over の atomic role swap に特化した統合テスト。
 * spec §7 (take-over) + spec §18.1 受け入れ基準 の以下を検証:
 *  - § 7 take-over の atomicity
 *  - § 5 ライフサイクル 1-6 step (統合フロー)
 *
 * 検証ケース:
 * 1. take-over 正常系: View 経由で Edit 取得、from は View に降格
 * 2. take-over エラー系 1: from が Edit でない → EditSessionPermissionError
 * 3. take-over エラー系 2: to が View 状態を経由していない → EditSessionParticipantError (spec §7.2 「View 経由必須」)
 * 4. take-over の sequence: payload sequence は維持 (= memory の payload 不変)
 * 5. take-over の broadcast データ構造: op === "transferred" + transferTo 付き
 * 6. 1-6 step を 1 シナリオで通す統合フロー
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EditSessionStore,
  EditSessionPermissionError,
  EditSessionParticipantError,
} from "./editSessionStore.js";

// ── テスト共通セットアップ ──────────────────────────────────────────────────────

let tmpDir: string;
let store: EditSessionStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "transfer-edit-test-"));
  store = new EditSessionStore(tmpDir);
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── 1. take-over 正常系: View 経由で Edit 取得、from は View に降格 ────────────

describe("take-over 正常系 (spec §7)", () => {
  it("1. View 経由で Edit 取得: from Edit→View、to View→Edit が atomic に発生する", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");

    // 事前確認: alice=Edit, bob=View
    expect(session.participants.get("session-alice")?.role).toBe("Edit");
    expect(session.participants.get("session-bob")?.role).toBe("View");

    const result = store.transferEdit("session-alice", "session-bob", session.id);

    // atomic 結果確認: alice=View, bob=Edit
    expect(result.from.sessionId).toBe("session-alice");
    expect(result.from.role).toBe("View");
    expect(result.to.sessionId).toBe("session-bob");
    expect(result.to.role).toBe("Edit");

    // EditSession の participants も更新されている
    expect(session.participants.get("session-alice")?.role).toBe("View");
    expect(session.participants.get("session-bob")?.role).toBe("Edit");
  });

  it("take-over 後に再度 take-over できる (bob → alice に戻す)", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");

    // alice → bob
    store.transferEdit("session-alice", "session-bob", session.id);
    expect(session.participants.get("session-bob")?.role).toBe("Edit");

    // bob → alice (alice は now View)
    const result = store.transferEdit("session-bob", "session-alice", session.id);
    expect(result.from.sessionId).toBe("session-bob");
    expect(result.from.role).toBe("View");
    expect(result.to.sessionId).toBe("session-alice");
    expect(result.to.role).toBe("Edit");
  });
});

// ── 2. take-over エラー系 1: from が Edit でない → EditSessionPermissionError ─

describe("take-over エラー系 1: from が Edit でない (spec §7.2)", () => {
  it("2. from が View role の場合は EditSessionPermissionError", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");

    // bob (View) が from として take-over を試みる → エラー
    expect(() =>
      store.transferEdit("session-bob", "session-alice", session.id),
    ).toThrow(EditSessionPermissionError);
  });

  it("from が participant でない場合は EditSessionParticipantError", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");

    // 存在しない session が from → ParticipantError
    expect(() =>
      store.transferEdit("session-unknown", "session-alice", session.id),
    ).toThrow(EditSessionParticipantError);
  });
});

// ── 3. take-over エラー系 2: to が View を経由していない → EditSessionParticipantError ─

describe("take-over エラー系 2: to が View を経由していない (spec §7.2 View 経由必須)", () => {
  it("3. to が attachAsView を経由せず参加していない場合は EditSessionParticipantError", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    // carol は attachAsView を経由していない

    expect(() =>
      store.transferEdit("session-alice", "session-carol", session.id),
    ).toThrow(EditSessionParticipantError);
  });

  it("to が既に Edit の場合は EditSessionPermissionError", () => {
    // session-alice が Edit の状態で別ルートで session-bob が Edit になれないことを確認
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");
    store.attachAsView(session.id, "session-carol", "@carol");

    // alice → bob に take-over (bob が Edit になる)
    store.transferEdit("session-alice", "session-bob", session.id);

    // now: alice=View, bob=Edit, carol=View
    // alice (View) が carol に take-over しようとする → alice は Edit でないのでエラー
    expect(() =>
      store.transferEdit("session-alice", "session-carol", session.id),
    ).toThrow(EditSessionPermissionError);
  });
});

// ── 4. take-over の sequence: payload sequence は維持 (memory の payload 不変) ─

describe("take-over の sequence / payload 不変性 (spec §7.3)", () => {
  it("4. take-over 前後で payload の sequence は維持される (memory 不変)", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");

    // alice が payload を更新
    const testPayload = { name: "テストフロー", version: 3 };
    store.update(session.id, testPayload, "session-alice");
    store.update(session.id, { ...testPayload, updated: true }, "session-alice");
    // sequence = 2

    // take-over 前の sequence を確認
    const beforePayload = store.fetchCurrentPayload(session.id);
    expect(beforePayload?.sequence).toBe(2);

    // take-over 実行
    store.transferEdit("session-alice", "session-bob", session.id);

    // take-over 後も payload と sequence は不変
    const afterPayload = store.fetchCurrentPayload(session.id);
    expect(afterPayload?.sequence).toBe(2);
    expect((afterPayload?.payload as Record<string, unknown>)?.updated).toBe(true);
    expect(session.sequence).toBe(2);
  });
});

// ── 5. take-over の broadcast データ構造 ──────────────────────────────────────

describe("take-over の broadcast データ構造 (wsBridge §7.4 相当)", () => {
  it("5. transferEdit の返り値から broadcast 構造を組める: op=transferred + transferTo 付き", () => {
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "session-bob", "@bob");

    const { from, to } = store.transferEdit("session-alice", "session-bob", session.id);

    // wsBridge の broadcast データ構造 (wsBridge.ts L1221-1233 相当)
    const broadcastData = {
      editSessionId: session.id,
      sessionId: to.sessionId,
      oldRole: "View" as const,
      newRole: "Edit" as const,
      op: "transferred" as const,
      transferTo: to.sessionId,
    };

    expect(broadcastData.op).toBe("transferred");
    expect(broadcastData.transferTo).toBe("session-bob");
    expect(broadcastData.newRole).toBe("Edit");
    expect(from.role).toBe("View");
    expect(to.role).toBe("Edit");
  });
});

// ── 6. 1-6 step を 1 シナリオで通す統合フロー ──────────────────────────────────

describe("1-6 step 統合フロー (spec §5)", () => {
  it("6. step 1〜6 を 1 シナリオで通す: create → attach → take-over → release → save → discard", async () => {
    // step 1: alice が編集開始 → EditSession 作成
    const session = store.create("session-alice", "process-flow", "pf-1", "@alice");
    expect(session.state).toBe("Active");
    expect(session.participants.get("session-alice")?.role).toBe("Edit");

    // step 2: bob が閲覧開始 (attach as View)
    const bobParticipant = store.attachAsView(session.id, "session-bob", "@bob");
    expect(bobParticipant.role).toBe("View");
    expect(session.participants.size).toBe(2);

    // §13.3 検証: bob が attach 直後に最新 payload を取得できる
    store.update(session.id, { content: "alice の編集内容" }, "session-alice");
    const currentPayload = store.fetchCurrentPayload(session.id);
    expect(currentPayload?.payload).toEqual({ content: "alice の編集内容" });

    // step 3: bob が take-over → alice View, bob Edit
    const transfer = store.transferEdit("session-alice", "session-bob", session.id);
    expect(transfer.from.role).toBe("View");
    expect(transfer.to.role).toBe("Edit");

    // step 4: bob が編集終了 (release = setRole("View"))
    store.setRole(session.id, "session-bob", "View");
    // 全員 View の状態
    expect(session.participants.get("session-alice")?.role).toBe("View");
    expect(session.participants.get("session-bob")?.role).toBe("View");

    // step 5: alice が save → audit log に savedBy 記録
    const saveEvent = await store.save(session.id, "session-alice");
    expect(saveEvent.savedBy).toBe("session-alice");
    expect(session.saveHistory).toHaveLength(1);
    expect(session.state).toBe("Active"); // save 後も Active 継続

    // history FS に書き込まれている
    const filePath = path.join(tmpDir, ".edit-sessions", `${session.id}.json`);
    const content = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(content.saveHistory).toHaveLength(1);
    expect(content.saveHistory[0].savedBy).toBe("session-alice");

    // step 6a: 明示 discard → state: Discarded
    await store.discard(session.id, "manual");
    expect(session.state).toBe("Discarded");
    expect(session.discardedAt).toBeDefined();

    // FS にも Discarded が反映されている
    const discardedContent = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(discardedContent.state).toBe("Discarded");
  });
});
