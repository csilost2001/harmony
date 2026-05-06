import { describe, it, expect, beforeEach } from "vitest";
import {
  acquire,
  release,
  forceRelease,
  getLock,
  listLocks,
  _resetForTest,
  LockConflictError,
  LockNotHeldError,
} from "./lockManager.js";
import type { DraftResourceType } from "./draftStore.js";

beforeEach(() => {
  _resetForTest();
});

describe("acquire", () => {
  it("ロックを取得できる", () => {
    const entry = acquire("table", "tbl-1", "session-A");
    expect(entry.resourceType).toBe("table");
    expect(entry.resourceId).toBe("tbl-1");
    expect(entry.ownerSessionId).toBe("session-A");
    expect(entry.actorSessionId).toBe("session-A");
    expect(typeof entry.acquiredAt).toBe("string");
  });

  it("actorSessionId を明示すると owner != actor になる", () => {
    const entry = acquire("table", "tbl-1", "human-session", "ai-session");
    expect(entry.ownerSessionId).toBe("human-session");
    expect(entry.actorSessionId).toBe("ai-session");
  });

  it("同一キーへの 2 回目の acquire は LockConflictError", () => {
    acquire("table", "tbl-1", "session-A");
    expect(() => acquire("table", "tbl-1", "session-B")).toThrow(LockConflictError);
  });

  it("LockConflictError には既存 entry が付く", () => {
    const first = acquire("screen", "scr-1", "session-A");
    try {
      acquire("screen", "scr-1", "session-B");
    } catch (e) {
      expect(e).toBeInstanceOf(LockConflictError);
      expect((e as LockConflictError).entry).toEqual(first);
    }
  });

  it("異なるリソースは独立してロックできる", () => {
    acquire("table", "tbl-1", "session-A");
    const entry2 = acquire("table", "tbl-2", "session-A");
    expect(entry2.resourceId).toBe("tbl-2");
  });

  it("異なる resourceType は独立してロックできる", () => {
    acquire("table", "res-1", "session-A");
    const entry2 = acquire("screen", "res-1", "session-A");
    expect(entry2.resourceType).toBe("screen");
  });
});

describe("release", () => {
  it("owner が release できる", () => {
    acquire("table", "tbl-1", "session-A");
    const result = release("table", "tbl-1", "session-A");
    expect(result).toEqual({ released: true });
  });

  it("release 後は getLock が null を返す", () => {
    acquire("table", "tbl-1", "session-A");
    release("table", "tbl-1", "session-A");
    expect(getLock("table", "tbl-1")).toBeNull();
  });

  it("release 後に再 acquire できる", () => {
    acquire("table", "tbl-1", "session-A");
    release("table", "tbl-1", "session-A");
    const entry = acquire("table", "tbl-1", "session-B");
    expect(entry.ownerSessionId).toBe("session-B");
  });

  it("非 owner の release は LockNotHeldError", () => {
    acquire("table", "tbl-1", "session-A");
    expect(() => release("table", "tbl-1", "session-B")).toThrow(LockNotHeldError);
  });

  it("ロックが存在しない場合も LockNotHeldError", () => {
    expect(() => release("table", "tbl-1", "session-A")).toThrow(LockNotHeldError);
  });
});

describe("forceRelease", () => {
  it("任意の session が強制解除できる", () => {
    acquire("table", "tbl-1", "session-A");
    const result = forceRelease("table", "tbl-1", "session-X");
    expect(result.released).toBe(true);
    expect(result.previousOwner).toBe("session-A");
  });

  it("forceRelease 後は getLock が null を返す", () => {
    acquire("table", "tbl-1", "session-A");
    forceRelease("table", "tbl-1", "session-X");
    expect(getLock("table", "tbl-1")).toBeNull();
  });

  it("forceRelease 後に新 acquire できる", () => {
    acquire("table", "tbl-1", "session-A");
    forceRelease("table", "tbl-1", "session-X");
    const entry = acquire("table", "tbl-1", "session-B");
    expect(entry.ownerSessionId).toBe("session-B");
  });

  it("ロックが存在しない場合も成功する (previousOwner は requester)", () => {
    const result = forceRelease("table", "tbl-1", "session-X");
    expect(result.released).toBe(true);
    expect(result.previousOwner).toBe("session-X");
  });

  it("owner が自分自身を強制解除できる", () => {
    acquire("table", "tbl-1", "session-A");
    const result = forceRelease("table", "tbl-1", "session-A");
    expect(result.previousOwner).toBe("session-A");
  });
});

describe("getLock", () => {
  it("存在するロックを返す", () => {
    const entry = acquire("process-flow", "pf-1", "session-A");
    expect(getLock("process-flow", "pf-1")).toEqual(entry);
  });

  it("存在しない場合は null", () => {
    expect(getLock("process-flow", "pf-none")).toBeNull();
  });
});

describe("listLocks", () => {
  it("全ロックを返す", () => {
    acquire("table", "tbl-1", "session-A");
    acquire("screen", "scr-1", "session-B");
    const all = listLocks();
    expect(all).toHaveLength(2);
    const types = all.map((e) => e.resourceType).sort();
    expect(types).toEqual(["screen", "table"]);
  });

  it("ロックがない場合は空配列", () => {
    expect(listLocks()).toEqual([]);
  });
});

describe("owner != actor シナリオ (AI 委任)", () => {
  it("human が owner、AI session が actor になれる", () => {
    const entry = acquire("process-flow", "pf-1", "human-session-H", "ai-session-A");
    expect(entry.ownerSessionId).toBe("human-session-H");
    expect(entry.actorSessionId).toBe("ai-session-A");
    expect(getLock("process-flow", "pf-1")).toEqual(entry);
  });

  it("owner である human session が release できる", () => {
    acquire("process-flow", "pf-1", "human-session-H", "ai-session-A");
    const result = release("process-flow", "pf-1", "human-session-H");
    expect(result.released).toBe(true);
  });

  it("actor session (AI) は release できない (LockNotHeldError)", () => {
    acquire("process-flow", "pf-1", "human-session-H", "ai-session-A");
    expect(() => release("process-flow", "pf-1", "ai-session-A")).toThrow(LockNotHeldError);
  });

  it("entry has owner and actor separately when actor differs", () => {
    const entry = acquire("table" as DraftResourceType, "t1", "human-X", "ai-Y");
    expect(entry.ownerSessionId).toBe("human-X");
    expect(entry.actorSessionId).toBe("ai-Y");
  });

  it("actor defaults to owner when omitted", () => {
    const entry = acquire("table" as DraftResourceType, "t2", "human-X");
    expect(entry.ownerSessionId).toBe("human-X");
    expect(entry.actorSessionId).toBe("human-X");
  });

  it("non-owner cannot release", () => {
    acquire("table" as DraftResourceType, "t3", "human-X");
    expect(() => release("table" as DraftResourceType, "t3", "ai-Y")).toThrow(LockNotHeldError);
  });
});
