import { describe, expect, it } from "vitest";
import type { Step } from "../../../types/v3";
import {
  addArm, canMoveInto, ensureElse, ensureGroup, insertSteps, moveDestinations, moveStepBy, moveStepTo, patchOutputBinding, patchStep, removeArm, removeStepById, renameVariable, resolveList, setArmCondition, setHeading, TOP,
} from "./storyEdit";

const S = (o: Record<string, unknown>) => o as unknown as Step;
function flow(): Step[] {
  return [
    S({ id: "a", kind: "compute", heading: "前半", expression: "1" }),
    S({ id: "b", kind: "branch", description: "分岐", branches: [{ id: "br-01", code: "A", condition: { kind: "expression", expression: "@x == null" }, steps: [S({ id: "b1", kind: "return" })] }], elseBranch: { id: "br-02", code: "B", steps: [] } }),
    S({ id: "c", kind: "transactionScope", heading: "後半", steps: [S({ id: "c1", kind: "compute" }), S({ id: "c2", kind: "compute" })] }),
    S({ id: "d", kind: "compute" }),
  ];
}
const ids = (l: Step[]) => l.map((s) => s.id);

describe("resolveList", () => {
  it("最上位・腕・本体・それ以外を、住所で指せる", () => {
    const f = flow();
    expect(resolveList(f, TOP)).toBe(f);
    expect(ids(resolveList(f, { ownerId: "b", key: "arm:br-01" })!)).toEqual(["b1"]);
    expect(resolveList(f, { ownerId: "b", key: "else" })).toEqual([]);
    expect(ids(resolveList(f, { ownerId: "c", key: "body" })!)).toEqual(["c1", "c2"]);
    expect(resolveList(f, { ownerId: "zz", key: "body" })).toBeNull();
  });
  it("create: まだ無い枠を作る。それ以外 (else) は、無ければ作らない", () => {
    const f = flow();
    expect(resolveList(f, { ownerId: "c", key: "commit" })).toBeNull();
    expect(resolveList(f, { ownerId: "c", key: "commit" }, true)).toEqual([]);
    expect((f[2] as unknown as { onCommit: unknown[] }).onCommit).toEqual([]);
    expect(resolveList(f, { ownerId: "a", key: "else" }, true)).toBeNull();
    expect(ensureGroup(f, "d", "ng")).toBe(true);
  });
});

describe("insertSteps / removeStepById", () => {
  it("入れる位置を指せる。範囲外は端に丸める", () => {
    const f = flow();
    expect(insertSteps(f, { ownerId: "c", key: "body" }, 1, [S({ id: "n1", kind: "log" })])).toBe(true);
    expect(ids((f[2] as unknown as { steps: Step[] }).steps)).toEqual(["c1", "n1", "c2"]);
    insertSteps(f, TOP, 99, [S({ id: "n2", kind: "log" })]);
    expect(f.at(-1)!.id).toBe("n2");
  });
  it("消すと、入れ子ごと消える。見出しは、次の工程へ引き継ぐ", () => {
    const f = flow();
    expect(removeStepById(f, "c")!.id).toBe("c");
    expect((f[2] as unknown as { heading?: string }).heading).toBe("後半");
    expect(ids(f)).toEqual(["a", "b", "d"]);
    expect(removeStepById(f, "zz")).toBeNull();
  });
  it("入れ子の中の工程も、消せる", () => {
    const f = flow();
    removeStepById(f, "c1");
    expect(ids((f[2] as unknown as { steps: Step[] }).steps)).toEqual(["c2"]);
  });
});

describe("moveStepTo / moveStepBy", () => {
  it("別の枠へ動かせる。同じ並びの中では、動かす前の位置を引いて数える", () => {
    const f = flow();
    expect(moveStepTo(f, "d", { ownerId: "c", key: "body" }, 0)).toBe(true);
    expect(ids((f[2] as unknown as { steps: Step[] }).steps)).toEqual(["d", "c1", "c2"]);
    const g = flow();
    moveStepTo(g, "a", TOP, 3); // a を、c と d の間 (3 番目の隙間) へ
    expect(ids(g)).toEqual(["b", "c", "a", "d"]);
    const h = flow();
    moveStepTo(h, "d", TOP, 0);
    expect(ids(h)).toEqual(["d", "a", "b", "c"]);
  });
  it("自分の中へは動かせない", () => {
    const f = flow();
    expect(moveStepTo(f, "c", { ownerId: "c", key: "body" }, 0)).toBe(false);
    expect(moveStepTo(f, "c", { ownerId: "c1", key: "sub" }, 0)).toBe(false);
    expect(ids(f)).toEqual(["a", "b", "c", "d"]);
  });
  it("最上位から出る工程の見出しは、次の工程へ引き継ぐ。最上位でなくなると、見出しは外れる", () => {
    const f = flow();
    moveStepTo(f, "c", { ownerId: "b", key: "else" }, 0);
    expect((f.find((s) => s.id === "d") as unknown as { heading?: string }).heading).toBe("後半");
    expect((resolveList(f, { ownerId: "b", key: "else" })![0] as unknown as { heading?: string }).heading).toBeUndefined();
  });
  it("1 つずつ上下に動かす。見出しは、位置に付いたまま", () => {
    const f = flow();
    expect(moveStepBy(f, "b", 1)).toBe(true);
    expect(ids(f)).toEqual(["a", "c", "b", "d"]);
    expect((f[1] as unknown as { heading?: string }).heading).toBeUndefined();
    expect((f[2] as unknown as { heading?: string }).heading).toBe("後半");
    expect(moveStepBy(f, "a", -1)).toBe(false);
    expect(moveStepBy(f, "d", 1)).toBe(false);
  });
});

describe("項目を直す", () => {
  it("patchStep: 値が undefined の項目は消す", () => {
    const f = flow();
    expect(patchStep(f, "a", { description: "説明", expression: undefined })).toBe(true);
    expect(f[0]).toMatchObject({ description: "説明" });
    expect("expression" in f[0]).toBe(false);
  });
  it("patchOutputBinding: 名前と呼び名。名前が無ければ作らない", () => {
    const f = flow();
    expect(patchOutputBinding(f, "a", { label: "合計" })).toBe(false);
    expect(patchOutputBinding(f, "a", { name: "total", label: "合計" })).toBe(true);
    expect((f[0] as unknown as { outputBinding: unknown }).outputBinding).toEqual({ name: "total", label: "合計" });
    patchOutputBinding(f, "a", { label: "" });
    expect((f[0] as unknown as { outputBinding: unknown }).outputBinding).toEqual({ name: "total" });
  });
  it("setHeading: 付ける・直す・空で外す。最上位だけ", () => {
    const f = flow();
    expect(setHeading(f, "d", "  終わり  ")).toBe(true);
    expect((f[3] as unknown as { heading: string }).heading).toBe("終わり");
    setHeading(f, "d", "");
    expect("heading" in f[3]).toBe(false);
    expect(setHeading(f, "c1", "x")).toBe(false);
  });
});

describe("分岐の腕", () => {
  it("条件を直す・腕を足す (次の記号)・消す・それ以外を作る", () => {
    const f = flow();
    expect(setArmCondition(f, "b", "br-01", "@y > 1")).toBe(true);
    expect((f[1] as unknown as { branches: Array<{ condition: { expression: string } }> }).branches[0].condition.expression).toBe("@y > 1");
    const used = new Set(["a", "b", "br-01", "br-02"]);
    const id = addArm(f, "b", used)!;
    expect(id).toBe("br-03");
    // 「それ以外」が B を使っているので、足す道は C
    expect((f[1] as unknown as { branches: Array<{ code: string }> }).branches.map((x) => x.code)).toEqual(["A", "C"]);
    expect(removeArm(f, "b", id)).toBe(true);
    const g = flow();
    delete (g[1] as unknown as { elseBranch?: unknown }).elseBranch;
    expect(ensureElse(g, "b", new Set(["br-01"]))).toBe(true);
    expect((g[1] as unknown as { elseBranch: { code: string } }).elseBranch.code).toBe("X");
  });
});

describe("renameVariable", () => {
  it("変数を作る工程 (同じ名前のすべて) と、使う式の `@旧名` を、新しい名前に直す。別の名前・規約・メールアドレスは変えない", () => {
    const steps = [
      S({ id: "a", kind: "compute", expression: "@customer.n + @customerId + @conv.customer.x + @var.action.customer.m + @var.step.s-1.customer.k + @var.customer.z", outputBinding: { name: "customer" } }),
      S({ id: "a2", kind: "compute", expression: "2", outputBinding: { name: "customer" } }),
      S({ id: "b", kind: "branch", description: "連絡は a@customer.com へ。@ に送る", branches: [{ id: "br-01", code: "A", condition: { kind: "expression", expression: "@customer == null" }, steps: [S({ id: "c", kind: "return", bodyExpression: "{ x: @customer }" })] }] }),
      S({ id: "l", kind: "loop", loopKind: "collection", collectionSource: "@customer", collectionItemName: "customer", steps: [] }),
    ];
    renameVariable(steps, "customer", "client");
    const j = JSON.stringify(steps);
    expect(j).toContain("@client.n + @customerId + @conv.customer.x + @var.action.client.m + @var.step.s-1.client.k + @var.client.z");
    expect(j).toContain("@client == null");
    expect(j).toContain("{ x: @client }");
    expect(j).toContain("a@customer.com へ。@ に送る"); // メールアドレス・単独の @ は変えない
    expect((steps[0] as unknown as { outputBinding: { name: string } }).outputBinding.name).toBe("client");
    expect((steps[1] as unknown as { outputBinding: { name: string } }).outputBinding.name).toBe("client");
    expect((steps[3] as unknown as { collectionItemName: string }).collectionItemName).toBe("client");
  });
  it("まとまりが公開する内側の変数: expose と、@var.action.<TX>.旧名 / @TX.旧名 の形も直る", () => {
    const steps = [
      S({ id: "t", kind: "transactionScope", outputBinding: { name: "txResult", expose: ["committed", "newScore"] }, steps: [S({ id: "t1", kind: "compute", expression: "1", outputBinding: { name: "newScore" } })] }),
      S({ id: "r", kind: "return", bodyExpression: "{ a: @var.action.txResult.newScore, b: @txResult.newScore, c: @var.tx.t.newScore, d: @other.newScore }" }),
    ];
    renameVariable(steps, "newScore", "score");
    const j = JSON.stringify(steps);
    expect(j).toContain('"expose":["committed","score"]');
    expect(j).toContain("{ a: @var.action.txResult.score, b: @txResult.score, c: @var.tx.t.score, d: @other.newScore }");
    expect(j).toContain('"outputBinding":{"name":"score"}');
  });
  it("空の名前・同じ名前では、何もしない", () => {
    const steps = [S({ id: "a", kind: "compute", description: "連絡先 @ に送る", expression: "@x" })];
    const before = JSON.stringify(steps);
    renameVariable(steps, "", "newVar");
    renameVariable(steps, "x", "x");
    renameVariable(steps, "x", "");
    expect(JSON.stringify(steps)).toBe(before);
  });
});

describe("そのほかの安全 (レビュー対応)", () => {
  it("「それ以外」の記号は X。道を足しても、重ならない", () => {
    const f = [S({ id: "b", kind: "branch", branches: [{ id: "br-01", code: "A", condition: { kind: "expression", expression: "" }, steps: [] }] })];
    const ids = new Set(["b", "br-01"]);
    ensureElse(f, "b", ids);
    expect((f[0] as unknown as { elseBranch: { code: string } }).elseBranch.code).toBe("X");
    addArm(f, "b", ids);
    addArm(f, "b", ids);
    expect((f[0] as unknown as { branches: Array<{ code: string }> }).branches.map((x) => x.code)).toEqual(["A", "B", "C"]);
  });
  it("式でない条件 (tryCatch ほか) は、書き換えない (エラーコードなどが消えるため)", () => {
    const f = [S({ id: "b", kind: "branch", branches: [{ id: "br-01", code: "A", condition: { kind: "tryCatch", errorCode: "E1", errorVar: "caught" }, steps: [] }] })];
    expect(setArmCondition(f, "b", "br-01", "@x == 1")).toBe(false);
    expect((f[0] as unknown as { branches: Array<{ condition: { kind: string } }> }).branches[0].condition.kind).toBe("tryCatch");
  });
  it("canMoveInto: 自分・自分の子孫の中へは動かせない", () => {
    const f = flow();
    expect(canMoveInto(f, "c", "c")).toBe(false);
    expect(canMoveInto(f, "c", "c1")).toBe(false);
    expect(canMoveInto(f, "c", null)).toBe(true);
    expect(canMoveInto(f, "d", "c")).toBe(true);
  });
});

describe("moveDestinations (枠をまたぐ移動の行き先)", () => {
  it("最上位と、すべての枠が出る。動かす工程の中は出ない", () => {
    const steps = flow();
    const d = moveDestinations(steps, "c");
    expect(d[0].addr).toEqual(TOP);
    expect(d.some((x) => x.addr.ownerId === "b" && x.addr.key === "arm:br-01")).toBe(true);
    expect(d.some((x) => x.addr.ownerId === "b" && x.addr.key === "else")).toBe(true);
    expect(d.some((x) => x.addr.ownerId === "c")).toBe(false);
  });
  it("行き先の末尾に動かせる (別の枠へ)", () => {
    const steps = flow();
    const dest = moveDestinations(steps, "a").find((x) => x.addr.ownerId === "c" && x.addr.key === "body")!;
    expect(moveStepTo(steps, "a", dest.addr, dest.size)).toBe(true);
    expect(((steps.find((x) => x.id === "c") as unknown) as { steps: Array<{ id: string }> }).steps.map((x) => x.id)).toEqual(["c1", "c2", "a"]);
  });
});
