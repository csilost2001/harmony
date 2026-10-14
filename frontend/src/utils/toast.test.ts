import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TOAST_HISTORY_MAX, _resetToastHistory, clearToastHistory, getToastHistory, getUnseenErrorCount, markToastHistorySeen,
  runToastRetry, showToast, subscribeToastHistory,
} from "./toast";
import { _resetFailureToastDedupe, reportFailure, runReporting } from "./failureToast";

beforeEach(() => { _resetToastHistory(); _resetFailureToastDedupe(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("通知の履歴", () => {
  it("出した通知を新しい順に残し、見ていない失敗だけ数える", () => {
    showToast("保存しました");
    showToast("失敗しました", "error");
    showToast("お知らせ", "info");
    expect(getToastHistory().map((t) => t.text)).toEqual(["お知らせ", "失敗しました", "保存しました"]);
    expect(getUnseenErrorCount()).toBe(1);
    markToastHistorySeen();
    expect(getUnseenErrorCount()).toBe(0);
  });

  it("直近 50 件だけ残す", () => {
    for (let i = 0; i < TOAST_HISTORY_MAX + 5; i++) showToast(`n${i}`);
    const h = getToastHistory();
    expect(h).toHaveLength(TOAST_HISTORY_MAX);
    expect(h[0].text).toBe(`n${TOAST_HISTORY_MAX + 4}`);
  });

  it("履歴の変化を購読者に知らせ、消すと空になる", () => {
    const l = vi.fn();
    const off = subscribeToastHistory(l);
    showToast("a");
    expect(l).toHaveBeenCalledTimes(1);
    clearToastHistory();
    expect(getToastHistory()).toHaveLength(0);
    off();
    showToast("b");
    expect(l).toHaveBeenCalledTimes(2);
  });

  it("やり直しは 1 回だけ実行でき、実行した通知の印は消える", () => {
    const retry = vi.fn();
    showToast("保存に失敗しました", "error", { retry });
    const id = getToastHistory()[0].id;
    expect(runToastRetry(id)).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getToastHistory()[0].retry).toBeUndefined();
    expect(runToastRetry(id)).toBe(false);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("失敗の通知のやり直し", () => {
  it("reportFailure に渡したやり直しが、通知の履歴に付く", () => {
    const retry = vi.fn();
    reportFailure(new Error("disk full"), "画面の保存", retry);
    const t = getToastHistory()[0];
    expect(t.kind).toBe("error");
    expect(t.text).toContain("画面の保存に失敗しました");
    t.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("やり直しでまた同じ失敗をしても、5 秒の重複抑制で通知が消えない", () => {
    reportFailure(new Error("x"), "画面の保存", () => reportFailure(new Error("x"), "画面の保存"));
    expect(getToastHistory()).toHaveLength(1);
    getToastHistory()[0].retry?.();
    expect(getToastHistory()).toHaveLength(2);
  });

  it("runReporting は失敗を通知し、再試行で同じ操作をもう一度実行する", async () => {
    let n = 0;
    const op = vi.fn(async () => { n++; if (n === 1) throw new Error("boom"); });
    runReporting(op, "ガジェットの保存");
    await vi.waitFor(() => expect(getToastHistory()).toHaveLength(1));
    expect(getToastHistory()[0].text).toContain("ガジェットの保存に失敗しました");
    getToastHistory()[0].retry?.();
    await vi.waitFor(() => expect(op).toHaveBeenCalledTimes(2));
    expect(getToastHistory()).toHaveLength(1); // 2 回目は成功したので、新しい失敗の通知は出ない
  });
});

describe("formatToastTime", () => {
  it("時刻を HH:MM:SS にする (ゼロ埋め)", async () => {
    const { formatToastTime } = await import("./toast");
    expect(formatToastTime(new Date(2026, 9, 14, 3, 4, 5).getTime())).toBe("03:04:05");
  });
});
