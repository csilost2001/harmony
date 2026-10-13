import { describe, it, expect, vi } from "vitest";
import { onApplyVersion, requestApplyVersion, requestApplyVersionWhenReady, type ApplyVersionRequest } from "./applyVersionBus";

describe("保存前の版の取り次ぎ", () => {
  it("受け取る画面があれば true、無ければ false。購読を解けば届かない", () => {
    const req: ApplyVersionRequest = { resourceType: "table", resourceId: "orders", snapshot: { id: "orders" } };
    expect(requestApplyVersion(req)).toBe(false);
    const handler = vi.fn((r: ApplyVersionRequest) => r.resourceId === "orders");
    const off = onApplyVersion(handler);
    expect(requestApplyVersion(req)).toBe(true);
    expect(requestApplyVersion({ ...req, resourceId: "other" })).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
    off();
    expect(requestApplyVersion(req)).toBe(false);
  });

  it("受け取れるようになるまで頼み直し、時間切れなら諦めを知らせる", async () => {
    vi.useFakeTimers();
    try {
      const req: ApplyVersionRequest = { resourceType: "table", resourceId: "orders", snapshot: 1 };
      const taken = vi.fn();
      // 3 回目から受け取れる画面
      let calls = 0;
      const off = onApplyVersion(() => { calls++; if (calls >= 3) { taken(); return true; } return false; });
      const giveUp = vi.fn();
      requestApplyVersionWhenReady(req, giveUp, 10, 10);
      await vi.advanceTimersByTimeAsync(100);
      expect(taken).toHaveBeenCalledTimes(1);
      expect(giveUp).not.toHaveBeenCalled();
      off();

      const giveUp2 = vi.fn();
      requestApplyVersionWhenReady(req, giveUp2, 10, 3);
      await vi.advanceTimersByTimeAsync(100);
      expect(giveUp2).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
