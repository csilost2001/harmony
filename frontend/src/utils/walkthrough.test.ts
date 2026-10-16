import { describe, it, expect } from "vitest";
import type { FlowStep } from "@harmony/shared";
import { choose, next, promptOf, startWalk } from "./walkthrough";

const st = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "compute", description: id, ...extra }) as unknown as FlowStep;
const expr = (e: string) => ({ kind: "expression", expression: e });

const steps = [
  st("s1", { outputBinding: { name: "cartItems" } }),
  st("br", { kind: "branch", branches: [{ code: "A", label: "空", condition: expr("@cartItems.length === 0"), steps: [st("a1", { kind: "return" })] }], elseBranch: { code: "B", label: "あり", steps: [st("b1")] } }),
  st("lp", { kind: "loop", collectionItemName: "item", steps: [st("l1", { outputBinding: { name: "res" } })] }),
  st("tx", { kind: "transactionScope", steps: [st("t1")] }),
  st("last"),
];

describe("机上演習 (続編 第 8 弾 #151)", () => {
  it("開始: 最初の工程。通常の工程は、次へで進み、出力の変数が定義されていく", () => {
    let s = startWalk(steps);
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "s1" } });
    s = next(s);
    expect(s.defined).toEqual(["cartItems"]);
    expect(promptOf(s)).toMatchObject({ kind: "branch" });
  });
  it("分岐: 枝を選ぶと、その枝の工程へ入り、終わったら分岐の次へ戻る", () => {
    let s = next(startWalk(steps));
    const p = promptOf(s);
    expect(p.kind === "branch" && p.choices.map((c) => c.id)).toEqual(["b0", "else"]);
    s = choose(s, "else");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "b1" } });
    s = next(s);
    expect(promptOf(s)).toMatchObject({ kind: "loop" });
    expect(s.log.some((l) => l.kind === "choice" && l.text.includes("あり"))).toBe(true);
  });
  it("return の枝を選ぶと、そこで処理が終わる", () => {
    let s = choose(next(startWalk(steps)), "b0");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "a1" } });
    s = next(s);
    expect(s.ended).toBe(true);
    expect(promptOf(s)).toMatchObject({ kind: "end" });
    expect(s.log[s.log.length - 1].kind).toBe("end");
  });
  it("繰り返し: 入る → 本体 → もう 1 回 / 終える。0 回で飛ばすこともできる", () => {
    let s = choose(next(startWalk(steps)), "else");
    s = next(s);
    s = choose(s, "enter");
    expect(s.defined).toContain("item");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "l1" } });
    s = next(s);
    const pe = promptOf(s);
    expect(pe).toMatchObject({ kind: "loopEnd", iteration: 1 });
    s = choose(s, "again");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "l1" } });
    s = next(s);
    expect(promptOf(s)).toMatchObject({ kind: "loopEnd", iteration: 2 });
    s = choose(s, "exit");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "tx" } }); // トランザクションの工程
    // 0 回
    let s2 = choose(next(choose(next(startWalk(steps)), "else")), "skip");
    expect(promptOf(s2)).toMatchObject({ kind: "step", step: { id: "tx" } });
    s2 = next(s2);
    expect(promptOf(s2)).toMatchObject({ kind: "step", step: { id: "t1" } }); // トランザクションの中へ
  });
  it("最後まで進むと終わる", () => {
    let s = choose(next(startWalk(steps)), "else");
    s = choose(next(s), "skip");
    for (let i = 0; i < 10 && !s.ended; i++) s = next(s);
    expect(s.ended).toBe(true);
    expect(s.endReason).toContain("最後まで");
  });
  it("空の処理は、すぐ終わる / 枝のない分岐の「合わない」は何もせず次へ", () => {
    expect(startWalk([]).ended).toBe(true);
    const s = choose(startWalk([st("only", { kind: "branch", branches: [{ code: "A", condition: expr("x"), steps: [st("x1")] }] }), st("after")]), "else");
    expect(promptOf(s)).toMatchObject({ kind: "step", step: { id: "after" } });
  });
});
