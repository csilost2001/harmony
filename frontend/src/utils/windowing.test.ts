import { describe, it, expect, beforeEach } from "vitest";
import { WINDOW_THRESHOLD, _resetWindowing, shouldWindow, suspendWindowing, visibleRange } from "./windowing";

describe("visibleRange (続編 第 10 弾 #192)", () => {
  const base = { rowHeight: 40, count: 1000, overscan: 5, listTop: 100 };
  it("先頭: 見える行と余りを含む", () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewport: 400 })).toEqual({ start: 0, end: 13 }); // (400-100)/40 = 7.5 → 8、余り 5 を足して 13
  });
  it("途中: スクロールした分だけ後ろへ。前にも余り", () => {
    const r = visibleRange({ ...base, scrollTop: 4100, viewport: 400 }); // 先頭の行 100、末尾の行 110 (切り上げ)
    expect(r.start).toBe(95);
    expect(r.end).toBe(115);
  });
  it("末尾を超えない。行があれば 1 行は含む。入れ物より下までスクロールしても、最後の行を含む", () => {
    expect(visibleRange({ ...base, scrollTop: 999999, viewport: 400 }).end).toBe(1000);
    const r = visibleRange({ ...base, scrollTop: 999999, viewport: 400 });
    expect(r.start).toBeLessThan(r.end);
    expect(visibleRange({ ...base, count: 0, scrollTop: 0, viewport: 400 })).toEqual({ start: 0, end: 0 }); // 行が無ければ、空
  });
  it("行の高さが 0 以下でも、壊れない", () => {
    const r = visibleRange({ ...base, rowHeight: 0, scrollTop: 0, viewport: 400 });
    expect(r.end).toBeGreaterThan(r.start);
  });
});

describe("shouldWindow / suspendWindowing", () => {
  beforeEach(() => _resetWindowing());
  it("行が多く、グループ表示でなく、止められていないときだけ", () => {
    expect(shouldWindow(WINDOW_THRESHOLD, false, false)).toBe(true);
    expect(shouldWindow(WINDOW_THRESHOLD - 1, false, false)).toBe(false);
    expect(shouldWindow(1000, true, false)).toBe(false);
    expect(shouldWindow(1000, false, true)).toBe(false);
  });
  it("止める合図は、呼び出し元ごとに数える", async () => {
    const { useWindowingSuspended } = await import("./windowing");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useWindowingSuspended());
    expect(result.current).toBe(false);
    act(() => { suspendWindowing("find", true); suspendWindowing("other", true); });
    expect(result.current).toBe(true);
    act(() => { suspendWindowing("find", false); });
    expect(result.current).toBe(true);
    act(() => { suspendWindowing("other", false); });
    expect(result.current).toBe(false);
  });
});
