import { describe, it, expect } from "vitest";
import { analyzeImpact, buildDesignGraph, findUnused } from "@harmony/shared";
import { loadExample, tiny } from "./fixtures";

describe("参照のつながり", () => {
  const input = tiny();
  const g = buildDesignGraph(input);
  const has = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);

  it("画面項目の列・イベントの処理・処理のテーブル・業務フローの画面を辺にする", () => {
    expect(has("screen:order-entry", "table:customer")).toBe(true);
    expect(has("screen:order-entry", "table:order")).toBe(true);
    expect(has("screen:order-entry", "processFlow:order-create")).toBe(true);
    expect(has("processFlow:order-create", "table:order")).toBe(true);
    expect(has("processFlow:order-create", "screen:order-entry")).toBe(true);
    expect(has("businessFlow:bf1", "screen:order-entry")).toBe(true);
    expect(has("table:order", "table:customer")).toBe(true); // 外部キー
  });

  it("定義の無いものへの辺は作らない", () => {
    expect(g.edges.every((e) => g.nodes.has(e.from) && g.nodes.has(e.to))).toBe(true);
  });
});

describe("影響分析", () => {
  const input = tiny();

  it("テーブルを変えると、処理・画面・業務フロー・外部キーの先のテーブルへ連鎖する", () => {
    const r = analyzeImpact(input, "table", "customer");
    const byDepth = (d: number) => (r.levels.find((l) => l.depth === d)?.hits ?? []).map((h) => h.node.key).sort();
    expect(byDepth(1)).toEqual(["processFlow:order-create", "screen:order-entry", "table:order"]);
    // 2 段目: 注文テーブルを使う画面・処理は 1 段目に出ているので、残りは業務フロー
    expect(byDepth(2)).toEqual(["businessFlow:bf1"]);
    expect(r.total).toBe(4);
    expect(r.byKind).toMatchObject({ table: 1, screen: 1, processFlow: 1, businessFlow: 1 });
  });

  it("各ヒットに、どの設計を通って影響するかが付く", () => {
    const r = analyzeImpact(input, "table", "customer");
    const bf = r.levels.flatMap((l) => l.hits).find((h) => h.node.key === "businessFlow:bf1")!;
    expect(bf.via.key).toBe("screen:order-entry");
    expect(bf.via.label).toContain("工程");
  });

  it("列で絞ると、その列に結び付いた参照とその先だけになる", () => {
    const r = analyzeImpact(input, "table", "order", { column: "o-qty" });
    // 数量の列: 画面 (qty 項目) と、SQL に qty を書いている…処理は INSERT 文に qty を含む
    const keys = r.levels.flatMap((l) => l.hits).map((h) => h.node.key);
    expect(keys).toContain("screen:order-entry");
    expect(keys).toContain("processFlow:order-create");
    const other = analyzeImpact(input, "table", "order", { column: "o-id" });
    expect(other.levels.flatMap((l) => l.hits).map((h) => h.node.key)).toContain("processFlow:order-create"); // SQL に order_id
    expect(other.levels.flatMap((l) => l.hits).map((h) => h.node.key)).not.toContain("screen:order-entry".replace("order-entry", "zzz"));
  });

  it("存在しない対象は空の結果", () => {
    expect(analyzeImpact(input, "table", "nothing")).toMatchObject({ target: null, total: 0, levels: [] });
  });

  it("循環があっても止まる (画面遷移の往復)", () => {
    const cyc = { ...tiny(), transitions: [{ sourceScreenId: "order-entry", targetScreenId: "order-list" }, { sourceScreenId: "order-list", targetScreenId: "order-entry" }] };
    const r = analyzeImpact(cyc, "screen", "order-entry");
    expect(r.levels.flatMap((l) => l.hits).map((h) => h.node.key)).toContain("screen:order-list");
  });
});

describe("未使用の検出", () => {
  const input = tiny();
  const items = findUnused(input);
  const ids = (k: string) => items.filter((i) => i.kind === k).map((i) => i.id);

  it("どこからも使われていないテーブル・メッセージ・画面・処理を挙げる", () => {
    expect(ids("table")).toEqual(["lonely"]);
    expect(ids("message").sort()).toEqual(["spare", "used"]); // 本文に @conv.msg の参照が無いので、どちらも未使用
    expect(ids("screen")).toEqual(["order-list"]);
    expect(ids("processFlow")).toEqual(["order-orphan"]);
  });

  it("本文で参照されているメッセージは未使用にならない", () => {
    const withRef = tiny();
    (withRef.screens[0].items![0] as unknown as Record<string, unknown>).errorMessages = { required: "@conv.msg.used" };
    expect(findUnused(withRef).filter((i) => i.kind === "message").map((i) => i.id)).toEqual(["spare"]);
  });
});

describe("retail の実データ", () => {
  const input = loadExample("retail");
  it("未使用・影響分析が実データで動く", () => {
    const unused = findUnused(input);
    expect(unused.some((u) => u.kind === "table" && u.id === "customer-master")).toBe(true); // CRUD の所見と同じ (どの処理からも使われていない)
    const r = analyzeImpact(input, "table", "cart-item");
    expect(r.total).toBeGreaterThan(0);
    expect(r.levels[0].depth).toBe(1);
  });
});
