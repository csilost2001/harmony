import { describe, it, expect } from "vitest";
import { toCsv } from "./tableExport";

describe("toCsv (続編 第 6 弾 #119)", () => {
  it("見出しと行を CRLF 区切りの CSV にする", () => {
    expect(toCsv(["名前", "件数"], [["顧客", 3], ["注文", 0]])).toBe("名前,件数\r\n顧客,3\r\n注文,0");
  });
  it("カンマ・引用符・改行を含むセルは引用符で囲む", () => {
    expect(toCsv(["a"], [["x,y"], ['say "hi"'], ["l1\nl2"]])).toBe('a\r\n"x,y"\r\n"say ""hi"""\r\n"l1\nl2"');
  });
  it("null / undefined は空。数値の負の値はそのまま", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, -5]])).toBe("a,b,c\r\n,,-5");
  });
  it("式として実行される先頭の文字は ' を付けて文字にする", () => {
    expect(toCsv(["a"], [["=SUM(A1)"], ["+1"], ["-x"], ["@a"], ["ふつう"]])).toBe("a\r\n'=SUM(A1)\r\n'+1\r\n'-x\r\n'@a\r\nふつう");
  });
});
