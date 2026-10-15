import { describe, it, expect, vi, beforeEach } from "vitest";

const loadAll = vi.fn();
vi.mock("./processFlowStore", () => ({ loadAllProcessFlows: () => loadAll() }));
import { loadStepTransitionStats, resetStepStatsCache } from "./stepStatsStore";

const flow = { actions: [{ id: "a", steps: [{ id: "1", kind: "validation" }, { id: "2", kind: "dbAccess" }] }] };

describe("loadStepTransitionStats", () => {
  beforeEach(() => { loadAll.mockReset(); resetStepStatsCache(); });

  it("全処理フローを 1 回読んで数え、短い間は使い回す", async () => {
    loadAll.mockResolvedValue(new Map([["f", flow]]));
    const a = await loadStepTransitionStats(1000);
    const b = await loadStepTransitionStats(1500);
    expect(a).toBe(b);
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(a.get("validation")?.get("dbAccess")).toBe(1);
    await loadStepTransitionStats(1000 + 61_000);
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it("失敗したら使い回さず、次は読み直す", async () => {
    loadAll.mockRejectedValueOnce(new Error("x")).mockResolvedValue(new Map());
    await expect(loadStepTransitionStats(1)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    await loadStepTransitionStats(2);
    expect(loadAll).toHaveBeenCalledTimes(2);
  });
});
