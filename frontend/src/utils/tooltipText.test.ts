import { describe, it, expect } from "vitest";
import { splitTooltip } from "./tooltipText";

describe("splitTooltip (続編 第 10 弾 #196)", () => {
  it("末尾の括弧がキーの組み合わせなら、説明とキーに分ける", () => {
    expect(splitTooltip("保存 (Ctrl+S)")).toEqual({ text: "保存", keys: ["Ctrl", "S"] });
    expect(splitTooltip("次の要確認へ移る (F8。Shift+F8 で前へ)")).toEqual({ text: "次の要確認へ移る (F8。Shift+F8 で前へ)", keys: [] });
    expect(splitTooltip("縮小 (−)")).toEqual({ text: "縮小 (−)", keys: [] });
    expect(splitTooltip("拡大 (+)")).toEqual({ text: "拡大 (+)", keys: [] });
    expect(splitTooltip("全体を収める (F)")).toEqual({ text: "全体を収める", keys: ["F"] });
    expect(splitTooltip("キーボードショートカット一覧 (?)")).toEqual({ text: "キーボードショートカット一覧", keys: ["?"] });
    expect(splitTooltip("検索 (Ctrl+Alt+F)")).toEqual({ text: "検索", keys: ["Ctrl", "Alt", "F"] });
    expect(splitTooltip("閉じる (Esc)")).toEqual({ text: "閉じる", keys: ["Esc"] });
  });
  it("キーでない括弧 (補足の文・英単語) は、そのまま", () => {
    expect(splitTooltip("ER 図 (テーブルの関係)")).toEqual({ text: "ER 図 (テーブルの関係)", keys: [] });
    expect(splitTooltip("表示 (ER)")).toEqual({ text: "表示 (ER)", keys: [] });
    expect(splitTooltip("括弧なし")).toEqual({ text: "括弧なし", keys: [] });
    expect(splitTooltip("(Ctrl+S)")).toEqual({ text: "(Ctrl+S)", keys: [] });
  });
});
