import { describe, it, expect } from "vitest";
import { batchSummary, runBatch } from "./batchTask";

describe("runBatch (続編 第 10 弾 #194)", () => {
  it("1 件ずつ順に実行し、進み具合を知らせる", async () => {
    const order: number[] = [];
    const prog: Array<[number, number]> = [];
    const r = await runBatch([10, 20, 30], async (x) => { order.push(x); }, { onProgress: (f, t) => prog.push([f, t]) });
    expect(order).toEqual([10, 20, 30]);
    expect(prog).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(r).toEqual({ total: 3, done: 3, failed: [], cancelled: false });
  });
  it("途中で中止すると、続きは実行しない。処理済みは数える", async () => {
    const ac = new AbortController();
    const seen: number[] = [];
    const r = await runBatch([1, 2, 3, 4], async (x) => { seen.push(x); if (x === 2) ac.abort(); }, { signal: ac.signal });
    expect(seen).toEqual([1, 2]);
    expect(r).toMatchObject({ done: 2, cancelled: true });
  });
  it("1 件の失敗は、数えて続ける。stopOnError なら、そこで止める", async () => {
    const worker = async (x: number) => { if (x === 2) throw new Error("x"); };
    const r1 = await runBatch([1, 2, 3], worker);
    expect(r1).toMatchObject({ done: 2, cancelled: false });
    expect(r1.failed.map((f) => f.item)).toEqual([2]);
    const r2 = await runBatch([1, 2, 3], worker, { stopOnError: true });
    expect(r2.done).toBe(1);
    expect(r2.failed).toHaveLength(1);
  });
  it("最初から中止されていれば、何もしない。空でも動く", async () => {
    const ac = new AbortController(); ac.abort();
    expect(await runBatch([1], async () => { throw new Error("実行されない"); }, { signal: ac.signal })).toMatchObject({ done: 0, cancelled: true });
    expect(await runBatch([], async () => undefined)).toEqual({ total: 0, done: 0, failed: [], cancelled: false });
  });
});

describe("batchSummary", () => {
  it("全部成功・中止・失敗あり", () => {
    expect(batchSummary({ total: 3, done: 3, failed: [], cancelled: false }, "取り込みました")).toBe("3 件中 3 件を取り込みました");
    expect(batchSummary({ total: 10, done: 7, failed: [], cancelled: true }, "取り込みました")).toBe("10 件中 7 件を取り込みました (中止。処理済みの 7 件は残っています)");
    expect(batchSummary({ total: 4, done: 3, failed: [{ item: 1, error: 1 }], cancelled: false }, "作りました")).toBe("4 件中 3 件を作りました (1 件は失敗しました)");
  });
});
