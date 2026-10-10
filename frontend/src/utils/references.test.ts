import { describe, it, expect } from "vitest";
import { groupReferrers, referrerRoute, REFERRER_LABELS, REFERRER_ORDER, type Referrer } from "./references";

describe("参照元の表示", () => {
  it("種類ごとに、表示の順にまとめる。空の種類は出さない", () => {
    const rs: Referrer[] = [
      { kind: "report", id: "slip", count: 1 },
      { kind: "businessFlow", id: "order", count: 2 },
      { kind: "businessFlow", id: "ship", count: 1 },
    ];
    expect(groupReferrers(rs).map((g) => [g.kind, g.items.length])).toEqual([["businessFlow", 2], ["report", 1]]);
  });

  it("開く先: ID は URL に安全に載せる。開く先のない種類は null", () => {
    expect(referrerRoute({ kind: "screen", id: "cart" })).toBe("/screen/design/cart");
    expect(referrerRoute({ kind: "processFlow", id: "a b" })).toBe("/process-flow/edit/a%20b");
    expect(referrerRoute({ kind: "screenFlow", id: "screen-flow" })).toBe("/screen/flow");
    expect(referrerRoute({ kind: "layoutComponent", id: "layout-components" })).toBeNull();
  });

  it("すべての種類に表示名と順がある", () => {
    for (const k of REFERRER_ORDER) expect(REFERRER_LABELS[k]).toBeTruthy();
    expect(new Set(REFERRER_ORDER).size).toBe(Object.keys(REFERRER_LABELS).length);
  });
});
