import { describe, it, expect } from "vitest";
import { exportRows, toJsonRows, toMarkdownTable, toTsv } from "./tableExport";

const headers = ["画面名", "種別", "メモ"];
const rows = [["注文一覧", "一覧", "a|b"], ["カート", "入力", "1 行目\n2 行目\t末尾"], ["空", null, undefined]];

describe("toTsv", () => {
  it("見出しと行を、タブと改行で並べる。セルの中のタブ・改行は空白にする", () => {
    expect(toTsv(headers, rows).split("\n")).toEqual([
      "画面名\t種別\tメモ",
      "注文一覧\t一覧\ta|b",
      "カート\t入力\t1 行目 2 行目 末尾",
      "空\t\t",
    ]);
  });
});

describe("toMarkdownTable", () => {
  it("区切りの行を入れ、| は \\| に、改行は <br> にする", () => {
    expect(toMarkdownTable(headers, rows).split("\n")).toEqual([
      "| 画面名 | 種別 | メモ |",
      "| --- | --- | --- |",
      "| 注文一覧 | 一覧 | a\\|b |",
      "| カート | 入力 | 1 行目<br>2 行目\t末尾 |",
      "| 空 |  |  |",
    ]);
  });
});

describe("toJsonRows / exportRows", () => {
  it("見出しをキーにした行の配列 (空は null)", () => {
    expect(JSON.parse(toJsonRows(headers, rows))[2]).toEqual({ 画面名: "空", 種別: null, メモ: null });
  });
  it("形式で切り替える", () => {
    expect(exportRows("tsv", ["a"], [["1"]])).toBe("a\n1");
    expect(exportRows("markdown", ["a"], [["1"]])).toBe("| a |\n| --- |\n| 1 |");
    expect(JSON.parse(exportRows("json", ["a"], [["1"]]))).toEqual([{ a: "1" }]);
  });
});
