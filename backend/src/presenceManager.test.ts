import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerEditor,
  registerViewer,
  unregister,
  unregisterAllForSession,
  heartbeat,
  list,
  cleanupStale,
  classifyActivity,
  cleanupAbandoned,
  startCleanupInterval,
  stopCleanupInterval,
  _resetForTest,
  type PresenceEntry,
} from "./presenceManager.js";

beforeEach(() => {
  _resetForTest();
});

afterEach(() => {
  stopCleanupInterval();
});

// ── registerEditor ──────────────────────────────────────────────────────────

describe("registerEditor", () => {
  it("editor エントリを登録できる", () => {
    const entry = registerEditor("ws-1", "sess-A", "table", "tbl-1");
    expect(entry.sessionId).toBe("sess-A");
    expect(entry.resourceType).toBe("table");
    expect(entry.resourceId).toBe("tbl-1");
    expect(entry.role).toBe("editor");
    expect(typeof entry.lastActivityAt).toBe("string");
    expect(entry.lastEditAt).toBeNull();
    expect(entry.focusAt).not.toBeNull();
    expect(entry.ownerLabel).toBeNull();
  });

  it("ownerLabel を指定できる (AI 借受)", () => {
    const entry = registerEditor("ws-1", "sess-AI", "table", "tbl-1", "@ai (alice 代行)");
    expect(entry.ownerLabel).toBe("@ai (alice 代行)");
  });

  it("重複登録は既存エントリを update する (新規追加ではない)", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    const second = registerEditor("ws-1", "sess-A", "table", "tbl-1", "@ai");
    expect(second.role).toBe("editor");
    expect(second.ownerLabel).toBe("@ai");
    // list に 1 件のみ
    const entries = list("ws-1", "table", "tbl-1");
    expect(entries).toHaveLength(1);
  });

  it("viewer から editor に role を更新できる", () => {
    registerViewer("ws-1", "sess-A", "table", "tbl-1");
    const updated = registerEditor("ws-1", "sess-A", "table", "tbl-1");
    expect(updated.role).toBe("editor");
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(1);
  });
});

// ── registerViewer ──────────────────────────────────────────────────────────

describe("registerViewer", () => {
  it("viewer エントリを登録できる", () => {
    const entry = registerViewer("ws-1", "sess-B", "screen-item", "scr-1");
    expect(entry.role).toBe("viewer");
    expect(entry.sessionId).toBe("sess-B");
    expect(entry.resourceType).toBe("screen-item");
    expect(entry.resourceId).toBe("scr-1");
    expect(entry.ownerLabel).toBeNull();
  });

  it("重複登録は既存エントリを update する", () => {
    registerViewer("ws-1", "sess-B", "screen-item", "scr-1");
    registerViewer("ws-1", "sess-B", "screen-item", "scr-1");
    expect(list("ws-1", "screen-item", "scr-1")).toHaveLength(1);
  });
});

// ── unregister ──────────────────────────────────────────────────────────────

describe("unregister", () => {
  it("登録済みエントリを解除できる", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    unregister("ws-1", "sess-A", "table", "tbl-1");
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(0);
  });

  it("存在しないエントリの unregister はエラーにならない", () => {
    expect(() => unregister("ws-1", "sess-X", "table", "tbl-1")).not.toThrow();
  });

  it("unregister は同一 wsId + resource のみ削除する", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    registerEditor("ws-1", "sess-B", "table", "tbl-1");
    unregister("ws-1", "sess-A", "table", "tbl-1");
    const remaining = list("ws-1", "table", "tbl-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe("sess-B");
  });
});

// ── unregisterAllForSession (#980-A: WS 切断時 cleanup) ─────────────────────

describe("unregisterAllForSession", () => {
  it("指定 sessionId の全 (wsId, resource) エントリを削除する", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    registerViewer("ws-1", "sess-A", "process-flow", "pf-1");
    registerEditor("ws-2", "sess-A", "screen-item", "scr-1");
    // 別 session は影響を受けない
    registerEditor("ws-1", "sess-B", "table", "tbl-1");

    const removed = unregisterAllForSession("sess-A");

    expect(removed).toHaveLength(3);
    expect(removed).toEqual(expect.arrayContaining([
      { wsId: "ws-1", resourceType: "table", resourceId: "tbl-1" },
      { wsId: "ws-1", resourceType: "process-flow", resourceId: "pf-1" },
      { wsId: "ws-2", resourceType: "screen-item", resourceId: "scr-1" },
    ]));
    expect(list("ws-1", "table", "tbl-1")).toEqual([
      expect.objectContaining({ sessionId: "sess-B" }),
    ]);
    expect(list("ws-1", "process-flow", "pf-1")).toHaveLength(0);
    expect(list("ws-2", "screen-item", "scr-1")).toHaveLength(0);
  });

  it("該当 entry が無い session の削除は空配列を返す", () => {
    expect(unregisterAllForSession("sess-NONE")).toEqual([]);
  });
});

// ── heartbeat ───────────────────────────────────────────────────────────────

describe("heartbeat", () => {
  it("kind=activity で lastActivityAt を更新する", async () => {
    registerEditor("ws-1", "sess-A", "process-flow", "pf-1");
    const before = list("ws-1", "process-flow", "pf-1")[0].lastActivityAt;
    // 1ms 待機して時刻を確実にずらす
    await new Promise((r) => setTimeout(r, 2));
    const result = heartbeat("ws-1", "sess-A", "process-flow", "pf-1", "activity");
    expect(result.entry.lastActivityAt >= before).toBe(true);
    expect(result.entry.lastEditAt).toBeNull();
  });

  it("kind=edit で lastEditAt も更新する", async () => {
    registerEditor("ws-1", "sess-A", "process-flow", "pf-1");
    await new Promise((r) => setTimeout(r, 2));
    const result = heartbeat("ws-1", "sess-A", "process-flow", "pf-1", "edit");
    expect(result.entry.lastEditAt).not.toBeNull();
    expect(result.entry.lastActivityAt).toBe(result.entry.lastEditAt);
  });

  it("kind=edit は lastEditAt を now に設定し、kind=activity は lastEditAt を変更しない", async () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    const editResult = heartbeat("ws-1", "sess-A", "table", "tbl-1", "edit");
    const editAt = editResult.entry.lastEditAt;
    expect(editAt).not.toBeNull();
    await new Promise((r) => setTimeout(r, 2));
    const actResult = heartbeat("ws-1", "sess-A", "table", "tbl-1", "activity");
    // activity は lastEditAt を変えない
    expect(actResult.entry.lastEditAt).toBe(editAt);
    // lastActivityAt は更新される
    expect(actResult.entry.lastActivityAt > actResult.entry.lastEditAt!).toBe(true);
  });

  it("未登録セッションの heartbeat は auto-register (viewer として)", () => {
    const result = heartbeat("ws-1", "sess-new", "screen-item", "scr-1", "activity");
    expect(result.entry.role).toBe("viewer");
    expect(list("ws-1", "screen-item", "scr-1")).toHaveLength(1);
  });

  it("changed フラグが返される", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    const result = heartbeat("ws-1", "sess-A", "table", "tbl-1", "activity");
    expect(typeof result.changed).toBe("boolean");
  });
});

// ── list ────────────────────────────────────────────────────────────────────

describe("list", () => {
  it("wsId + resource scope でフィルタする", () => {
    // ws-1 に 2 件 (tbl-1 / tbl-2)
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    registerViewer("ws-1", "sess-B", "table", "tbl-2");
    // ws-2 に 1 件
    registerEditor("ws-2", "sess-C", "table", "tbl-1");

    const result = list("ws-1", "table", "tbl-1");
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("sess-A");
  });

  it("エントリが無い場合は空配列を返す", () => {
    expect(list("ws-999", "table", "tbl-none")).toEqual([]);
  });

  it("複数 session が同一リソースを参照している場合は全件返す", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    registerViewer("ws-1", "sess-B", "table", "tbl-1");
    registerViewer("ws-1", "sess-C", "table", "tbl-1");
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(3);
  });

  it("resourceType の違いは独立してフィルタされる", () => {
    registerEditor("ws-1", "sess-A", "table", "res-1");
    registerViewer("ws-1", "sess-B", "screen-item", "res-1");
    expect(list("ws-1", "table", "res-1")).toHaveLength(1);
    expect(list("ws-1", "screen-item", "res-1")).toHaveLength(1);
  });
});

// ── heartbeat (Phase 7: levelChanged) ───────────────────────────────────────

describe("heartbeat (Phase 7 levelChanged)", () => {
  it("level が変わる場合 levelChanged=true を返す", async () => {
    // editor を登録して lastEditAt を古くする → live → active に遷移させる
    const entry = registerEditor("ws-1", "sess-A", "table", "tbl-1");
    // 70秒前に lastEditAt を設定 (live threshold = 60s を超える → live→active 遷移)
    entry.lastEditAt = new Date(Date.now() - 70 * 1000).toISOString();
    entry.lastActivityAt = new Date(Date.now() - 70 * 1000).toISOString();
    // focusAt は null にして WS 切断扱い (→ level が idle になる)
    entry.focusAt = null;

    // heartbeat で focusAt = now に更新 → activity level が変化するかもしれない
    const result = heartbeat("ws-1", "sess-A", "table", "tbl-1", "activity");
    expect(typeof result.levelChanged).toBe("boolean");
    expect(result.level).toBeDefined();
    expect(result.entry).toBeDefined();
    expect(result.changed).toBe(true);
  });

  it("level フィールドが返り値に含まれる", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    const result = heartbeat("ws-1", "sess-A", "table", "tbl-1", "edit");
    expect(["live", "active", "idle", "stale", "abandoned"]).toContain(result.level);
  });
});

// ── classifyActivity (Phase 7) ───────────────────────────────────────────────

describe("classifyActivity (backend, presenceConfig threshold)", () => {
  function makeEntry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
    const now = new Date().toISOString();
    return {
      sessionId: "sess-test",
      resourceType: "table",
      resourceId: "tbl-1",
      role: "editor",
      lastActivityAt: now,
      lastEditAt: now,
      focusAt: now,
      ownerLabel: null,
      ...overrides,
    };
  }

  function ago(seconds: number): string {
    return new Date(Date.now() - seconds * 1000).toISOString();
  }

  it("live: wsAlive かつ lastEditAt が liveThresholdSec 以内", () => {
    const entry = makeEntry({ lastEditAt: ago(10), focusAt: new Date().toISOString() });
    expect(classifyActivity(entry)).toBe("live");
  });

  it("active: wsAlive かつ actAge が activeThresholdSec 以内 (editAge は超過)", () => {
    const entry = makeEntry({
      lastActivityAt: ago(100),
      lastEditAt: ago(200),
      focusAt: new Date().toISOString(),
    });
    expect(classifyActivity(entry)).toBe("active");
  });

  it("idle: actAge が activeThresholdSec 超過かつ idleThresholdSec 以内", () => {
    const entry = makeEntry({
      lastActivityAt: ago(3600), // 1h
      lastEditAt: null,
      focusAt: null,
    });
    expect(classifyActivity(entry)).toBe("idle");
  });

  it("stale: actAge が idleThresholdSec 超過かつ wsAlive", () => {
    const entry = makeEntry({
      lastActivityAt: ago(90000), // > 86400s
      lastEditAt: null,
      focusAt: new Date().toISOString(), // wsAlive
    });
    expect(classifyActivity(entry)).toBe("stale");
  });

  it("abandoned: actAge が idleThresholdSec 超過かつ WS 切断", () => {
    const entry = makeEntry({
      lastActivityAt: ago(90000), // > 86400s
      lastEditAt: null,
      focusAt: null, // WS 切断
    });
    expect(classifyActivity(entry)).toBe("abandoned");
  });
});

// ── cleanupAbandoned (Phase 7) ───────────────────────────────────────────────

describe("cleanupAbandoned", () => {
  it("focusAt=null かつ idleThresholdSec 超過のエントリを削除する", async () => {
    const entry = registerEditor("ws-1", "sess-A", "table", "tbl-1");
    // WS 切断 + 古い lastActivityAt
    entry.focusAt = null;
    entry.lastActivityAt = new Date(Date.now() - 90000 * 1000).toISOString();

    const removed = cleanupAbandoned();
    expect(removed).toHaveLength(1);
    expect(removed[0].sessionId).toBe("sess-A");
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(0);
  });

  it("focusAt が null でも lastActivityAt が新しいエントリは残す", () => {
    const entry = registerEditor("ws-1", "sess-B", "table", "tbl-2");
    entry.focusAt = null;
    // lastActivityAt は新しい (現在時刻)
    entry.lastActivityAt = new Date().toISOString();

    const removed = cleanupAbandoned();
    expect(removed).toHaveLength(0);
    expect(list("ws-1", "table", "tbl-2")).toHaveLength(1);
  });

  it("focusAt が null でないエントリは削除しない (WS 接続中)", () => {
    const entry = registerEditor("ws-1", "sess-C", "table", "tbl-3");
    entry.focusAt = new Date().toISOString(); // WS alive
    entry.lastActivityAt = new Date(Date.now() - 90000 * 1000).toISOString();

    const removed = cleanupAbandoned();
    expect(removed).toHaveLength(0);
  });

  it("broadcastFn が削除後に呼ばれる", async () => {
    const entry = registerEditor("ws-1", "sess-D", "table", "tbl-4");
    entry.focusAt = null;
    entry.lastActivityAt = new Date(Date.now() - 90000 * 1000).toISOString();

    const broadcastCalls: Array<{ wsId: string; resourceType: string; resourceId: string }> = [];
    cleanupAbandoned((wsId, resourceType, resourceId) => {
      broadcastCalls.push({ wsId, resourceType, resourceId });
    });

    expect(broadcastCalls).toHaveLength(1);
    expect(broadcastCalls[0].wsId).toBe("ws-1");
    expect(broadcastCalls[0].resourceType).toBe("table");
    expect(broadcastCalls[0].resourceId).toBe("tbl-4");
  });

  it("broadcastFn が省略された場合もエラーにならない", () => {
    const entry = registerEditor("ws-1", "sess-E", "table", "tbl-5");
    entry.focusAt = null;
    entry.lastActivityAt = new Date(Date.now() - 90000 * 1000).toISOString();

    expect(() => cleanupAbandoned()).not.toThrow();
  });
});

// ── startCleanupInterval / stopCleanupInterval (Phase 7) ────────────────────

describe("startCleanupInterval / stopCleanupInterval", () => {
  it("startCleanupInterval を二度呼んでもタイマーが重複しない", () => {
    // 二度呼んでも throw しない、動作が壊れない
    startCleanupInterval(() => {}, 10000);
    expect(() => startCleanupInterval(() => {}, 10000)).not.toThrow();
    stopCleanupInterval();
  });

  it("stopCleanupInterval はタイマーが存在しなくてもエラーにならない", () => {
    expect(() => stopCleanupInterval()).not.toThrow();
  });
});

// ── list (Phase 7: PresenceEntryWithLevel) ───────────────────────────────────

describe("list (Phase 7)", () => {
  it("返り値の各エントリに level フィールドが付く", () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    const entries = list("ws-1", "table", "tbl-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBeDefined();
    expect(["live", "active", "idle", "stale", "abandoned"]).toContain(entries[0].level);
  });

  it("空の場合は空配列を返す", () => {
    expect(list("ws-none", "table", "tbl-none")).toEqual([]);
  });
});

// ── cleanupStale ─────────────────────────────────────────────────────────────

describe("cleanupStale", () => {
  it("threshold を超えた entry のみ削除する", async () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    registerViewer("ws-1", "sess-B", "table", "tbl-2");

    // 1000 秒 threshold → どちらも残る
    const removedLong = cleanupStale(1000);
    expect(removedLong).toHaveLength(0);
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(1);

    // 登録から少し時間を置いてから threshold=0 (負値) で全削除
    await new Promise((r) => setTimeout(r, 5));
    // threshold=-1 は cutoff = now + 1000ms → 全エントリが cutoff より古い
    const removedAll = cleanupStale(-1);
    expect(removedAll).toHaveLength(2);
    expect(list("ws-1", "table", "tbl-1")).toHaveLength(0);
    expect(list("ws-1", "table", "tbl-2")).toHaveLength(0);
  });

  it("削除された entry の配列を返す", async () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    await new Promise((r) => setTimeout(r, 5));
    // threshold=-1: cutoff = now + 1s → 全エントリが cutoff より古い
    const removed = cleanupStale(-1);
    expect(removed.length).toBeGreaterThan(0);
    expect(removed[0].sessionId).toBe("sess-A");
  });

  it("stale でないエントリは残す", async () => {
    registerEditor("ws-1", "sess-A", "table", "tbl-1");
    await new Promise((r) => setTimeout(r, 2));
    registerViewer("ws-1", "sess-B", "table", "tbl-2");
    // threshold 1 秒: どちらも 1 秒以内なので残る
    const removed = cleanupStale(1);
    expect(removed).toHaveLength(0);
  });
});
