import { describe, it, expect } from "vitest";
import { blocksToMarkdown, buildDesignDocument, htmlToBlocks, type DesignDocInput } from "@harmony/shared";

describe("blocksToMarkdown (続編 第 9 弾 #169)", () => {
  it("見出し・段落・箇条書き・基本情報・表を Markdown にする", () => {
    const md = blocksToMarkdown([
      { type: "heading", level: 2, text: "テーブル 注文" },
      { type: "paragraph", text: "注文を持つ表" },
      { type: "list", items: ["a", "b"] },
      { type: "pairs", pairs: [["物理名", "orders"]] },
      { type: "table", header: true, rows: [["列", "型"], ["id", "BIGINT"], ["a|b", "x\ny"]] },
    ]);
    expect(md).toContain("## テーブル 注文");
    expect(md).toContain("- a\n- b");
    expect(md).toContain("- **物理名**: orders");
    expect(md).toContain("| 列 | 型 |\n| --- | --- |\n| id | BIGINT |");
    expect(md).toContain("| a\\|b | x<br>y |"); // 表の中の | と改行
  });
  it("見出し行の無い表は、空の見出し行を足す。列の足りない行は埋める", () => {
    const md = blocksToMarkdown([{ type: "table", header: false, rows: [["a", "b"], ["c"]] }]);
    expect(md).toContain("|  |  |\n| --- | --- |\n| a | b |\n| c |  |");
  });
  it("設計書の HTML から作れる", () => {
    const input = { project: { name: "P" }, screens: [], flows: [], tables: [{ id: "orders", name: "注文", physicalName: "orders", columns: [{ physicalName: "id", name: "ID", dataType: "BIGINT" }] }], version: "1.0", generatedAt: "2026-10-17T00:00:00.000Z" } as unknown as DesignDocInput;
    const md = blocksToMarkdown(htmlToBlocks(buildDesignDocument(input).html));
    expect(md).toContain("注文");
    expect(md).toContain("BIGINT");
  });
});
