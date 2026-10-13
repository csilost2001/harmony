/**
 * 先読み (prewarm) のテスト: 呼ばれる回数と、無効化の条件を確かめる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./designInput.js", () => ({ loadDesignInputFromRoot: vi.fn(async () => ({})) }));
vi.mock("./schemaIssues.js", () => ({ collectExtraIssues: vi.fn(async () => []) }));
vi.mock("./designSearch.js", () => ({ searchDesign: vi.fn(async () => []) }));

import { loadDesignInputFromRoot } from "./designInput.js";
import { collectExtraIssues } from "./schemaIssues.js";
import { searchDesign } from "./designSearch.js";
import { schedulePrewarm, _resetPrewarmForTest } from "./prewarm.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("先読み (prewarm)", () => {
  beforeEach(() => { _resetPrewarmForTest(); vi.clearAllMocks(); delete process.env.HARMONY_NO_PREWARM; });

  it("ワークスペースごとに 1 回だけ、遅れて 3 つの重い読み出しを計算する", async () => {
    schedulePrewarm("/ws/a", 5);
    schedulePrewarm("/ws/a", 5); // 2 回目は何もしない
    expect(loadDesignInputFromRoot).not.toHaveBeenCalled(); // 遅れて (すぐには計算しない)
    await wait(60);
    expect(loadDesignInputFromRoot).toHaveBeenCalledTimes(1);
    expect(loadDesignInputFromRoot).toHaveBeenCalledWith("/ws/a");
    expect(collectExtraIssues).toHaveBeenCalledTimes(1);
    expect(searchDesign).toHaveBeenCalledTimes(1);
    schedulePrewarm("/ws/b", 5); // 別のワークスペースは、別に 1 回
    await wait(60);
    expect(loadDesignInputFromRoot).toHaveBeenCalledTimes(2);
  });

  it("計算が失敗しても、例外にならず、他の計算は実行される", async () => {
    vi.mocked(loadDesignInputFromRoot).mockRejectedValueOnce(new Error("読めない"));
    schedulePrewarm("/ws/fail", 5);
    await wait(60);
    expect(collectExtraIssues).toHaveBeenCalledTimes(1);
    expect(searchDesign).toHaveBeenCalledTimes(1);
  });

  it("HARMONY_NO_PREWARM=1 なら先読みしない (あとで有効にしても、そのワークスペースは先読みされる)", async () => {
    process.env.HARMONY_NO_PREWARM = "1";
    schedulePrewarm("/ws/skip", 5);
    await wait(60);
    expect(loadDesignInputFromRoot).not.toHaveBeenCalled();
    delete process.env.HARMONY_NO_PREWARM;
    schedulePrewarm("/ws/skip", 5);
    await wait(60);
    expect(loadDesignInputFromRoot).toHaveBeenCalledTimes(1);
  });
});
