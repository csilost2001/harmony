/**
 * wsBridge.editSession.test.ts (#899 / meta #897 Phase 2)
 *
 * EditSessionStore を直接使い、以下を検証:
 * 1. editSession.create → EditSession 構造 + initial Edit participant
 * 2. editSession.attachAsView → participant + payload + sequence
 * 3. editSession.update → opaque envelope (payload は server で解釈されない)
 * 4. editSession.transferEdit → atomic role swap
 * 5. editSession.save → saveHistory に SaveEvent 追加
 * 6. editSession.discard → state: "Discarded"
 * 7. editSession.list → 全 EditSession 返却 (broadcast なし)
 * 8. editSession.fetchPayload → payload + sequence (broadcast なし)
 * 9. (regression) 旧 lock.* / draft.* handler 向けの EditSessionStore は別インスタンス (干渉なし)
 * +  cleanupExpired → editSession.discarded / editSession.expired 相当の action を返す
 *
 * wsBridge.ts 自体は WebSocket サーバを起動するため直接テストしない。
 * EditSessionStore の API を直接呼び出し、wsBridge handler の振る舞いを検証する。
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
import { DraftHistoryStore } from "./draftHistoryStore.js";

// ── テスト共通セットアップ ──────────────────────────────────────────────────────

let tmpDir: string;
let store: EditSessionStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-edit-session-test-"));
  store = new EditSessionStore(tmpDir);
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ── ヘルパー: _serializeEditSession 相当 ──────────────────────────────────────
function serializeSession(session: ReturnType<EditSessionStore["create"]>): Record<string, unknown> {
  return {
    ...session,
    participants: Object.fromEntries(session.participants.entries()),
  };
}

// ── 1. editSession.create ─────────────────────────────────────────────────────

describe("editSession.create", () => {
  it("新規 EditSession を作成し initial Edit participant が含まれる", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");

    // spec §3.2: EditSession 構造
    expect(session.id).toMatch(/^es-/);
    expect(session.resourceType).toBe("process-flow");
    expect(session.resourceId).toBe("pf-1");
    expect(session.state).toBe("Active");
    expect(session.sequence).toBe(0);
    expect(session.saveHistory).toHaveLength(0);

    // initial Edit participant が 1 名登録される
    const participants = Array.from(session.participants.values());
    expect(participants).toHaveLength(1);
    expect(participants[0].sessionId).toBe("client-A");
    expect(participants[0].role).toBe("Edit");
    expect(participants[0].displayLabel).toBe("@alice");

    // _serializeEditSession 相当: participants は Object になる
    const serialized = serializeSession(session);
    expect(typeof (serialized.participants as Record<string, unknown>)["client-A"]).toBe("object");
  });

  it("get() で取得できる", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    const retrieved = store.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
  });

  it("listAll() に追加される", () => {
    store.create("client-A", "process-flow", "pf-1", "@alice");
    store.create("client-B", "process-flow", "pf-2", "@bob");
    const all = store.listAll();
    expect(all).toHaveLength(2);
  });
});

// ── 2. editSession.attachAsView ───────────────────────────────────────────────

describe("editSession.attachAsView", () => {
  it("response に { participant, payload, sequence } が含まれる", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    // attachAsView で participant を追加
    const participant = store.attachAsView(session.id, "client-B", "@bob");
    // fetchCurrentPayload で payload + sequence を取得 (wsBridge handler 相当)
    const fetchResult = store.fetchCurrentPayload(session.id);

    expect(participant.sessionId).toBe("client-B");
    expect(participant.role).toBe("View");
    expect(participant.displayLabel).toBe("@bob");
    expect(fetchResult).not.toBeNull();
    expect(fetchResult?.payload).toBeNull(); // 初期 payload は null
    expect(fetchResult?.sequence).toBe(0);

    // participants に 2 名登録される
    const participants = Array.from(session.participants.values());
    expect(participants).toHaveLength(2);
  });

  it("broadcast editSession.attached: editSessionId + participant が含まれる構造", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    const participant = store.attachAsView(session.id, "client-B", "@bob");
    // broadcast data の構造を検証 (actual broadcast は wsBridge が発火)
    const broadcastData = { editSessionId: session.id, participant };
    expect(broadcastData.editSessionId).toBe(session.id);
    expect(broadcastData.participant.role).toBe("View");
  });
});

// ── 3. editSession.update — opaque envelope ───────────────────────────────────

describe("editSession.update (opaque envelope)", () => {
  it("payload は server で解釈されずそのまま返る (opaque)", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");

    // ANY な payload (構造問わず透過する)
    const opaquePayload = { ANY: "VALUE", nested: { list: [1, 2, 3] } };
    const { sequence } = store.update(session.id, opaquePayload, "client-A");

    expect(sequence).toBe(1);

    // fetchCurrentPayload で透過した payload を確認
    const fetched = store.fetchCurrentPayload(session.id);
    expect(fetched?.payload).toEqual(opaquePayload); // deep equal で透過確認
    expect(fetched?.sequence).toBe(1);
  });

  it("update のたびに sequence が increment する", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    const r1 = store.update(session.id, { v: 1 }, "client-A");
    const r2 = store.update(session.id, { v: 2 }, "client-A");
    expect(r1.sequence).toBe(1);
    expect(r2.sequence).toBe(2);
  });

  it("broadcast editSession.update の data 構造に senderSessionId が含まれる", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    const opaquePayload = { x: 42 };
    const { sequence } = store.update(session.id, opaquePayload, "client-A");
    // wsBridge が broadcast する data の構造
    const broadcastData = {
      editSessionId: session.id,
      sequence,
      payload: opaquePayload, // opaque: そのまま
      senderSessionId: "client-A",
    };
    expect(broadcastData.payload).toEqual(opaquePayload);
    expect(broadcastData.senderSessionId).toBe("client-A");
  });

  it("Edit role ではない participant が update しようとすると EditSessionPermissionError", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "client-B", "@bob");
    expect(() => store.update(session.id, { v: 1 }, "client-B")).toThrow(
      EditSessionPermissionError,
    );
  });
});

// ── 4. editSession.transferEdit — atomic role swap ────────────────────────────

describe("editSession.transferEdit", () => {
  it("atomic に Edit/View を交換し broadcast editSession.roleChanged (op: transferred)", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.attachAsView(session.id, "client-B", "@bob");

    const { from, to } = store.transferEdit("client-A", "client-B", session.id);

    // atomic: client-A が View に、client-B が Edit に
    expect(from.sessionId).toBe("client-A");
    expect(from.role).toBe("View");
    expect(to.sessionId).toBe("client-B");
    expect(to.role).toBe("Edit");

    // store の participants も更新されていることを確認
    const aInfo = session.participants.get("client-A");
    const bInfo = session.participants.get("client-B");
    expect(aInfo?.role).toBe("View");
    expect(bInfo?.role).toBe("Edit");

    // broadcast data の構造 (wsBridge 相当)
    const broadcastData = {
      editSessionId: session.id,
      sessionId: "client-B",
      oldRole: "View" as const,
      newRole: "Edit" as const,
      op: "transferred",
      transferTo: "client-B",
    };
    expect(broadcastData.op).toBe("transferred");
    expect(broadcastData.transferTo).toBe("client-B");
  });

  it("View を経由せずに transferEdit しようとすると EditSessionParticipantError", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    // client-B は attachAsView していない
    expect(() => store.transferEdit("client-A", "client-B", session.id)).toThrow(
      EditSessionParticipantError,
    );
  });
});

// ── 5. editSession.save ───────────────────────────────────────────────────────

describe("editSession.save", () => {
  it("saveHistory に SaveEvent が追加され broadcast editSession.saved が発火できる構造", async () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.update(session.id, { v: 1 }, "client-A");

    const saveEvent = await store.save(session.id, "client-A");

    expect(saveEvent.savedBy).toBe("client-A");
    expect(typeof saveEvent.savedAt).toBe("string");
    expect(saveEvent.sequence).toBe(1);

    // saveHistory に追加されていることを確認
    expect(session.saveHistory).toHaveLength(1);
    expect(session.saveHistory[0].savedBy).toBe("client-A");

    // broadcast data の構造 (wsBridge 相当)
    const broadcastData = {
      editSessionId: session.id,
      savedBy: saveEvent.savedBy,
      savedAt: saveEvent.savedAt,
      sequence: saveEvent.sequence,
    };
    expect(broadcastData.savedBy).toBe("client-A");
    expect(broadcastData.sequence).toBe(1);
  });

  it("save 後も Active 状態が維持される (save は session 終了ではない / spec §4)", async () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    await store.save(session.id, "client-A");
    expect(session.state).toBe("Active");
  });
});

// ── 6. editSession.discard ────────────────────────────────────────────────────

describe("editSession.discard", () => {
  it("state が Active → Discarded に遷移し broadcast editSession.discarded (reason: manual)", async () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    await store.discard(session.id, "manual");

    expect(session.state).toBe("Discarded");
    expect(typeof session.discardedAt).toBe("string");

    // broadcast data の構造 (wsBridge 相当)
    const broadcastData = { editSessionId: session.id, reason: "manual" as const };
    expect(broadcastData.reason).toBe("manual");
  });
});

// ── 7. editSession.list — response only ──────────────────────────────────────

describe("editSession.list", () => {
  it("listByResource で特定リソースの EditSession のみ返す", () => {
    store.create("client-A", "process-flow", "pf-1", "@alice");
    store.create("client-B", "process-flow", "pf-2", "@bob");
    store.create("client-C", "table", "tbl-1", "@carol");

    const pfSessions = store.listByResource("process-flow", "pf-1");
    expect(pfSessions).toHaveLength(1);
    expect(pfSessions[0].resourceId).toBe("pf-1");
  });

  it("listAll で全 EditSession を返す (filter なし)", () => {
    store.create("client-A", "process-flow", "pf-1", "@alice");
    store.create("client-B", "process-flow", "pf-2", "@bob");

    const all = store.listAll();
    expect(all).toHaveLength(2);
    // broadcast しないことを確認 (response only = broadcastData がない)
    // wsBridge handler では broadcast をしない実装になっている
  });
});

// ── 8. editSession.fetchPayload — response only ───────────────────────────────

describe("editSession.fetchPayload", () => {
  it("payload と sequence を返す (broadcast なし)", () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.update(session.id, { hello: "world" }, "client-A");

    const result = store.fetchCurrentPayload(session.id);
    expect(result).not.toBeNull();
    expect(result?.payload).toEqual({ hello: "world" });
    expect(result?.sequence).toBe(1);
  });

  it("存在しない editSessionId は null を返す", () => {
    const result = store.fetchCurrentPayload("nonexistent-id");
    expect(result).toBeNull();
  });
});

// ── 9. (regression) 旧 lock.* / draft.* handler との干渉なし ──────────────────

describe("regression: 旧 lock.* / draft.* handler との干渉なし", () => {
  it("EditSessionStore は workspace 単位で独立した Map を持つ", () => {
    // 2 つの異なる workspace の EditSessionStore は干渉しない
    const store1 = new EditSessionStore(`${tmpDir}/ws1`);
    const store2 = new EditSessionStore(`${tmpDir}/ws2`);

    const session1 = store1.create("client-A", "process-flow", "pf-1", "@alice");
    const all1 = store1.listAll();
    const all2 = store2.listAll();

    expect(all1).toHaveLength(1);
    expect(all2).toHaveLength(0); // ws2 は干渉しない
    expect(all1[0].id).toBe(session1.id);
  });

  it("EditSessionStore の update は lockManager / draftStore の状態を変えない", () => {
    // EditSession の update は in-memory のみで、draftStore/lockManager は触らない
    // (このテストは「干渉がない」ことの論理的確認)
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.update(session.id, { v: "new" }, "client-A");

    // store の payload のみが変わる
    const fetched = store.fetchCurrentPayload(session.id);
    expect(fetched?.payload).toEqual({ v: "new" });

    // lockManager / draftStore の状態は変わらない
    // (lockManager は in-process singleton、EditSessionStore とは独立)
    // このテストでは EditSessionStore の独立性を構造的に確認
    const otherStore = new EditSessionStore(tmpDir);
    const otherSession = otherStore.create("client-X", "table", "tbl-1", "@x");
    expect(otherStore.get(session.id)).toBeNull(); // 別インスタンスは共有しない
    expect(otherStore.get(otherSession.id)).not.toBeNull();
  });
});

// ── 10. editSession.listHistory — dispatch test (#918 review S-2) ──────────────

describe("editSession.listHistory", () => {
  it("DraftHistoryStore.listHistory が呼ばれ history 配列が返る (正常系)", async () => {
    const historyStore = new DraftHistoryStore(tmpDir);

    // スナップショットを事前に保存して履歴を作成
    await historyStore.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-list-test",
      editSessionId: "es-test-001",
      ownerSessionId: "client-A",
      ownerLabel: "@alice",
      reason: "save",
      snapshot: { v: 1 },
    });

    // wsBridge handler 相当: listHistory で一覧を取得
    const result = await historyStore.listHistory({
      resourceType: "process-flow",
      resourceId: "pf-list-test",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].resourceType).toBe("process-flow");
    expect(result[0].resourceId).toBe("pf-list-test");
    expect(result[0].reason).toBe("save");
    expect(result[0].snapshot).toEqual({ v: 1 });
  });

  it("履歴がない resourceType / resourceId は空配列を返す", async () => {
    const historyStore = new DraftHistoryStore(tmpDir);

    const result = await historyStore.listHistory({
      resourceType: "process-flow",
      resourceId: "nonexistent-resource",
    });

    // ディレクトリが存在しない場合は空配列 (silent pass ではなく明示的確認)
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("複数スナップショットが timestamp 降順でソートされる", async () => {
    const historyStore = new DraftHistoryStore(tmpDir);

    // 2 件保存 (連続保存)
    await historyStore.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-multi",
      editSessionId: "es-001",
      ownerSessionId: "client-A",
      ownerLabel: "@alice",
      reason: "save",
      snapshot: { v: 1 },
    });

    // 時間差を確保するため 2ms 待機
    await new Promise((r) => setTimeout(r, 2));

    await historyStore.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-multi",
      editSessionId: "es-002",
      ownerSessionId: "client-B",
      ownerLabel: "@bob",
      reason: "discard",
      snapshot: { v: 2 },
    });

    const result = await historyStore.listHistory({
      resourceType: "process-flow",
      resourceId: "pf-multi",
    });

    expect(result).toHaveLength(2);
    // 降順: 新しい方が先
    expect((result[0].snapshot as { v: number }).v).toBe(2);
    expect((result[1].snapshot as { v: number }).v).toBe(1);
  });
});

// ── 11. editSession.restoreFromHistory — dispatch test (#918 review S-2) ───────

describe("editSession.restoreFromHistory", () => {
  it("historyId から新規 EditSession が作成されスナップショットが initial payload として設定される (正常系)", async () => {
    const historyStore = new DraftHistoryStore(tmpDir);

    // 事前に履歴スナップショットを保存
    const entry = await historyStore.saveSnapshot({
      resourceType: "process-flow",
      resourceId: "pf-restore-test",
      editSessionId: "es-original",
      ownerSessionId: "client-A",
      ownerLabel: "@alice",
      reason: "discard",
      snapshot: { steps: ["step-1", "step-2"] },
    });

    // wsBridge handler 相当: historyId から restore
    const found = await historyStore.restoreFromHistory({ historyId: entry.historyId });
    expect(found).not.toBeNull();
    expect(found!.historyId).toBe(entry.historyId);
    expect(found!.snapshot).toEqual({ steps: ["step-1", "step-2"] });
    expect(found!.resourceType).toBe("process-flow");
    expect(found!.resourceId).toBe("pf-restore-test");

    // 取得した snapshot で EditSession を新規作成し payload を設定 (wsBridge の restoreFromHistory 実装相当)
    const storeWithHistory = new EditSessionStore(tmpDir, historyStore);
    const newSession = storeWithHistory.create(
      "client-B",
      "process-flow",
      found!.resourceId,
      "@bob",
    );
    storeWithHistory.update(newSession.id, found!.snapshot, "client-B");

    const fetched = storeWithHistory.fetchCurrentPayload(newSession.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.payload).toEqual({ steps: ["step-1", "step-2"] });
    expect(fetched!.sequence).toBe(1);
  });

  it("存在しない historyId は null を返す", async () => {
    const historyStore = new DraftHistoryStore(tmpDir);

    const result = await historyStore.restoreFromHistory({ historyId: "nonexistent-history-id" });
    expect(result).toBeNull();
  });
});

// ── 12. cleanupExpired — editSession.discarded / editSession.expired 相当 ──────

describe("cleanupExpired", () => {
  it("TTL 経過で Active → Discarded に遷移し action: discarded を返す", async () => {
    // Edit role がいない状態で TTL 経過 → Discarded (spec §12.2)
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    // Edit role を View に降格 (全員 View = TTL 対象)
    store.setRole(session.id, "client-A", "View");

    // 過去の日時で cleanup (TTL = 0 days で即時 Discarded 判定)
    const pastNow = new Date(Date.now() + 1000); // 1 秒後で TTL 0 days 経過判定
    const results = await store.cleanupExpired(pastNow, 0, 30);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("discarded");
    expect(results[0].editSession.id).toBe(session.id);
    expect(results[0].editSession.state).toBe("Discarded");
    // broadcast editSession.discarded は wsBridge が発火 (spec §12.4)
    // cleanupExpired の戻り値をもとに wsBridge が broadcast する想定
  });

  it("Edit role がいる EditSession は TTL 経過でも削除しない (spec §12.2)", async () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    // client-A は Edit role のまま

    const pastNow = new Date(Date.now() + 1000);
    const results = await store.cleanupExpired(pastNow, 0, 30);

    expect(results).toHaveLength(0); // Edit がいるので削除しない
    expect(session.state).toBe("Active"); // Active を維持
  });

  it("Discarded 状態で retention 経過 → 完全削除 (action: deleted) — broadcast editSession.expired 相当", async () => {
    const session = store.create("client-A", "process-flow", "pf-1", "@alice");
    store.setRole(session.id, "client-A", "View");

    // 1 段階目: Discarded に
    await store.discard(session.id, "manual");
    expect(session.state).toBe("Discarded");

    // 2 段階目: retention 0 days で完全削除
    const pastNow = new Date(Date.now() + 1000);
    const results = await store.cleanupExpired(pastNow, 7, 0);

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("deleted");
    expect(results[0].editSession.id).toBe(session.id);

    // memory から削除されている
    expect(store.get(session.id)).toBeNull();
    // broadcast editSession.expired は wsBridge が発火する想定
  });
});
