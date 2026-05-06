import { describe, it, expect, beforeEach } from "vitest";
import {
  getTabs,
  getActiveTabId,
  subscribe,
  openTab,
  closeTab,
  setActiveTab,
  reorderTabs,
  setDirty,
  setPinned,
  updateTabLabel,
  closeOtherTabs,
  closeTabsToRight,
  makeTabId,
  _resetForTests,
  _reloadFromStorageForTests,
} from "./tabStore";

// ── ヘルパー ────────────────────────────────────────────────────────────────

function tab(resourceId: string, type: "design" | "table" = "design") {
  return {
    id: makeTabId(type, resourceId),
    type,
    resourceId,
    label: `画面_${resourceId}`,
  } as const;
}

beforeEach(() => {
  _resetForTests();
  localStorage.clear();
});

// ── makeTabId ────────────────────────────────────────────────────────────────

describe("makeTabId", () => {
  it("type:resourceId 形式を返す", () => {
    expect(makeTabId("design", "abc")).toBe("design:abc");
    expect(makeTabId("table", "xyz")).toBe("table:xyz");
  });
});

// ── openTab ──────────────────────────────────────────────────────────────────

describe("openTab", () => {
  it("新規タブを追加してアクティブにする", () => {
    openTab(tab("s1"));
    expect(getTabs()).toHaveLength(1);
    expect(getActiveTabId()).toBe("design:s1");
  });

  it("複数タブを開ける", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    expect(getTabs()).toHaveLength(2);
    expect(getActiveTabId()).toBe("design:s2");
  });

  it("既存タブを再度開くと追加せずアクティブを切り替える", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s1"));
    expect(getTabs()).toHaveLength(2);
    expect(getActiveTabId()).toBe("design:s1");
  });

  it("既存タブのラベルを更新する", () => {
    openTab(tab("s1"));
    openTab({ ...tab("s1"), label: "新しい名前" });
    expect(getTabs()[0].label).toBe("新しい名前");
  });

  it("初期状態は isDirty=false isPinned=false", () => {
    openTab(tab("s1"));
    const t = getTabs()[0];
    expect(t.isDirty).toBe(false);
    expect(t.isPinned).toBe(false);
  });

  it("localStorageに永続化される", () => {
    openTab(tab("s1"));
    const raw = localStorage.getItem("harmony-open-tabs");
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!);
    expect(saved[0].resourceId).toBe("s1");
  });
});

// ── closeTab ─────────────────────────────────────────────────────────────────

describe("closeTab", () => {
  it("タブを削除できる", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    closeTab("design:s1");
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0].resourceId).toBe("s2");
  });

  it("アクティブなタブを閉じると隣のタブがアクティブになる", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s3"));
    setActiveTab("design:s2");
    closeTab("design:s2");
    // s3 (index 1) がアクティブになる
    expect(getActiveTabId()).toBe("design:s3");
  });

  it("最後のタブを閉じると activeTabId が空になる", () => {
    openTab(tab("s1"));
    closeTab("design:s1");
    expect(getTabs()).toHaveLength(0);
    expect(getActiveTabId()).toBe("");
  });

  it("dirty タブは force=false で閉じられない（false を返す）", () => {
    openTab(tab("s1"));
    setDirty("design:s1", true);
    const result = closeTab("design:s1", false);
    expect(result).toBe(false);
    expect(getTabs()).toHaveLength(1);
  });

  it("dirty タブは force=true で強制閉鎖できる", () => {
    openTab(tab("s1"));
    setDirty("design:s1", true);
    const result = closeTab("design:s1", true);
    expect(result).toBe(true);
    expect(getTabs()).toHaveLength(0);
  });

  it("存在しない tabId は true を返す（冪等）", () => {
    expect(closeTab("design:nonexistent")).toBe(true);
  });
});

// ── setActiveTab ─────────────────────────────────────────────────────────────

describe("setActiveTab", () => {
  it("アクティブタブを切り替える", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    setActiveTab("design:s1");
    expect(getActiveTabId()).toBe("design:s1");
  });

  it("同じタブを再度アクティブにしても状態が変わらない", () => {
    openTab(tab("s1"));
    const before = getActiveTabId();
    setActiveTab("design:s1");
    expect(getActiveTabId()).toBe(before);
  });
});

// ── reorderTabs ──────────────────────────────────────────────────────────────

describe("reorderTabs", () => {
  it("タブを並び替えられる", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s3"));
    reorderTabs(0, 2); // s1 を末尾へ
    const ids = getTabs().map((t) => t.resourceId);
    expect(ids).toEqual(["s2", "s3", "s1"]);
  });

  it("並び替え後も activeTabId は変わらない", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    setActiveTab("design:s1");
    reorderTabs(0, 1);
    expect(getActiveTabId()).toBe("design:s1");
  });
});

// ── setDirty ─────────────────────────────────────────────────────────────────

describe("setDirty", () => {
  it("isDirty フラグを立てる", () => {
    openTab(tab("s1"));
    setDirty("design:s1", true);
    expect(getTabs()[0].isDirty).toBe(true);
  });

  it("isDirty フラグを解除する", () => {
    openTab(tab("s1"));
    setDirty("design:s1", true);
    setDirty("design:s1", false);
    expect(getTabs()[0].isDirty).toBe(false);
  });

  it("isDirty は localStorageに保存されない（セッション限定）", () => {
    openTab(tab("s1"));
    setDirty("design:s1", true);
    const saved = JSON.parse(localStorage.getItem("harmony-open-tabs")!);
    expect(saved[0].isDirty).toBe(false);
  });

  it("存在しない tabId は無視する", () => {
    expect(() => setDirty("design:nonexistent", true)).not.toThrow();
  });
});

// ── setPinned ────────────────────────────────────────────────────────────────

describe("setPinned", () => {
  it("ピン留めできる", () => {
    openTab(tab("s1"));
    setPinned("design:s1", true);
    expect(getTabs()[0].isPinned).toBe(true);
  });

  it("ピン留め解除できる", () => {
    openTab(tab("s1"));
    setPinned("design:s1", true);
    setPinned("design:s1", false);
    expect(getTabs()[0].isPinned).toBe(false);
  });
});

// ── updateTabLabel ────────────────────────────────────────────────────────────

describe("updateTabLabel", () => {
  it("タブのラベルを更新できる", () => {
    openTab(tab("s1"));
    updateTabLabel("design:s1", "更新後ラベル");
    expect(getTabs()[0].label).toBe("更新後ラベル");
  });
});

// ── closeOtherTabs ────────────────────────────────────────────────────────────

describe("closeOtherTabs", () => {
  it("指定タブ以外を閉じる", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s3"));
    closeOtherTabs("design:s2");
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0].resourceId).toBe("s2");
  });

  it("ピン留めタブは閉じない", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s3"));
    setPinned("design:s1", true);
    closeOtherTabs("design:s3");
    const ids = getTabs().map((t) => t.resourceId);
    expect(ids).toContain("s1"); // ピン留め保持
    expect(ids).toContain("s3"); // 対象保持
    expect(ids).not.toContain("s2");
  });
});

// ── closeTabsToRight ──────────────────────────────────────────────────────────

describe("closeTabsToRight", () => {
  it("指定タブより右を閉じる", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    openTab(tab("s3"));
    closeTabsToRight("design:s1");
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0].resourceId).toBe("s1");
  });

  it("最右端のタブを指定しても何も変わらない", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    closeTabsToRight("design:s2");
    expect(getTabs()).toHaveLength(2);
  });
});

// ── subscribe ────────────────────────────────────────────────────────────────

describe("subscribe", () => {
  it("openTab で通知される", () => {
    let called = 0;
    const unsub = subscribe(() => called++);
    openTab(tab("s1"));
    expect(called).toBe(1);
    unsub();
  });

  it("closeTab で通知される", () => {
    openTab(tab("s1"));
    let called = 0;
    const unsub = subscribe(() => called++);
    closeTab("design:s1");
    expect(called).toBe(1);
    unsub();
  });

  it("unsubscribe 後は通知されない", () => {
    let called = 0;
    const unsub = subscribe(() => called++);
    unsub();
    openTab(tab("s1"));
    expect(called).toBe(0);
  });

  it("setDirty で通知される", () => {
    openTab(tab("s1"));
    let called = 0;
    const unsub = subscribe(() => called++);
    setDirty("design:s1", true);
    expect(called).toBe(1);
    unsub();
  });
});

// ── localStorage 永続化 ───────────────────────────────────────────────────────

describe("localStorage 永続化", () => {
  it("activeTabId が永続化される", () => {
    openTab(tab("s1"));
    openTab(tab("s2"));
    setActiveTab("design:s1");
    expect(localStorage.getItem("harmony-active-tab")).toBe("design:s1");
  });

  it("isPinned が永続化される", () => {
    openTab(tab("s1"));
    setPinned("design:s1", true);
    const saved = JSON.parse(localStorage.getItem("harmony-open-tabs")!);
    expect(saved[0].isPinned).toBe(true);
  });
});

// ── localStorage ロード時のバリデーション (#123) ──────────────────────────────────

describe("localStorage ロード時のバリデーション", () => {
  it("壊れた JSON なら空配列にフォールバックする", () => {
    localStorage.setItem("harmony-open-tabs", "{not json");
    _reloadFromStorageForTests();
    expect(getTabs()).toEqual([]);
  });

  it("配列ではないデータなら空配列にフォールバックする", () => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify({ not: "array" }));
    _reloadFromStorageForTests();
    expect(getTabs()).toEqual([]);
  });

  it("未知の type を含むエントリは除去される", () => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([
      { id: "design:s1", type: "design", resourceId: "s1", label: "ok" },
      { id: "legacy:s2", type: "legacy-unknown", resourceId: "s2", label: "ng" },
    ]));
    _reloadFromStorageForTests();
    const ids = getTabs().map((t) => t.id);
    expect(ids).toContain("design:s1");
    expect(ids).not.toContain("legacy:s2");
  });

  it("必須プロパティ欠落のエントリは除去される", () => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([
      { id: "design:s1", type: "design", resourceId: "s1", label: "ok" },
      { id: "design:s2" /* type / resourceId / label 欠落 */ },
      { type: "design", resourceId: "s3", label: "no-id" },
      null,
    ]));
    _reloadFromStorageForTests();
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0].id).toBe("design:s1");
  });

  it("有効エントリは isDirty=false / isPinned はソース尊重で復元される", () => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([
      { id: "design:s1", type: "design", resourceId: "s1", label: "a", isPinned: true, isDirty: true },
    ]));
    _reloadFromStorageForTests();
    const t = getTabs()[0];
    expect(t.isPinned).toBe(true);
    expect(t.isDirty).toBe(false); // 起動時は dirty 情報を信用しない
  });

  it("全エントリ不正でもクラッシュせず空配列になる", () => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([
      null,
      42,
      "string",
      { only: "garbage" },
    ]));
    expect(() => _reloadFromStorageForTests()).not.toThrow();
    expect(getTabs()).toEqual([]);
  });
});
