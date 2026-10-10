import { describe, it, expect } from "vitest";
import { describeDeletionImpact } from "./confirmDeletion";
import type { ReferenceResult } from "./references";

const res = (id: string, referrers: ReferenceResult["referrers"]): { id: string; result: ReferenceResult } => ({
  id, result: { entityType: "screen", id, exists: true, referrers, total: referrers.length },
});

describe("削除の影響の文", () => {
  it("参照されていなければ null", () => {
    expect(describeDeletionImpact([res("cart", [])], "画面")).toBeNull();
  });

  it("参照元を列挙する (名前があれば名前)", () => {
    const m = describeDeletionImpact([res("cart", [{ kind: "businessFlow", id: "order", name: "注文", count: 2 }, { kind: "report", id: "slip", count: 1 }])], "画面")!;
    expect(m).toContain("画面「cart」← 業務フロー「注文」、帳票「slip」");
    expect(m).toContain("要確認");
  });

  it("同時に削除する設計どうしの参照は数えない", () => {
    const m = describeDeletionImpact([
      res("a", [{ kind: "screen", id: "b", count: 1 }]),
      res("b", [{ kind: "screen", id: "a", count: 1 }]),
    ], "画面");
    expect(m).toBeNull();
  });

  it("多いときは省略する", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "processFlow" as const, id: `f${i}`, count: 1 }));
    expect(describeDeletionImpact([res("cart", many)], "画面")).toContain("ほか 4 件");
  });
});
