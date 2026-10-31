import { describe, expect, it } from "vitest";
import { cutLines, extractSection, MAX_DIFF_LINES, snippetHeading, unifiedDiff } from "./lineDiff.js";

const H = (path = "f") => `--- a/${path}\n+++ b/${path}\n`;
const nums = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `l${from + i}`);
const text = (lines: string[]) => lines.join("\n") + "\n";

describe("行の差分 (unified diff)", () => {
  it("同じなら空。CRLF と LF の違いは差にしない", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "f")).toEqual({ diff: "", tooLarge: false, changed: false });
    expect(unifiedDiff("a\r\nb\r\n", "a\nb\n", "f").diff).toBe("");
    expect(unifiedDiff("", "", "f").changed).toBe(false);
  });
  it("追加", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\nc\n", "f").diff).toBe(`${H()}@@ -1,2 +1,3 @@\n a\n b\n+c\n`);
  });
  it("削除", () => {
    expect(unifiedDiff("a\nb\nc\n", "a\nc\n", "f").diff).toBe(`${H()}@@ -1,3 +1,2 @@\n a\n-b\n c\n`);
  });
  it("変更 (削除してから追加の順)", () => {
    expect(unifiedDiff("a\nb\nc\n", "a\nX\nc\n", "dir/Dockerfile").diff).toBe(`${H("dir/Dockerfile")}@@ -1,3 +1,3 @@\n a\n-b\n+X\n c\n`);
  });
  it("空 → 内容 / 内容 → 空 は、行数 0 の側の開始を 0 にする", () => {
    expect(unifiedDiff("", "x\ny\n", "f").diff).toBe(`${H()}@@ -0,0 +1,2 @@\n+x\n+y\n`);
    expect(unifiedDiff("x\ny\n", "", "f").diff).toBe(`${H()}@@ -1,2 +0,0 @@\n-x\n-y\n`);
  });
  it("末尾の改行の有無の違いは、No newline の印で示す", () => {
    expect(unifiedDiff("a\nb", "a\nb\n", "f").diff).toBe(`${H()}@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n`);
    expect(unifiedDiff("a\nb\n", "a\nb", "f").diff).toBe(`${H()}@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n`);
    expect(unifiedDiff("a\nb", "a\nb", "f").changed).toBe(false);
  });
  it("変更の前後 3 行の文脈をつける (行番号は 1 始まり)", () => {
    const a = nums(10), b = [...a];
    b[4] = "CHANGED";
    expect(unifiedDiff(text(a), text(b), "f").diff).toBe(`${H()}@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+CHANGED\n l6\n l7\n l8\n`);
  });
  it("先頭・末尾の変更では、ファイルの端で文脈が止まる", () => {
    const a = nums(10), b = [...a];
    b[0] = "FIRST";
    expect(unifiedDiff(text(a), text(b), "f").diff).toBe(`${H()}@@ -1,4 +1,4 @@\n-l1\n+FIRST\n l2\n l3\n l4\n`);
  });
  it("離れた変更は hunk を分け、文脈が届く・隣り合う変更は 1 つにまとめる", () => {
    const base = nums(30);
    const at = (...idx: number[]) => { const b = [...base]; for (const i of idx) b[i] = `X${i}`; return b; };
    const hunks = (b: string[]) => unifiedDiff(text(base), text(b), "f").diff.split("\n").filter((l) => l.startsWith("@@"));
    expect(hunks(at(2, 9))).toHaveLength(1); // 間が 6 行 (文脈 3 + 3 がつながる)
    expect(hunks(at(2, 10))).toHaveLength(2); // 間が 7 行 (つながらない)
    const two = hunks(at(2, 20));
    expect(two).toEqual(["@@ -1,6 +1,6 @@", "@@ -18,7 +18,7 @@"]);
  });
  it("行の入れ替え・挿入が混ざっても、適用すると b になる (LCS の編集列が正しい)", () => {
    const a = ["a", "b", "c", "d", "e", "f"], b = ["a", "c", "X", "d", "Y", "f", "g"];
    const d = unifiedDiff(text(a), text(b), "f").diff;
    // 差分を a に適用し直して b を作る (hunk は全体を覆うので、文脈つきの行から作れる)
    const out: string[] = [];
    for (const l of d.split("\n").slice(2)) { if (l.startsWith("@@") || !l) continue; if (l[0] === " " || l[0] === "+") out.push(l.slice(1)); }
    expect(out).toEqual(b);
  });
  it("片方が 3000 行を超えるときは作らず tooLarge", () => {
    const ok = text(nums(MAX_DIFF_LINES)), big = text(nums(MAX_DIFF_LINES + 1));
    expect(unifiedDiff(ok, ok + "", "f").tooLarge).toBe(false);
    expect(unifiedDiff(ok, big, "f")).toEqual({ diff: "", tooLarge: true, changed: true });
    expect(unifiedDiff(big, big, "f")).toMatchObject({ tooLarge: true, changed: false });
  });
  it("3000 行どうしでも、共通部分を除いて現実的な時間で終わる", () => {
    const a = nums(MAX_DIFF_LINES), b = [...a];
    b[1500] = "X";
    const t = Date.now();
    expect(unifiedDiff(text(a), text(b), "f").diff).toContain("+X");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("行の境界で切る", () => {
  it("上限以内ならそのまま。超えたら、超える行を残さず切る (日本語の途中では切れない)", () => {
    expect(cutLines("a\nb\n", 100)).toEqual({ text: "a\nb\n", truncated: false });
    expect(cutLines("あ\nい\nう\n", 7)).toEqual({ text: "あ\n", truncated: true }); // 1 行 4 バイト
    expect(cutLines("あ\nい\nう\n", 11)).toEqual({ text: "あ\nい\n", truncated: true });
    expect(cutLines("x".repeat(20), 5)).toEqual({ text: "", truncated: true });
    // 上限ちょうどの行は残す (N2)。1 バイト足りなければ残さない
    expect(cutLines("あ\nい\nう\n", 8)).toEqual({ text: "あ\nい\n", truncated: true });
    expect(cutLines("あ\nい\nう\n", 4)).toEqual({ text: "あ\n", truncated: true });
    expect(cutLines("あ\nい\nう\n", 3)).toEqual({ text: "", truncated: true });
  });
});

describe("README の節の切り出し", () => {
  const SNIP = "## 開発環境\n手順\n";
  it("snippet の最初の見出しを読む (最初の空でない行が見出しのときだけ)", () => {
    expect(snippetHeading("\n## 開発環境 (Dev Containers)  \n本文")).toEqual({ line: "## 開発環境 (Dev Containers)", level: 2 });
    expect(snippetHeading("本文\n## 見出し")).toBeNull();
    expect(snippetHeading("#見出しではない\n")).toBeNull();
    expect(snippetHeading("")).toBeNull();
  });
  it("見出しから、同じレベルの次の見出しの前まで。末尾の空行は含めない。行番号は 1 始まり", () => {
    const readme = "# app\n\n## 開発環境\n手順 1\n手順 2\n\n## 次の節\n他\n";
    expect(extractSection(readme, SNIP)).toEqual({ heading: "## 開発環境", text: "## 開発環境\n手順 1\n手順 2", startLine: 3, endLine: 5 });
  });
  it("下のレベルの見出しは節の中、上のレベルの見出しで終わる", () => {
    const readme = "## 開発環境\n本文\n### 小見出し\n中\n# 上のレベル\n外\n";
    expect(extractSection(readme, SNIP)).toMatchObject({ text: "## 開発環境\n本文\n### 小見出し\n中", startLine: 1, endLine: 4 });
    expect(extractSection("## 開発環境\n本文\n### 小見出し\n中\n## 同じ\n外\n", SNIP)).toMatchObject({ endLine: 4 });
  });
  it("README の終わりまで続く節 (後ろに見出しが無い)。末尾の改行の有無は問わない", () => {
    expect(extractSection("# app\n## 開発環境\na\nb", SNIP)).toEqual({ heading: "## 開発環境", text: "## 開発環境\na\nb", startLine: 2, endLine: 4 });
    expect(extractSection("# app\n## 開発環境\na\n\n\n", SNIP)).toMatchObject({ endLine: 3 });
    expect(extractSection("## 開発環境\n", SNIP)).toMatchObject({ text: "## 開発環境", startLine: 1, endLine: 1 });
  });
  it("節が無い・見出しの文が違う・snippet に見出しが無いときは null", () => {
    expect(extractSection("# app\n## 別の節\n", SNIP)).toBeNull();
    expect(extractSection("# app\n### 開発環境\n", SNIP)).toBeNull(); // レベルが違えば別の見出し
    expect(extractSection("## 開発環境\n", "見出しなし\n")).toBeNull();
    expect(extractSection("", SNIP)).toBeNull();
  });
  it("同じ見出しが複数あれば最初のもの。コードブロックの中の # や見出しは数えない。CRLF も読む", () => {
    expect(extractSection("## 開発環境\n1\n## 開発環境\n2\n", SNIP)).toMatchObject({ text: "## 開発環境\n1", startLine: 1 });
    const fenced = "## 開発環境\n```sh\n# コメント\n## 見出しに見える\n```\n続き\n## 次\n";
    expect(extractSection(fenced, SNIP)).toMatchObject({ endLine: 6, text: "## 開発環境\n```sh\n# コメント\n## 見出しに見える\n```\n続き" });
    expect(extractSection("## 次\n```\n## 開発環境\n```\n", SNIP)).toBeNull(); // コードブロックの中にしか無い
    expect(extractSection("# a\r\n## 開発環境\r\nx\r\n## b\r\n", SNIP)).toMatchObject({ text: "## 開発環境\nx", startLine: 2, endLine: 3 });
  });
});

describe("README の節: snippet が複数の同レベルの節から成るとき (#1578 レビュー M1)", () => {
  const SNIP = "## A 開発環境\na1\n\n## B 設計ツール\nb1\n\n## C 本番\nc1\n";
  it("snippet 自身の 2 番目以降の見出しは節の終わりにしない。snippet に無い見出しの前で終わる", () => {
    const readme = `# app\n\n${SNIP}\n## 無関係\n外\n`;
    expect(extractSection(readme, SNIP)).toEqual({ heading: "## A 開発環境", text: SNIP.trimEnd(), startLine: 3, endLine: 10 });
  });
  it("README の終わりまで続くこともある。後ろに snippet に無い上のレベルの見出しがあればそこまで", () => {
    expect(extractSection(`# app\n${SNIP}`, SNIP)).toMatchObject({ startLine: 2, endLine: 9 });
    expect(extractSection(`${SNIP}\n# 上\n外\n`, SNIP)).toMatchObject({ startLine: 1, endLine: 8 });
  });
  it("最初の見出し自身は終わりとみなす (同じ見出しが 2 回あれば最初のもので終わる)", () => {
    expect(extractSection("## A 開発環境\n1\n## A 開発環境\n2\n", SNIP)).toMatchObject({ text: "## A 開発環境\n1", endLine: 2 });
  });
  it("README の節の並びが違う (snippet に無い見出しが間に入る) と、そこで終わる", () => {
    expect(extractSection("## A 開発環境\na1\n\n## 利用者の節\nx\n\n## B 設計ツール\nb1\n", SNIP)).toMatchObject({ endLine: 2 });
  });
});

describe("見出しとコードの囲みの読み方 (#1578 レビュー N1)", () => {
  const SNIP = "## 開発環境\n手順\n";
  it("4 つ以上の囲みの中の ``` では閉じない。情報文字列つきの行では閉じない", () => {
    const readme = "## 開発環境\n````md\n```\n## 偽見出し\n```\n````\n続き\n## 次\n";
    expect(extractSection(readme, SNIP)).toMatchObject({ endLine: 7 });
    const info = "## 開発環境\n```\n```sh\n## 偽\n```\n続き\n## 次\n";
    expect(extractSection(info, SNIP)).toMatchObject({ endLine: 6 });
    expect(extractSection("## 開発環境\n~~~\n```\n## 偽\n~~~\n続き\n## 次\n", SNIP)).toMatchObject({ endLine: 6 }); // 文字が違えば閉じない
  });
  it("見出しの前の空白 3 つまでは見出し。4 つ以上はコード", () => {
    expect(extractSection("## 開発環境\n本文\n  ## 次\n", SNIP)).toMatchObject({ endLine: 2 });
    expect(extractSection("## 開発環境\n本文\n    ## 次はコード\n", SNIP)).toMatchObject({ endLine: 3 });
  });
  it("閉じ記号つき (## 開発環境 ##) と空白が複数の見出しも同じ見出しとして見つける", () => {
    expect(extractSection("# a\n## 開発環境 ##\n手順\n", SNIP)).toMatchObject({ startLine: 2, endLine: 3 });
    expect(extractSection("# a\n##   開発環境\n手順\n", SNIP)).toMatchObject({ startLine: 2 });
    expect(extractSection("# a\n## 開発環境\n手順\n", "##  開発環境  ##\n手順\n")).toMatchObject({ startLine: 2 });
    expect(extractSection("## 開発環境の続き\n", SNIP)).toBeNull(); // 部分一致はしない
  });
});
