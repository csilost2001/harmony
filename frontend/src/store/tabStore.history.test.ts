import { describe, it, expect, beforeEach } from "vitest";
import {
  getTabs, getActiveTabId, openTab, closeTab, setActiveTab, makeTabId, setPinned, closeOtherTabs, closeTabsToRight,
  getClosedTabs, reopenClosedTab, canGoBack, canGoForward, goBackTab, goForwardTab,
  _resetForTests, _reloadFromStorageForTests,
} from "./tabStore";

const t = (id: string) => ({ id: makeTabId("table", id), type: "table" as const, resourceId: id, label: `テーブル_${id}` });

beforeEach(() => { _resetForTests(); localStorage.clear(); });

describe("閉じたタブを開き直す (続編 第 6 弾 #106)", () => {
  it("閉じたタブが新しい順に並び、開き直すと元のタブが戻る", () => {
    openTab(t("a")); openTab(t("b")); openTab(t("c"));
    closeTab(t("a").id); closeTab(t("b").id);
    expect(getClosedTabs().map((c) => c.resourceId)).toEqual(["b", "a"]);
    const r = reopenClosedTab();
    expect(r?.resourceId).toBe("b");
    expect(getActiveTabId()).toBe(t("b").id);
    expect(getClosedTabs().map((c) => c.resourceId)).toEqual(["a"]);
  });
  it("id を渡すと、そのタブを開き直す。開き直せるものが無ければ null", () => {
    openTab(t("a")); openTab(t("b"));
    closeTab(t("a").id); closeTab(t("b").id);
    expect(reopenClosedTab(t("a").id)?.resourceId).toBe("a");
    expect(reopenClosedTab("table:zzz")).toBeNull();
    reopenClosedTab();
    expect(reopenClosedTab()).toBeNull();
  });
  it("いま開いているタブは「閉じたタブ」に出ない / ピン留めは戻る", () => {
    openTab(t("a")); openTab(t("b"));
    closeTab(t("b").id); openTab(t("b"));
    expect(getClosedTabs().map((c) => c.resourceId)).toEqual([]);
    setPinned(t("a").id, true);
    closeTab(t("a").id);
    reopenClosedTab();
    expect(getTabs().find((x) => x.id === t("a").id)?.isPinned).toBe(true);
  });
  it("ほかを閉じる・右側を閉じるで消えたタブも記録する。最大 10 件", () => {
    for (const id of ["a", "b", "c", "d"]) openTab(t(id));
    closeOtherTabs(t("a").id);
    expect(getClosedTabs().map((c) => c.resourceId).sort()).toEqual(["b", "c", "d"]);
    _resetForTests();
    for (let i = 0; i < 14; i++) { openTab(t(`x${i}`)); closeTab(t(`x${i}`).id); }
    expect(getClosedTabs()).toHaveLength(10);
    expect(getClosedTabs()[0].resourceId).toBe("x13");
  });
  it("右側を閉じるも記録する", () => {
    for (const id of ["a", "b", "c"]) openTab(t(id));
    closeTabsToRight(t("a").id);
    expect(getClosedTabs().map((c) => c.resourceId).sort()).toEqual(["b", "c"]);
  });
  it("再読み込みしても残る", () => {
    openTab(t("a")); openTab(t("b")); closeTab(t("a").id);
    _reloadFromStorageForTests();
    expect(getClosedTabs().map((c) => c.resourceId)).toEqual(["a"]);
  });
});

describe("画面の履歴: 戻る / 進む (続編 第 6 弾 #107)", () => {
  it("開いた順をたどって戻り、進める", () => {
    openTab(t("a")); openTab(t("b")); openTab(t("c"));
    expect(canGoBack()).toBe(true); expect(canGoForward()).toBe(false);
    expect(goBackTab()).toBe(true); expect(getActiveTabId()).toBe(t("b").id);
    expect(goBackTab()).toBe(true); expect(getActiveTabId()).toBe(t("a").id);
    expect(canGoBack()).toBe(false);
    expect(goBackTab()).toBe(false);
    expect(goForwardTab()).toBe(true); expect(getActiveTabId()).toBe(t("b").id);
    expect(canGoForward()).toBe(true);
  });
  it("戻ったあとに別のタブを開くと、進む先は消える", () => {
    openTab(t("a")); openTab(t("b")); openTab(t("c"));
    goBackTab();
    setActiveTab(t("a").id);
    expect(canGoForward()).toBe(false);
    goBackTab();
    expect(getActiveTabId()).toBe(t("b").id);
  });
  it("閉じたタブは飛ばす", () => {
    openTab(t("a")); openTab(t("b")); openTab(t("c"));
    closeTab(t("b").id, true);
    expect(getActiveTabId()).toBe(t("c").id);
    goBackTab();
    expect(getActiveTabId()).toBe(t("a").id);
  });
  it("同じタブを続けて開いても履歴は増えない", () => {
    openTab(t("a")); openTab(t("a")); setActiveTab(t("a").id);
    expect(canGoBack()).toBe(false);
  });
});
