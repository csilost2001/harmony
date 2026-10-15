import { describe, it, expect } from "vitest";
import { normalizeForMatch, matchRank, looseMatch, rankByMatch } from "./textMatch";

describe("textMatch", () => {
  it("全角半角・大文字小文字・かなの違いを吸収する", () => {
    expect(normalizeForMatch("ＡＢＣ")).toBe("abc");
    expect(normalizeForMatch("チュウモン")).toBe("ちゅうもん");
    expect(normalizeForMatch("ﾁｭｳﾓﾝ")).toBe("ちゅうもん");
  });

  it("前方一致は 0、部分一致は 1、不一致は -1", () => {
    expect(matchRank("orderId", "ord")).toBe(0);
    expect(matchRank("orderId", "id")).toBe(1);
    expect(matchRank("orderId", "zzz")).toBe(-1);
    expect(matchRank("anything", "")).toBe(0);
  });

  it("looseMatch は 1 文字では前方一致だけ、2 文字からは部分一致も認める", () => {
    expect(looseMatch("amount", "u")).toBe(false);
    expect(looseMatch("userId", "u")).toBe(true);
    expect(looseMatch("amount", "un")).toBe(true);
  });

  it("かな・全角の違いでも一致する", () => {
    expect(looseMatch("チュウモン一覧", "ちゅうもん")).toBe(true);
    expect(looseMatch("customerId", "ＣＵＳＴ")).toBe(true);
  });

  it("前方一致を上位に、部分一致を下位に並べ、不一致は落とす (同順位は元の順)", () => {
    const items = ["subId", "idA", "xxx", "idB", "midC"];
    expect(rankByMatch(items, "id", (s) => [s])).toEqual(["idA", "idB", "subId", "midC"]);
  });
});
