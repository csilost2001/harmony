import { describe, it, expect } from "vitest";
import { afterSegments, groupByEntity, replaceableKeys, splitByQuery, type ReplaceCandidate } from "./replaceView";

describe("splitByQuery", () => {
  it("合う部分とそうでない部分に分ける (複数回も)", () => {
    expect(splitByQuery("顧客の顧客番号", "顧客", false)).toEqual([
      { text: "顧客", hit: true }, { text: "の", hit: false }, { text: "顧客", hit: true }, { text: "番号", hit: false },
    ]);
  });
  it("大文字小文字は、指定したときだけ区別。正規表現の記号は、そのままの文字として探す", () => {
    expect(splitByQuery("Order order", "order", false).filter((s) => s.hit).map((s) => s.text)).toEqual(["Order", "order"]);
    expect(splitByQuery("Order order", "order", true).filter((s) => s.hit).map((s) => s.text)).toEqual(["order"]);
    expect(splitByQuery("a.*b", ".*", false)).toEqual([{ text: "a", hit: false }, { text: ".*", hit: true }, { text: "b", hit: false }]);
  });
  it("合わなければ全体が 1 つ。語が空なら全体", () => {
    expect(splitByQuery("注文", "顧客", false)).toEqual([{ text: "注文", hit: false }]);
    expect(splitByQuery("注文", "", false)).toEqual([{ text: "注文", hit: false }]);
  });
});

describe("afterSegments", () => {
  it("合った部分が置き換える語になる。置き換える語が空なら、その部分が消える", () => {
    expect(afterSegments("顧客の顧客番号", "顧客", "取引先", false).map((s) => s.text).join("")).toBe("取引先の取引先番号");
    expect(afterSegments("顧客の顧客番号", "顧客", "取引先", false).filter((s) => s.hit)).toHaveLength(2);
    expect(afterSegments("(旧) 一覧", "(旧) ", "", false)).toEqual([{ text: "一覧", hit: false }]);
  });
});

const cand = (kind: ReplaceCandidate["kind"], id: string, n: number): ReplaceCandidate => ({ key: `${kind}:${id}#${n}`, kind, id, entityName: id, where: "名前", before: "a", after: "b" });

describe("groupByEntity / replaceableKeys", () => {
  it("置換後が空になる候補は、初めから選ばない (名前が空になるのを避ける)", () => {
    const empty = { ...cand("table", "t1", 9), after: "  " };
    const groups = groupByEntity([cand("table", "t1", 1), empty], []);
    expect(replaceableKeys(groups)).toEqual(["table:t1#1"]);
  });

  it("設計ごとにまとめ、編集中の設計は理由つき。置換できる key だけ取り出せる", () => {
    const groups = groupByEntity([cand("table", "t1", 1), cand("table", "t1", 2), cand("screen", "s1", 1)], [{ kind: "table", id: "t1", reason: "編集中" }]);
    expect(groups.map((g) => [g.kind, g.id, g.items.length, g.blocked])).toEqual([["table", "t1", 2, "編集中"], ["screen", "s1", 1, null]]);
    expect(replaceableKeys(groups)).toEqual(["screen:s1#1"]);
  });
});
